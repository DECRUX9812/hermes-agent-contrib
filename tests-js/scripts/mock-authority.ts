/**
 * Mock session authority for dual-topology Desktop E2E (revamp wave 0, item 0.5).
 *
 * A standalone HTTP + WebSocket server speaking the `tui_gateway` wire protocol
 * (newline-style JSON-RPC frames over `/api/ws`, `gateway.ready` on connect,
 * per-session `seq` + `replay_epoch`, `session.events.since` replay,
 * server→client `srq-*` requests). The Desktop attaches to it exactly like a
 * remote backend: `HERMES_DESKTOP_REMOTE_URL` + `HERMES_DESKTOP_REMOTE_TOKEN`.
 *
 * `mode` selects the topology being simulated:
 *
 *   - 'pooled'    — today's model: each prompt.submit executes independently
 *                   (no admission dedupe); a restart forgets every session.
 *   - 'canonical' — the post-cutover authority (NousResearch/hermes-agent#106742):
 *                   prompt.submit is a durable admission deduped on identity, so
 *                   a retried submit after a lost ack re-attaches instead of
 *                   re-executing; session state survives an authority restart,
 *                   which mints a new `replay_epoch` (the client's cue to drop
 *                   seq watermarks and refetch); an in-flight turn whose outcome
 *                   was never observed is reported `unknown`, never silently
 *                   re-run.
 *
 * Failure-mode controls live on the returned handle (`dropNextSubmitAck`,
 * `expireReplay`/`restart`, `openApproval`/`answerElsewhere`) because the spec
 * process and the mock share one node process — no control socket needed.
 *
 * The WebSocket layer is hand-rolled (RFC 6455, text/ping/pong/close only): the
 * repo has `ws` installed transitively but no `@types/ws`, and the fixture must
 * typecheck under apps/desktop's e2e tsconfig without adding a dependency.
 */

import * as crypto from 'node:crypto'
import * as http from 'node:http'
import type * as net from 'node:net'

// ─── Wire types (subset of tui_gateway/contracts) ───────────────────────

interface GatewayEventFrame {
  type: string
  session_id: string
  seq?: number
  payload?: unknown
}

interface TranscriptRow {
  role: string
  text: string
  row_id: number
  timestamp: number
}

type AdmissionStatus = 'running' | 'complete' | 'unknown'

interface Admission {
  id: string
  sid: string
  text: string
  status: AdmissionStatus
  executions: number
}

interface SessionState {
  id: string
  title: string | null
  messages: TranscriptRow[]
  seq: number
  log: GatewayEventFrame[]
  running: boolean
  owners: Set<WsSocket>
  nextRowId: number
}

interface OpenServerRequest {
  id: string
  method: string
  sid: string
  params: Record<string, unknown>
}

export type AuthorityMode = 'pooled' | 'canonical'

export interface MockAuthorityOptions {
  mode?: AuthorityMode
  token?: string
  /** Assistant reply for a submitted prompt (default echoes a fixed marker). */
  replyForPrompt?: (text: string) => string
}

export interface MockAuthority {
  url: string
  wsUrl: string
  token: string
  port: number
  mode: AuthorityMode
  /** Every prompt submission the authority executed (one entry per EXECUTION, not per submit call). */
  executions: { sessionId: string; text: string }[]
  /** Admissions (canonical mode). `status` is 'unknown' when a restart orphaned an in-flight turn. */
  admissions: () => Admission[]
  /** RPCs the authority had no handler for — boot gaps show up here. */
  unhandled: string[]
  sessionById: (id: string) => SessionState | undefined
  /** Ambiguous ack: the next prompt.submit executes but its result frame is never sent. */
  dropNextSubmitAck: () => void
  /** Hold subsequent turns mid-flight (turn starts, no reply) until releaseTurns; models an in-flight turn. */
  holdTurns: (hold: boolean) => void
  /** Complete every held turn. */
  releaseTurns: () => void
  /** Authority restart: new replay_epoch, all sockets closed, sessions retained (canonical) or dropped (pooled). */
  restart: () => void
  /** New replay epoch without a restart — the replay-gap surface: `events.since` answers the new epoch and no events. */
  expireReplay: () => void
  /** Open a server→client request (e.g. 'approval') on the sockets owning `sessionId`. */
  openServerRequest: (sessionId: string, method: string, params?: Record<string, unknown>) => string
  /** Settle an open request as another viewer would: owners get request.cancel, never a result. */
  answerElsewhere: (requestId: string) => void
  /** Close every connected socket (a transport drop; epoch unchanged). */
  dropSockets: () => void
  close: () => Promise<void>
}

// ─── Minimal RFC 6455 server ────────────────────────────────────────────

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** One accepted socket: buffered parse for fragmented/coalesced frames. */
class WsSocket {
  readonly messages: ((text: string) => void)[] = []
  private buffer = Buffer.alloc(0)
  closed = false

  private readonly raw: net.Socket

  constructor(raw: net.Socket) {
    this.raw = raw
    raw.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drain()
    })
    raw.on('close', () => {
      this.closed = true
    })
    raw.on('error', () => {
      this.closed = true
    })
  }

  onMessage(fn: (text: string) => void): void {
    this.messages.push(fn)
  }

  sendText(text: string): void {
    if (this.closed) {
      return
    }

    const payload = Buffer.from(text, 'utf8')
    const len = payload.length
    let header: Buffer

    if (len < 126) {
      header = Buffer.from([0x81, len])
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x81
      header[1] = 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x81
      header[1] = 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }

    try {
      this.raw.write(Buffer.concat([header, payload]))
    } catch {
      this.closed = true
    }
  }

  close(): void {
    if (this.closed) {
      return
    }

    this.closed = true

    try {
      this.raw.write(Buffer.from([0x88, 0x00]))
      this.raw.destroy()
    } catch {
      /* already gone */
    }
  }

  private drain(): void {
    for (;;) {
      if (this.buffer.length < 2) {
        return
      }

      const opcode = this.buffer[0]! & 0x0f
      const masked = (this.buffer[1]! & 0x80) !== 0
      let len = this.buffer[1]! & 0x7f
      let offset = 2

      if (len === 126) {
        if (this.buffer.length < 4) {return}
        len = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (this.buffer.length < 10) {return}
        len = Number(this.buffer.readBigUInt64BE(2))
        offset = 10
      }

      const maskOffset = offset
      offset += masked ? 4 : 0

      if (this.buffer.length < offset + len) {
        return
      }

      let payload = this.buffer.subarray(offset, offset + len)

      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4)
        payload = Buffer.from(payload)

        for (let i = 0; i < payload.length; i++) {
          payload[i] = payload[i]! ^ mask[i % 4]!
        }
      }

      this.buffer = this.buffer.subarray(offset + len)

      if (opcode === 0x8) {
        this.close()

        return
      }

      if (opcode === 0x9) {
        // ping → pong
        const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload])

        try {
          this.raw.write(pong)
        } catch {
          /* ignore */
        }

        continue
      }

      if (opcode === 0x1 || opcode === 0x0) {
        const text = payload.toString('utf8')

        for (const fn of this.messages) {
          fn(text)
        }
      }
    }
  }
}

// ─── Authority ──────────────────────────────────────────────────────────

export async function startMockAuthority(options: MockAuthorityOptions = {}): Promise<MockAuthority> {
  const mode = options.mode ?? 'canonical'
  const token = options.token ?? crypto.randomBytes(24).toString('base64url')
  const replyForPrompt = options.replyForPrompt ?? (() => 'Acknowledged by the mock authority.')

  const sessions = new Map<string, SessionState>()
  const admissions = new Map<string, Admission>()
  const openRequests = new Map<string, OpenServerRequest>()
  const sockets = new Set<WsSocket>()
  const executions: { sessionId: string; text: string }[] = []
  const unhandled: string[] = []
  let epoch = crypto.randomBytes(8).toString('hex')
  let dropNextAck = false
  let holdTurns = false
  const heldTurns: Array<() => void> = []
  let requestCounter = 0

  const sessionInfo = (s: SessionState) => ({
    model: 'mock-model',
    profile_name: 'default',
    provider: 'mock',
    running: s.running,
    stored_session_id: s.id,
    title: s.title
  })

  const emit = (s: SessionState, type: string, payload?: Record<string, unknown>) => {
    const frame: GatewayEventFrame = { session_id: s.id, seq: ++s.seq, type, ...(payload ? { payload } : {}) }
    s.log.push(frame)
    const text = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: frame })

    for (const socket of s.owners) {
      socket.sendText(text)
    }
  }

  const emitGlobal = (type: string, payload?: Record<string, unknown>) => {
    const text = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, ...(payload ? { payload } : {}) } })

    for (const socket of sockets) {
      socket.sendText(text)
    }
  }

  const getSession = (params: Record<string, unknown>): SessionState | undefined => {
    const id = String(params.session_id ?? params.sessionId ?? '')

    return sessions.get(id)
  }

  const adopt = (socket: WsSocket, s: SessionState) => {
    s.owners.add(socket)
  }

  const finishTurn = (s: SessionState, admission: Admission) => {
    const reply = replyForPrompt(admission.text)

    for (const piece of reply.split(' ')) {
      emit(s, 'message.delta', { text: `${piece} ` })
    }

    emit(s, 'message.complete', { status: 'complete', text: reply })
    s.messages.push({ role: 'assistant', row_id: s.nextRowId++, text: reply, timestamp: Date.now() / 1000 })
    s.running = false
    admission.status = 'complete'
    emit(s, 'session.info', { ...sessionInfo(s), running: false })
  }

  const runTurn = (s: SessionState, admission: Admission) => {
    s.running = true
    emit(s, 'session.info', { ...sessionInfo(s), running: true, turn_started_at: Date.now() / 1000 })
    emit(s, 'message.start')

    if (holdTurns) {
      heldTurns.push(() => finishTurn(s, admission))

      return
    }

    finishTurn(s, admission)
  }

  const admitPrompt = (socket: WsSocket, params: Record<string, unknown>): Record<string, unknown> | 'drop' => {
    const s = getSession(params) ?? sessions.get([...sessions.keys()][0] ?? '')
    const text = typeof params.text === 'string' ? params.text : JSON.stringify(params.text ?? '')

    if (!s) {
      throw Object.assign(new Error('no session'), { code: 4001 })
    }

    adopt(socket, s)

    const key = `${s.id}:${text}`
    const prior = mode === 'canonical' ? admissions.get(key) : undefined

    // Canonical semantics: a retried submit re-attaches to the same admission —
    // one admission, one execution. Pooled semantics: every submit executes.
    if (prior && prior.status !== 'complete') {
      return { status: 'streaming' }
    }

    if (prior && prior.status === 'complete' && Date.now() / 1000 - (s.messages.at(-1)?.timestamp ?? 0) < 30) {
      return { status: 'streaming' }
    }

    const admission: Admission = {
      executions: 1,
      id: `adm-${crypto.randomBytes(6).toString('hex')}`,
      sid: s.id,
      status: 'running',
      text
    }

    admissions.set(key, admission)
    executions.push({ sessionId: s.id, text })
    s.messages.push({ role: 'user', row_id: s.nextRowId++, text, timestamp: Date.now() / 1000 })

    // The turn executes synchronously after the ack unless the ack is being
    // dropped: the ambiguity must be observable either way.
    const execute = () => runTurn(s, admission)

    if (dropNextAck) {
      dropNextAck = false
      queueMicrotask(execute)

      return 'drop'
    }

    queueMicrotask(execute)

    return { status: 'streaming' }
  }

  const liveResult = (s: SessionState) => ({
    info: sessionInfo(s),
    message_count: s.messages.length,
    messages: s.messages,
    open_requests: [...openRequests.values()].filter(r => r.sid === s.id).map(r => ({ id: r.id, method: r.method, params: r.params })),
    running: s.running,
    session_id: s.id,
    stored_session_id: s.id
  })

  const openRequestFor = (sid: string, method: string, params: Record<string, unknown> = {}): string => {
    const id = `srq-${crypto.randomBytes(6).toString('hex')}${++requestCounter}`
    const req: OpenServerRequest = { id, method, params: { session_id: sid, ...params }, sid }
    openRequests.set(id, req)
    const s = sessions.get(sid)
    const frame = JSON.stringify({ id, jsonrpc: '2.0', method, params: req.params })

    for (const socket of s?.owners ?? sockets) {
      socket.sendText(frame)
    }

    return id
  }

  const methods: Record<string, (socket: WsSocket, params: Record<string, unknown>) => unknown> = {
    'client.capabilities': () => ({ server_requests: ['*'] }),
    'commands.catalog': () => ({ categories: [], commands: {}, pairs: [] }),
    'complete.path': () => ({ items: [] }),
    'complete.slash': () => ({ items: [] }),
    'config.get': () => ({ config: {}, model: 'mock-model', provider: 'mock' }),
    'config.set': () => ({ ok: true }),
    'free_tier.status': () => ({ available: false, enabled: false, has_guest: false, label: '', model: '', notice_pending: false }),
    'gateway.capabilities': () => ({ per_session_exclusive_submit: mode === 'canonical' }),
    'gateway.ping': () => ({ ok: true }),
    ping: () => ({ ok: true }),
    'model.options': () => modelOptions(),
    'pet.info': () => ({ enabled: false }),
    'pet.info.meta': () => ({ enabled: false }),
    'process.list': () => ({ processes: [] }),
    'profiles.describe': () => ({
      mcp_servers: [],
      model: { default: 'mock-model', provider: 'mock' },
      name: 'default',
      skills: [],
      soul: '',
      toolsets: [],
      toolsets_pinned: false
    }),
    'profiles.list': () => ({ profiles: [{ is_default: true, name: 'default', path: '/mock-authority' }] }),
    'profiles.set_asset': () => ({ ok: true }),
    'projects.tree': () => ({ projects: [] }),
    'session.active_list': () => ({ sessions: [] }),
    'setup.runtime_check': () => ({
      free_tier: false,
      model: 'mock-model',
      ok: true,
      provider: 'mock',
      source: 'env'
    }),
    'setup.status': () => ({ free_tier: false, other_providers: [], provider_configured: true, ready: true }),
    'request.answer': (_socket, params) => {
      const id = String(params.id ?? '')
      const req = openRequests.get(id)
      const s = req ? sessions.get(req.sid) : undefined

      if (!req || !s) {
        return { status: 'unknown' }
      }

      openRequests.delete(id)
      emit(s, 'request.cancel', { id, method: req.method, reason: 'answered' })

      return { status: 'answered' }
    },
    'wake.status': () => ({
      audio_silent: false,
      available: false,
      capture: 'local',
      configured_surface: 'auto',
      enabled: false,
      hint: '',
      input_device: {},
      listening: false,
      local_input_available: false,
      owned_by_caller: false,
      owner_surface: null,
      phrase: '',
      provider: ''
    }),
    'session.activate': (socket, params) => {
      const s = getSession(params)

      if (!s) {throw Object.assign(new Error('unknown session'), { code: 4001 })}
      adopt(socket, s)

      return liveResult(s)
    },
    'session.create': (socket, params) => {
      const s: SessionState = {
        id: crypto.randomUUID(),
        log: [],
        messages: [],
        nextRowId: 1,
        owners: new Set(),
        running: false,
        seq: 0,
        title: typeof params.title === 'string' ? params.title : null
      }

      sessions.set(s.id, s)
      adopt(socket, s)

      return liveResult(s)
    },
    'session.events.since': (_socket, params) => {
      const s = getSession(params)

      if (!s) {
        return { count: 0, epoch, events: [], latest_seq: 0, open_requests: [], truncated: false }
      }

      adopt(_socket, s)
      const lastSeen = Number(params.last_seen ?? 0)
      const events = s.log.filter(frame => (frame.seq ?? 0) > lastSeen)

      return {
        count: events.length,
        epoch,
        events,
        latest_seq: s.seq,
        open_requests: [...openRequests.values()].filter(r => r.sid === s.id).map(r => ({ id: r.id, method: r.method, params: r.params })),
        truncated: false
      }
    },
    'session.history': (_socket, params) => {
      const s = getSession(params)

      return { count: s?.messages.length ?? 0, messages: s?.messages ?? [] }
    },
    'session.interrupt': (_socket, params) => {
      const s = getSession(params)

      return { interrupted: Boolean(s?.running), status: 'interrupted' }
    },
    'session.list': (_socket, params) => {
      const title = params.title

      const rows = [...sessions.values()]
        .filter(s => title == null || s.title === title)
        .map(s => ({ id: s.id, message_count: s.messages.length, preview: s.messages.at(-1)?.text ?? '', started_at: s.messages[0]?.timestamp ?? 0, title: s.title ?? '' }))

      return { sessions: rows }
    },
    'session.most_recent': () => ({ session_id: [...sessions.keys()].at(-1) ?? null }),
    'session.resume': (socket, params) => {
      const s = getSession(params)

      if (!s) {throw Object.assign(new Error('unknown session'), { code: 4001 })}
      adopt(socket, s)

      return { ...liveResult(s), resumed: s.id }
    },
    'session.status': (_socket, params) => {
      const s = getSession(params)

      return { output: s?.running ? 'running' : 'idle' }
    },
    'session.steer': (socket, params) => {
      const s = getSession(params)

      // A steer on an idle or absent session is just a new turn.
      if (!s?.running) {
        return admitPrompt(socket, params)
      }

      return { accepted: true }
    },
    'session.title': (_socket, params) => {
      const s = getSession(params)

      if (s && typeof params.title === 'string') {
        s.title = params.title
      }

      return { title: s?.title ?? '' }
    },
    'slash.exec': () => ({ handled: false }),
    'command.dispatch': () => ({}),
    'prompt.submit': (socket, params) => admitPrompt(socket, params)
  }

  const handleFrame = (socket: WsSocket, text: string) => {
    let frame: { id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown }

    try {
      frame = JSON.parse(text)
    } catch {
      return
    }

    // A response to a server→client request (id srq-*, result member, no method).
    if (typeof frame.id === 'string' && frame.id.startsWith('srq-') && frame.method === undefined) {
      const req = openRequests.get(frame.id)

      if (req) {
        openRequests.delete(frame.id)
        const s = sessions.get(req.sid)

        if (s) {
          emit(s, 'request.cancel', { id: req.id, method: req.method, reason: 'answered' })
        }
      }

      return
    }

    if (typeof frame.method !== 'string') {
      return
    }

    const id = frame.id

    const reply = (result: unknown) =>
      socket.sendText(JSON.stringify({ id, jsonrpc: '2.0', result }))

    const fail = (code: number, message: string) =>
      socket.sendText(JSON.stringify({ error: { code, message }, id, jsonrpc: '2.0' }))

    if (process.env.MOCK_AUTHORITY_DEBUG) {
      console.error(`[mock-authority] ${frame.method}`, JSON.stringify(frame.params ?? {}).slice(0, 160))
    }

    const handler = methods[frame.method]

    if (!handler) {
      unhandled.push(frame.method)
      fail(-32601, `method not found: ${frame.method}`)

      return
    }

    try {
      const result = handler(socket, frame.params ?? {})

      if (result === 'drop') {
        return
      }

      reply(result)
    } catch (error) {
      const code = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -32603
      fail(code, error instanceof Error ? error.message : String(error))
    }
  }

  const profileDict = {
    description: '',
    description_auto: false,
    display_name: '',
    distribution_name: null,
    distribution_source: null,
    distribution_version: null,
    has_alias: false,
    has_env: false,
    is_default: true,
    model: 'mock-model',
    name: 'default',
    path: '/mock-authority',
    provider: 'mock',
    role: null,
    skill_count: 0
  }

  const sessionRow = (s: SessionState) => ({
    ended_at: null,
    id: s.id,
    input_tokens: 0,
    is_active: s.running,
    is_default_profile: true,
    last_active: Math.max(...s.messages.map(m => m.timestamp), 0),
    message_count: s.messages.length,
    model: 'mock-model',
    output_tokens: 0,
    preview: s.messages.length ? s.messages[s.messages.length - 1].text.slice(0, 200) : null,
    profile: 'default',
    source: 'desktop',
    started_at: s.messages.length ? s.messages[0].timestamp : 0,
    title: s.title,
    tool_call_count: 0
  })

  const modelOptions = () => ({
    model: 'mock-model',
    provider: 'mock',
    providers: [
      {
        authenticated: true,
        is_current: true,
        models: ['mock-model'],
        name: 'Mock Provider',
        slug: 'mock',
        total_models: 1
      }
    ]
  })

  /** The boot/boot-adjacent REST surface the renderer probes while it opens.
   *  Every row mirrors the real `hermes serve` shape; anything missing fails
   *  closed as `unavailable`/`empty`, never as an error the UI must handle. */
  const httpRoutes: Record<string, () => unknown> = {
    '/api/audio/voice-live/status': () => ({ mode: 'chained', ok: true, supported: false }),
    '/api/config': () => ({}),
    '/api/config/defaults': () => ({}),
    '/api/cron/jobs': () => ({ jobs: [], total: 0 }),
    '/api/git/status': () => ({ branch: null, clean: true, is_repo: false }),
    '/api/fs/default-cwd': () => ({ branch: null, cwd: '/tmp' }),
    '/api/hermes/update/check': () => ({
      behind: 0,
      can_apply: false,
      current_version: '0.0.0-mock-authority',
      install_method: 'unknown',
      message: null,
      update_available: false,
      update_command: ''
    }),
    '/api/local-models/status': () => ({
      active_model_id: null,
      configured_tag: null,
      enabled: false,
      loaded_models: {},
      loading: {},
      placement: {},
      runtime_backend: null,
      runtime_installed: false,
      server_base_url: null,
      server_running: false,
      tag: null,
      update_available: false
    }),
    '/api/mcp/catalog': () => ({ servers: [] }),
    '/api/model/info': () => ({
      context_length: 0,
      context_length_source: 'none',
      model: 'mock-model',
      provider: 'mock'
    }),
    '/api/model/options': modelOptions,
    '/api/plugins/kanban/board': () => ({ board: null }),
    '/api/plugins/kanban/boards': () => ({ boards: [] }),
    '/api/profiles': () => ({ profiles: [profileDict] }),
    '/api/profiles/active': () => ({ active: 'default', current: 'default' }),
    '/api/profiles/sessions': () => ({
      errors: [],
      limit: 0,
      offset: 0,
      profile_totals: { default: sessions.size },
      sessions: [...sessions.values()].map(s => sessionRow(s)),
      storage: {},
      total: sessions.size
    }),
    '/api/skills': () => ({ skills: [] }),
    '/api/profiles/sessions/sidebar': () => ({
      cron: { sessions: [] },
      errors: [],
      messaging: { sessions: [], total: 0 },
      recents: { profiles_truncated: {}, profiles_usage: {}, sessions: [] },
      storage: []
    }),
    '/api/providers/oauth': () => ({ providers: [] }),
    '/api/sessions': () => ({
      limit: 0,
      offset: 0,
      sessions: [...sessions.values()].map(s => sessionRow(s)),
      storage: {},
      total: sessions.size
    }),
    '/api/status': () => ({ mode, ok: true, sessions: sessions.size }),
    '/api/tools/terminal/backends': () => ({
      active: 'local',
      backends: [{ active: true, detail: '', description: 'local shell', label: 'Local', name: 'local', status: 'ready' }]
    })
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (process.env.MOCK_AUTHORITY_DEBUG) {
      console.error(`[mock-authority] HTTP ${req.method} ${url.pathname}${url.search}`)
    }

    const authed =
      req.headers.authorization === `Bearer ${token}` ||
      req.headers['x-hermes-session-token'] === token ||
      url.searchParams.get('token') === token

    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    // Health is probed unauthenticated first — it reports whether auth is
    // needed rather than demanding it (matches the real backend's contract).
    if (url.pathname === '/api/health') {
      json(200, { auth_required: Boolean(token), displayVersion: '0.0.0-mock-authority', ok: true, version: '0.0.0' })

      return
    }

    if (!authed) {
      json(401, { detail: 'unauthorized' })

      return
    }

    const route = httpRoutes[url.pathname]

    if (route) {
      json(200, route())

      return
    }

    // Session REST reads — the canonical client's recovery leg after a replay
    // epoch change: re-read the authoritative transcript instead of trusting a
    // divergent local tail.
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(\/(latest-descendant|messages|timeline))?$/)

    if (sessionMatch) {
      const session = sessions.get(decodeURIComponent(sessionMatch[1]))

      if (!session) {
        json(404, { detail: 'session not found' })

        return
      }

      const sub = sessionMatch[3]

      if (sub === 'messages') {
        const limitParam = Number(url.searchParams.get('limit') ?? '120')
        const limit = Number.isFinite(limitParam) ? limitParam : 120

        const rows = session.messages.slice(-limit).map(r => ({
          content: r.text,
          id: r.row_id,
          role: r.role,
          row_id: r.row_id,
          text: r.text,
          timestamp: r.timestamp
        }))

        json(200, {
          messages: rows,
          pagination: { limit, offset: 0, order: url.searchParams.get('order') ?? 'latest', returned: rows.length },
          profile: 'default',
          session_id: session.id
        })
      } else if (sub === 'timeline') {
        json(200, {
          entries: session.messages
            .filter(r => r.role === 'user')
            .map(r => ({ preview: r.text, row_id: r.row_id, timestamp: r.timestamp })),
          pagination: { after_row_id: 0, limit: 500, next_cursor: null, returned: session.messages.length },
          profile: 'default',
          session_id: session.id
        })
      } else if (sub === 'latest-descendant') {
        json(200, { changed: false, path: [session.id], requested_session_id: session.id, session_id: session.id })
      } else {
        json(200, sessionRow(session))
      }

      return
    }

    json(404, { detail: 'not found' })

    if (process.env.MOCK_AUTHORITY_DEBUG) {
      console.error(`[mock-authority] HTTP 404 ${req.method} ${url.pathname}`)
    }
  })

  server.on('upgrade', (req, upgradeSocket, head) => {
    const raw = upgradeSocket as net.Socket
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (process.env.MOCK_AUTHORITY_DEBUG) {
      console.error(`[mock-authority] WS upgrade ${url.pathname}`)
    }

    const reject = (code: number) => {
      raw.write(`HTTP/1.1 ${code} Rejected\r\n\r\n`)
      raw.destroy()
    }

    if (!url.pathname.startsWith('/api/') || url.searchParams.get('token') !== token) {
      reject(401)

      return
    }

    const key = req.headers['sec-websocket-key']

    if (typeof key !== 'string') {
      reject(400)

      return
    }

    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
    raw.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    )

    if (head?.length) {
      raw.unshift(head)
    }

    // Secondary event sockets (kanban etc.) are accepted and held open; they
    // carry no session authority traffic in this fixture.
    if (url.pathname !== '/api/ws') {
      const idle = new WsSocket(raw)
      raw.on('close', () => {
        idle.closed = true
      })

      return
    }

    const socket = new WsSocket(raw)
    sockets.add(socket)
    raw.on('close', () => {
      sockets.delete(socket)

      for (const s of sessions.values()) {
        s.owners.delete(socket)
      }
    })

    socket.onMessage(text => handleFrame(socket, text))
    socket.sendText(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'event',
        params: {
          payload: {
            change_events: true,
            heartbeat: true,
            replay_epoch: epoch,
            skin: { branding: { agent_name: 'Mock Authority' }, colors: {}, name: 'default' }
          },
          type: 'gateway.ready'
        }
      })
    )
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
  })

  const url = `http://127.0.0.1:${port}`

  return {
    admissions: () => [...admissions.values()],
    answerElsewhere: (requestId: string) => {
      const req = openRequests.get(requestId)

      if (!req) {
        return
      }

      openRequests.delete(requestId)
      const s = sessions.get(req.sid)

      if (s) {
        // Every OTHER viewer's copy of the card is withdrawn; the answering
        // surface is not on this socket set in the fixture topology.
        emit(s, 'request.cancel', { id: req.id, method: req.method, reason: 'answered_elsewhere' })
      }
    },
    close: () =>
      new Promise(done => {
        for (const socket of sockets) {
          socket.close()
        }

        server.close(() => done())
      }),
    dropNextSubmitAck: () => {
      dropNextAck = true
    },
    dropSockets: () => {
      for (const socket of [...sockets]) {
        socket.close()
      }
    },
    executions,
    expireReplay: () => {
      epoch = crypto.randomBytes(8).toString('hex')
    },
    holdTurns: (hold: boolean) => {
      holdTurns = hold
    },
    releaseTurns: () => {
      holdTurns = false

      for (const run of heldTurns.splice(0)) {
        run()
      }
    },
    mode,
    openServerRequest: openRequestFor,
    port,
    restart: () => {
      epoch = crypto.randomBytes(8).toString('hex')
      heldTurns.splice(0)

      for (const s of sessions.values()) {
        s.running = false
      }

      for (const admission of admissions.values()) {
        if (admission.status === 'running') {
          admission.status = 'unknown'
        }
      }

      for (const socket of [...sockets]) {
        socket.close()
      }

      if (mode === 'pooled') {
        sessions.clear()
        admissions.clear()
        openRequests.clear()
      }
    },
    sessionById: id => sessions.get(id),
    token,
    unhandled,
    url,
    wsUrl: `ws://127.0.0.1:${port}/api/ws?token=${token}`
  }
}
