/**
 * ACP adapter — any Agent Client Protocol agent as a bot.
 *
 * The repo already ships the *server* half (`acp_adapter/` — Hermes AS an
 * ACP agent for editors). This file is the *client* half: Bot Room as an
 * ACP client, driving `session/new` + `session/prompt` and consuming
 * `session/update` notifications — the same wire surface Zed speaks, so any
 * ACP-conformant agent (claude-code's acp mode, codex-acp, gemini-cli's,
 * `hermes acp` itself) works against it.
 *
 * Transport: JSON-RPC 2.0 over WebSocket (ACP's native transport is stdio —
 * unreachable from a browser — so the WS side expects a relay, e.g.
 * `hermes bot-relay --acp <cmd>` bridging ws↔stdio). The `AcpTransport`
 * interface below is the ONE seam to swap: give it a stdio relay, a
 * WebTransport, or a chrome-native-messaging port and nothing else changes.
 *
 * Page control: ACP has no browser verb of its own, so the adapter uses the
 * prompt-injection channel — a preamble teaches the agent to emit
 * `<page_action>{...}</page_action>` blocks inline; they are parsed out of
 * `agent_message_chunk` deltas (spanning chunk boundaries safely), executed
 * in the tab, and stripped from the visible reply. Works on any ACP agent
 * with zero server cooperation.
 *
 * Agent→client requests (`session/request_permission`, `fs/read_text_file`,
 * `fs/write_text_file`, `terminal/*`) are declined politely — Bot Room has
 * no FS/terminal to grant. See ADAPTER-TODO at bottom.
 */

import type { Bot, GenericHarnessConfig } from '../../shared/types'
import type { Harness, TaskCallbacks, TaskResult } from '../harness'

import { JsonSocket } from './relay'
import { cfgBots, systemPromptFor } from './util'

// ── transport seam ──────────────────────────────────────────────────────────

/** The one swap point: anything that can carry JSON-RPC request/response +
 *  server notifications + server→client requests is an ACP transport. */
export interface AcpTransport {
  connect(): Promise<void>
  request<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T>
  notify(method: string, params: Record<string, unknown>): void
  onNotification: ((method: string, params: Record<string, unknown>) => void) | null
  /** Answer agent→client requests; throw to reply a JSON-RPC error. */
  onRequest:
    | ((id: number | string, method: string, params: Record<string, unknown>) => Promise<unknown>)
    | null
  onClose: (() => void) | null
  close(): void
}

interface PendingReq {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** WebSocket transport — JsonSocket does liveness/reconnect. */
export class WsAcpTransport implements AcpTransport {
  onNotification: AcpTransport['onNotification'] = null
  onRequest: AcpTransport['onRequest'] = null
  onClose: (() => void) | null = null

  private sock: JsonSocket
  private seq = 0
  private pending = new Map<number | string, PendingReq>()

  constructor(url: string, label = 'acp') {
    this.sock = new JsonSocket(url, { label })
    this.sock.onFrame = f => this.route(f)

    this.sock.onClose = () => {
      this.failAll(new Error('acp transport closed'))
      this.onClose?.()
    }
  }

  connect(): Promise<void> {
    return this.sock.connect()
  }

  async request<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs = 60000): Promise<T> {
    await this.connect()
    const id = ++this.seq

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`acp ${method}: timeout`))
      }, timeoutMs)

      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })

      if (!this.sock.send({ jsonrpc: '2.0', id, method, params })) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new Error('acp transport not open'))
      }
    })
  }

  notify(method: string, params: Record<string, unknown>) {
    this.sock.send({ jsonrpc: '2.0', method, params })
  }

  private route(frame: Record<string, unknown>) {
    const hasId = 'id' in frame && frame['id'] !== undefined && frame['id'] !== null
    const hasMethod = typeof frame['method'] === 'string'

    if (hasMethod && hasId) {
      // agent→client request — answer it (or error it if no handler).
      const id = frame['id'] as number | string
      const method = String(frame['method'])
      const params = (frame['params'] ?? {}) as Record<string, unknown>

      void (async () => {
        try {
          const result = this.onRequest
            ? await this.onRequest(id, method, params)
            : undefined

          this.sock.send({ jsonrpc: '2.0', id, result: result ?? null })
        } catch (e) {
          this.sock.send({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: e instanceof Error ? e.message : String(e) },
          })
        }
      })()

      return
    }

    if (hasMethod) {
      this.onNotification?.(String(frame['method']), (frame['params'] ?? {}) as Record<string, unknown>)

      return
    }

    if (hasId) {
      const id = frame['id'] as number | string
      const p = this.pending.get(id)

      if (!p) {return}
      this.pending.delete(id)
      clearTimeout(p.timer)

      if (frame['error']) {
        const err = frame['error'] as { code?: number; message?: string }
        p.reject(new Error(err.message || `acp error ${err.code ?? '?'}`))
      } else {
        p.resolve(frame['result'])
      }
    }
  }

  private failAll(e: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(e)
    }

    this.pending.clear()
  }

  close() {
    this.sock.close()
  }
}

// ── <page_action> marker parsing ────────────────────────────────────────────

const MARKER_OPEN = '<page_action>'
const MARKER_CLOSE = '</page_action>'

/** Longest suffix of `s` that is a prefix of `pat` — how a marker split
 *  across streamed chunks is held back until the rest arrives. */
function splitTailLen(s: string, pat: string): number {
  const max = Math.min(s.length, pat.length - 1)

  for (let n = max; n > 0; n--) {
    if (s.endsWith(pat.slice(0, n))) {return n}
  }

  return 0
}

/**
 * Incremental tag-stripper for the page_action marker channel. Feed text
 * chunks; emits visible text via `emit`, complete marker payloads via
 * `fire`. `flush()` disposes of the tail at turn end (an unterminated marker
 * is dropped — a malformed tail visible in chat is worse than a lost one).
 */
class MarkerParser {
  private buf = ''
  private inMarker = false

  constructor(
    private emit: (text: string) => void,
    private fire: (json: string) => void,
  ) {}

  feed(chunk: string) {
    this.buf += chunk

    for (;;) {
      if (!this.inMarker) {
        const i = this.buf.indexOf(MARKER_OPEN)

        if (i < 0) {
          const hold = splitTailLen(this.buf, MARKER_OPEN)

          if (hold === 0) {
            this.emit(this.buf)
            this.buf = ''
          } else {
            this.emit(this.buf.slice(0, -hold))
            this.buf = this.buf.slice(-hold)
          }

          return
        }

        this.emit(this.buf.slice(0, i))
        this.buf = this.buf.slice(i + MARKER_OPEN.length)
        this.inMarker = true
      } else {
        const j = this.buf.indexOf(MARKER_CLOSE)

        if (j < 0) {return}
        this.fire(this.buf.slice(0, j))
        this.buf = this.buf.slice(j + MARKER_CLOSE.length)
        this.inMarker = false
      }
    }
  }

  /** Turn end: flush any complete-looking pending marker; drop a dangling
   *  partial (visible garbage is worse than a dropped action). */
  flush() {
    if (!this.inMarker && this.buf) {
      this.emit(this.buf)
    }

    this.buf = ''
    this.inMarker = false
  }
}

const PAGE_ACTION_PREAMBLE = [
  '[BOT ROOM — page control]',
  'You are running inside the user\u2019s browser via the Bot Room extension.',
  'To act on the web page the user is looking at, emit an inline block:',
  '  <page_action>{"action":"<action>","arguments":{...}}</page_action>',
  'Actions: navigate {url} | click {selector|text} | type {selector,text} |',
  'press {key} | scroll {dx,dy|selector} | back {} | snapshot {} |',
  'screenshot {} | read {selector|text} | tabs {} | tab_activate {tabId} |',
  'highlight {selector,ms} | annotate {selector,label} |',
  'mascot.perform {action:dance|wave|spin|jump|celebrate|point,x?,y?} |',
  'web.fetch {url}. These blocks are consumed by the client — they never',
  'appear in your visible reply. The action runs in the user\u2019s real tab.',
  '[/BOT ROOM]',
  '',
].join('\n')

// ── adapter ─────────────────────────────────────────────────────────────────

interface AcpSession {
  sessionId: string
}

export class AcpHarness implements Harness {
  readonly kind = 'acp'
  readonly pageControl = true
  readonly id: string
  readonly name: string

  private transport: AcpTransport
  private bots: Bot[]
  private sessions = new Map<string, AcpSession>()
  private initialized = false
  private updateCbs = new Map<string, (params: Record<string, unknown>) => void>()

  constructor(private cfg: GenericHarnessConfig, transport?: AcpTransport) {
    this.id = cfg.id
    this.name = cfg.name
    this.bots = cfgBots(cfg, true)
    // TRANSPORT-SWAP: default WS to cfg.baseUrl; inject a stdio-relay or
    // chrome.runtime.connectNative transport here to change carriers without
    // touching the protocol layer.
    this.transport = transport ?? new WsAcpTransport(cfg.baseUrl || 'ws://127.0.0.1:9944', `acp:${cfg.id}`)
    this.transport.onNotification = (m, p) => this.onNotify(m, p)
    this.transport.onRequest = (id, m, p) => this.onAgentRequest(id, m, p)

    this.transport.onClose = () => {
      this.initialized = false
      // Sessions belong to the agent process; a reconnect to the same agent
      // can resume them, a different one can't — keep ids, let
      // session/prompt's "session not found" error trigger re-new lazily.
    }
  }

  async listBots() {
    return this.bots
  }

  private async ensureInit() {
    if (this.initialized) {return}
    await this.transport.connect()

    const res = await this.transport.request<Record<string, unknown>>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'bot-room', version: '0.1.0' },
    })

    // If the agent advertises auth methods and the config carries a key (the
    // "method id" slot for this kind), authenticate before session work.
    const methods = (res['authMethods'] ?? []) as { id?: string }[]

    if (methods.length > 0 && this.cfg.apiKey) {
      const pick = methods.find(m => m.id === this.cfg.apiKey)?.id ?? methods[0]?.id

      if (pick) {
        try {
          await this.transport.request('authenticate', { methodId: pick }, 120000)
        } catch (e) {
          console.warn(`[acp:${this.id}] authenticate failed`, e)
        }
      }
    }

    this.initialized = true
  }

  private async sessionFor(botRef: string): Promise<string> {
    const cached = this.sessions.get(botRef)

    if (cached) {return cached.sessionId}

    const created = await this.transport.request<{ sessionId?: string; session_id?: string }>(
      'session/new',
      { cwd: '/', mcpServers: [] },
    )

    const sessionId = created.sessionId ?? created.session_id

    if (!sessionId) {throw new Error('acp session/new returned no sessionId')}
    this.sessions.set(botRef, { sessionId })

    // Best-effort model pin when configured (`model` field = modelId).
    if (this.cfg.model) {
      void this.transport
        .request('session/set_model', { sessionId, modelId: this.cfg.model })
        .catch(() => undefined)
    }

    return sessionId
  }

  async send(botRef: string, text: string, cb: TaskCallbacks): Promise<TaskResult> {
    await this.ensureInit()
    const sessionId = await this.sessionFor(botRef)
    const persona = systemPromptFor(this.cfg, botRef)

    let visible = ''
    let actionsRun = 0

    const parser = new MarkerParser(
      chunk => {
        visible += chunk
        cb.onDelta?.(chunk)
      },
      json => {
        actionsRun++
        void this.runPageAction(json, cb)
      },
    )

    this.updateCbs.set(sessionId, params => {
      const update = (params['update'] ?? {}) as Record<string, unknown>
      const kind = String(update['sessionUpdate'] ?? update['session_update'] ?? '')

      if (kind === 'agent_message_chunk' || kind === 'user_message_chunk') {
        const content = (update['content'] ?? {}) as Record<string, unknown>

        if (content['type'] === 'text' && typeof content['text'] === 'string') {
          parser.feed(content['text'])
        }
      } else if (kind === 'agent_thought_chunk') {
        cb.onStatus?.('Thinking…')
      } else if (kind === 'tool_call' || kind === 'tool_call_update') {
        const title = update['title'] ?? update['kind'] ?? 'tool'
        cb.onStatus?.(`Running ${String(title)}…`)
      } else if (kind === 'plan') {
        cb.onStatus?.('Planning…')
      }
      // usage_update / available_commands_update / current_mode_update:
      // consumed silently for now.
    })

    try {
      const res = await this.transport.request<{ stopReason?: string; stop_reason?: string }>(
        'session/prompt',
        {
          sessionId,
          prompt: [{ type: 'text', text: `${persona ? `${persona}\n\n` : ''}${PAGE_ACTION_PREAMBLE}${text}` }],
        },
        600000,
      )

      parser.flush()
      const stopReason = res?.stopReason ?? res?.stop_reason ?? 'end_turn'

      return { text: visible.trim() || `(${stopReason})`, actionsRun }
    } catch (e) {
      parser.flush()

      if (e instanceof Error && /session/i.test(e.message)) {
        // Agent probably restarted and lost the session — drop the cached id
        // so the next send re-news it instead of failing forever.
        this.sessions.delete(botRef)
      }

      throw e
    } finally {
      this.updateCbs.delete(sessionId)
    }
  }

  private onNotify(method: string, params: Record<string, unknown>) {
    if (method !== 'session/update') {return}
    const sessionId = String(params['sessionId'] ?? params['session_id'] ?? '')
    this.updateCbs.get(sessionId)?.(params)
  }

  /** Agent→client requests. Bot Room owns no filesystem/terminal and has no
   *  approval UI, so everything is declined politely rather than left
   *  hanging — mirrors rpc.ts's refusal of gateway `req` frames. */
  private async onAgentRequest(
    _id: number | string,
    method: string,
    _params: Record<string, unknown>,
  ): Promise<unknown> {
    // ADAPTER-TODO: surface `session/request_permission` as a room-level
    // approval chip (content/panel.ts owns interactive UX; the SW needs a
    // permission pending-request lane before this can ask the user).
    if (method === 'session/request_permission') {
      return { outcome: { outcome: 'cancelled' } }
    }

    throw new Error(`bot-room: no handler for agent request '${method}'`)
  }

  private async runPageAction(json: string, cb: TaskCallbacks) {
    let parsed: Record<string, unknown>

    try {
      parsed = JSON.parse(json)
    } catch {
      return // malformed marker — already stripped from visible text
    }

    const action = String(parsed['action'] ?? '')
    const args = (parsed['arguments'] ?? parsed) as Record<string, unknown>

    if (!action) {return}

    await new Promise<void>(resolve => {
      cb.onPageAction?.(action, args, () => resolve())
      // onPageAction may be absent (dead channel) — don't hang the parser.
      setTimeout(resolve, 15000)
    })
  }

  async interrupt(botRef: string): Promise<void> {
    const session = this.sessions.get(botRef)

    if (!session) {return}
    this.transport.notify('session/cancel', { sessionId: session.sessionId })
  }

  dispose() {
    this.sessions.clear()
    this.updateCbs.clear()
    this.transport.close()
  }
}
