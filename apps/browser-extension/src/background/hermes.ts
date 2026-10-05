/**
 * Hermes harness adapter — bots are profiles on a `hermes serve`/`dashboard`
 * backend; each bot's conversation is its canonical "Bot Chat" session
 * (resolved by title server-side, reported as `canonical_session` on
 * `profiles.list`).
 *
 * Task flow: profiles.list → canonical_session.resolved_id → session.resume
 * (mints the live runtime id without opening a tile) → prompt.submit → events
 * (`message.delta`, `status.update`, `tool.*`, `message.complete`) stream back
 * on the same socket.
 *
 * Page control: after resuming a session we `browser.controller.register` on
 * it; `browser.controller.command` events then carry the agent's `browser_*`
 * tool calls to us, we run them in the user's tab, and answer with
 * `browser.controller.result`.
 */

import type { Bot, BotStatus } from '../shared/types'

import type { Harness, TaskCallbacks, TaskResult } from './harness'
import { rid } from './harness'
import type { GatewayRpc, RpcEvent } from './rpc'

interface ProfileRow {
  name: string
  display_name?: string
  canonical_session?: { resolved_id?: string; id?: string; last_active?: number } | null
  worker_session?: { id?: string; last_active?: number } | null
  ui_meta?: Record<string, unknown> | null
}

interface PageActionBridge {
  run(action: string, args: Record<string, unknown>, meta: { sessionId: string; commandId: string }): Promise<{ ok: boolean; result?: unknown; error?: string }>
}

export class HermesHarness implements Harness {
  readonly id = 'hermes'
  readonly kind = 'hermes'
  readonly name = 'Hermes'
  readonly pageControl = true

  private bots = new Map<string, Bot>()
  /** sessionId → botId for event fan-out. */
  private sessions = new Map<string, string>()
  /** botId → live session id (runtime id from session.resume/create). */
  private liveSessions = new Map<string, string>()
  private registeredControllers = new Set<string>()
  private pageBridge: PageActionBridge | null = null
  private statuses = new Map<string, Bot['status']>()
  private statusLines = new Map<string, string>()

  onBotsChanged: ((bots: Bot[]) => void) | null = null
  onBotStatus: ((bot: Bot) => void) | null = null

  constructor(
    private rpc: GatewayRpc,
    private profileColorFor: (name: string, uiMeta?: Record<string, unknown> | null) => string,
  ) {
    rpc.onEvent = ev => this.handleEvent(ev)
  }

  setPageBridge(bridge: PageActionBridge) {
    this.pageBridge = bridge
  }

  get identityPresent(): boolean {
    return this.rpc.hasIdentity
  }

  async listBots(): Promise<Bot[]> {
    const res = await this.rpc.call<{ profiles?: ProfileRow[]; rows?: ProfileRow[] }>(
      'profiles.list',
      { include_sessions: true },
      30000,
    )

    const rows = res.profiles ?? res.rows ?? []

    const bots: Bot[] = rows
      .filter(r => r.name && r.name !== 'default')
      .map(r => {
        const id = `hermes:${r.name}`
        const existing = this.bots.get(id)
        const status: BotStatus = this.statuses.get(id) ?? (r.worker_session ? 'working' : 'idle')

        const bot: Bot = {
          id,
          harnessId: this.id,
          name: r.name,
          displayName: r.display_name || r.name,
          color: this.profileColorFor(r.name, r.ui_meta),
          status,
          statusLine: this.statusLines.get(id) ?? existing?.statusLine,
          pageControl: this.rpc.hasIdentity,
          ref: r.name,
        }

        this.bots.set(id, bot)
        const sid = r.canonical_session?.resolved_id

        if (sid) {this.sessions.set(sid, id)}

        return bot
      })

    return bots
  }

  /** Resolve the bot's canonical Bot Chat to a live runtime session id. */
  private async liveSessionFor(botId: string, profile: string): Promise<string> {
    const cached = this.liveSessions.get(botId)

    if (cached) {return cached}

    // Canonical registry row (resolved to live tip) via profiles.list.
    const res = await this.rpc.call<{ profiles?: ProfileRow[] }>('profiles.list', {
      include_sessions: true,
    })

    const row = (res.profiles ?? []).find(r => r.name === profile)
    const stored = row?.canonical_session?.id ?? row?.canonical_session?.resolved_id
    let sessionId: string

    if (stored) {
      try {
        const resumed = await this.rpc.call<{ session_id: string }>('session.resume', {
          session_id: stored,
          profile,
          lazy: true,
          omit_messages: true,
          close_on_disconnect: false,
        })

        sessionId = resumed.session_id
      } catch {
        sessionId = await this.createCanonical(profile)
      }
    } else {
      // Fall back to the title lookup before minting (adopt-before-create).
      const list = await this.rpc.call<{ sessions?: { id: string }[] }>('session.list', {
        profile,
        title: 'Bot Chat',
        include_hidden: true,
        limit: 1,
      })

      const found = list.sessions?.[0]?.id
      sessionId = found
        ? (await this.rpc.call<{ session_id: string }>('session.resume', {
            session_id: found,
            profile,
            lazy: true,
            omit_messages: true,
            close_on_disconnect: false,
          })).session_id
        : await this.createCanonical(profile)
    }

    this.liveSessions.set(botId, sessionId)
    this.sessions.set(sessionId, botId)
    await this.ensureController(sessionId, botId)

    return sessionId
  }

  private async createCanonical(profile: string): Promise<string> {
    const created = await this.rpc.call<{ session_id: string }>('session.create', {
      profile,
      title: 'Bot Chat',
      hidden: true,
      source: 'bot-room',
    })

    return created.session_id
  }

  private async ensureController(sessionId: string, botId: string) {
    if (!this.rpc.hasIdentity || this.registeredControllers.has(sessionId)) {return}

    try {
      await this.rpc.call('browser.controller.register', {
        session_id: sessionId,
        controller_id: `bot-room-${botId}`,
        browser_profile_id: 'bot-room',
        protocol_version: 1,
        capabilities: [
          'controller.noop', 'browser_back', 'browser_click', 'browser_navigate',
          'browser_press', 'browser_screenshot', 'browser_scroll',
          'browser_snapshot', 'browser_tab_activate', 'browser_tabs', 'browser_type',
        ],
      })
      this.registeredControllers.add(sessionId)
    } catch {
      // Not fatal — page control just stays unavailable for this session.
    }
  }

  async send(botRef: string, text: string, cb: TaskCallbacks): Promise<TaskResult> {
    const botId = `hermes:${botRef}`
    const sessionId = await this.liveSessionFor(botId, botRef)
    this.sessions.set(sessionId, botId)
    this.setStatus(botId, 'working', 'Thinking…')

    const reply = new Promise<TaskResult>((resolve, reject) => {
      const key = `${sessionId}:reply`

      const onEvent = (ev: RpcEvent) => {
        if (ev.session_id !== sessionId) {return}

        if (ev.type === 'message.delta' && ev.payload) {
          const t = (ev.payload as { text?: string }).text

          if (t) {cb.onDelta?.(t)}
        } else if (ev.type === 'status.update' && ev.payload) {
          cb.onStatus?.(String((ev.payload as { text?: string }).text ?? ''))
        } else if (ev.type === 'message.complete') {
          cleanup()
          const p = (ev.payload ?? {}) as { text?: unknown; error?: string | null }
          resolve({
            text: typeof p.text === 'string' ? p.text : (p.error ?? '(done)'),
          })
        }
      }

      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('bot timed out'))
      }, 600000)

      const cleanup = () => {
        clearTimeout(timer)
        this.replyWatchers.delete(key)
      }

      this.replyWatchers.set(key, onEvent)
    })

    await this.rpc.call('prompt.submit', { session_id: sessionId, text }, 30000)
    const result = await reply
    this.setStatus(botId, 'idle')

    return result
  }

  private replyWatchers = new Map<string, (ev: RpcEvent) => void>()

  async interrupt(botRef: string): Promise<void> {
    const sessionId = this.liveSessions.get(`hermes:${botRef}`)

    if (!sessionId) {return}

    try {
      await this.rpc.call('session.interrupt', { session_id: sessionId }, 10000)
    } catch { /* best effort */ }
  }

  private setStatus(botId: string, status: Bot['status'], line?: string) {
    const bot = this.bots.get(botId)

    if (!bot) {return}
    bot.status = status

    if (line !== undefined) {bot.statusLine = line}
    this.statuses.set(botId, status)
    this.onBotStatus?.({ ...bot })
  }

  private handleEvent(ev: RpcEvent) {
    // Reply watchers first (they own message.complete).
    if (ev.session_id) {
      const watcher = this.replyWatchers.get(`${ev.session_id}:reply`)
      watcher?.(ev)
      const botId = this.sessions.get(ev.session_id)

      if (botId) {
        if (ev.type === 'status.update' && ev.payload?.text) {
          this.setStatus(botId, 'working', String(ev.payload.text))
        } else if (ev.type === 'message.start') {
          this.setStatus(botId, 'working', 'Replying…')
        } else if (ev.type === 'tool.start' && ev.payload?.name) {
          this.setStatus(botId, 'working', `Running ${String(ev.payload.name).replace(/_/g, ' ')}…`)
        } else if (ev.type === 'message.complete') {
          this.setStatus(botId, 'idle', '')
        }
      }
    }

    // Broker frames arrive as `event` notifications with the FRAME_* method in
    // `type` (see tui_gateway/methods_browser_control._broker_event_writer).
    if (ev.type === 'browser.controller.command' && ev.payload && ev.session_id) {
      const p = ev.payload as {
        command_id: string
        action: string
        arguments: Record<string, unknown>
      }

      void this.runControllerCommand(ev.session_id, p)
    } else if (ev.type === 'browser.controller.cancel') {
      // Page actions are short and synchronous here; nothing to cancel.
    }
  }

  private async runControllerCommand(
    sessionId: string,
    cmd: { command_id: string; action: string; arguments: Record<string, unknown> },
  ) {
    const botId = this.sessions.get(sessionId)

    if (botId) {this.setStatus(botId, 'working', `On your page: ${cmd.action.replace(/^browser_/, '')}…`)}
    let out: { ok: boolean; result?: unknown; error?: string }

    if (!this.pageBridge) {
      out = { ok: false, error: 'no page attached' }
    } else {
      out = await this.pageBridge.run(cmd.action, cmd.arguments, {
        sessionId,
        commandId: cmd.command_id,
      })
    }

    try {
      await this.rpc.call('browser.controller.result', {
        session_id: sessionId,
        command_id: cmd.command_id,
        ok: out.ok,
        result: out.result ?? null,
        error: out.error ?? null,
      })
    } catch { /* transport gone — broker times out on its own */ }
  }

  dispose() {
    this.replyWatchers.clear()
    this.rpc.close()
  }
}

export { rid }
