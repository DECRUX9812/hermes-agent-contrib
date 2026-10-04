/**
 * OpenClaw adapter — the agent framework's Gateway as a bot roster.
 *
 * OpenClaw (`openclaw gateway`, default port 18789) multiplexes a WS control
 * plane + HTTP APIs on one port. This adapter uses the stable REST surface:
 * `GET /v1/models` for the roster (upstream returns `openclaw`,
 * `openclaw/default`, and `openclaw/<agent>` per configured agent) and
 * `POST /v1/chat/completions` for turns — each request runs as a normal
 * gateway agent run, so tools/permissions/route config match the user's
 * gateway. Auth is the operator token (`gateway.auth.token` /
 * OPENCLAW_GATEWAY_TOKEN) as a Bearer credential.
 *
 * ── ENDPOINTS (track upstream here) ───────────────────────────────────────
 *   GET    {base}/v1/models            roster (agent-first: 'openclaw/*' ids)
 *   GET    {base}/v1/models/{id}       one agent
 *   POST   {base}/v1/chat/completions  turn (OpenAI-shaped; tools supported)
 *   POST   {base}/v1/responses         alt turn API — opt-in upstream
 *                                      (`gateway.http.endpoints.responses`),
 *                                      unused by default
 *   POST   {base}/tools/invoke         direct tool invoke (unused)
 *   WS     {base}                      full control plane (role+scope
 *                                      handshake, TypeBox schemas in
 *                                      packages/gateway-protocol/schema.ts);
 *                                      pinned by protocol version — adopt
 *                                      deliberately, not by accident
 *   Upstream: https://docs.openclaw.ai/gateway
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Page control rides the same `page_action` tool spec as the OpenAI adapter —
 * chat/completions carries tools, and the gateway's agent loop honors them.
 */

import type { Bot, GenericHarnessConfig } from '../../shared/types'
import type { Harness, TaskCallbacks, TaskResult } from '../harness'

import { cfgBots, systemPromptFor } from './util'

const ENDPOINTS = {
  models: '/v1/models',
  chatCompletions: '/v1/chat/completions',
} as const

/** Upstream ids look like `openclaw`, `openclaw/default`, `openclaw/<agent>`. */
const MODEL_PREFIX = 'openclaw'

const PAGE_ACTION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'page_action',
    description:
      'Act on the web page the user is looking at right now. Use this to navigate, click, type, scroll, read the page, switch tabs, or screenshot. The action executes in the user\u2019s real browser tab.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'navigate', 'click', 'type', 'press', 'scroll', 'back',
            'tabs', 'tab_activate', 'snapshot', 'screenshot', 'read',
            'compose', 'dom_hide', 'dom_insert', 'dom_style', 'highlight', 'annotate',
            'window.open', 'window.close', 'widget.open', 'mascot.perform', 'web.fetch',
          ],
        },
        arguments: { type: 'object' },
      },
      required: ['action'],
    },
  },
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
  tool_call_id?: string
}

/** Roster entry resolved from GET /v1/models. */
interface AgentModel {
  id: string
}

export class OpenClawHarness implements Harness {
  readonly kind = 'openclaw'
  readonly pageControl = true
  readonly id: string
  readonly name: string

  private histories = new Map<string, ChatMessage[]>()

  constructor(private cfg: GenericHarnessConfig) {
    this.id = cfg.id
    this.name = cfg.name
  }

  private base(): string {
    return this.cfg.baseUrl.replace(/\/+$/, '')
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }

    if (this.cfg.apiKey) {h['Authorization'] = `Bearer ${this.cfg.apiKey}`}

    return h
  }

  /**
   * Roster = the gateway's agent list. `openclaw/<agent>` → one bot each;
   * the bare `openclaw`/`openclaw/default` alias is included as the default
   * agent. When the endpoint is off/unreachable, fall back to cfg.bots so
   * the harness still answers with a config-level roster.
   */
  async listBots(): Promise<Bot[]> {
    // Polled by the room's roster refresh — no caching, so agents added to
    // the gateway show up on the next tick.
    try {
      const res = await fetch(`${this.base()}${ENDPOINTS.models}`, { headers: this.headers() })

      if (!res.ok) {throw new Error(`${res.status}`)}
      const data = (await res.json()) as { data?: AgentModel[] }

      const ids = (data.data ?? [])
        .map(m => m.id)
        .filter(id => id === MODEL_PREFIX || id.startsWith(`${MODEL_PREFIX}/`))

      if (ids.length === 0) {throw new Error('no openclaw agents in /v1/models')}

      const bots = ids.map(id => {
        const slug = id === MODEL_PREFIX ? 'default' : id.slice(MODEL_PREFIX.length + 1)
        const cfgBot = this.cfg.bots.find(b => b.name === slug) ?? this.cfg.bots[0]

        return {
          id: `${this.cfg.id}:${slug}`,
          harnessId: this.cfg.id,
          name: slug,
          displayName: slug === 'default' ? 'OpenClaw' : slug,
          color: '#ff7a45',
          status: 'idle' as const,
          pageControl: true,
          // ref carries the upstream model id — send() uses it verbatim.
          ref: id,
          statusLine: cfgBot ? undefined : 'agent',
        }
      })

      return bots
    } catch {
      // REST surface off or gateway down → config-level roster. ref is the
      // bot name; send() then routes through cfg.model (the default agent).
      return cfgBots(this.cfg, true)
    }
  }

  /** Model id a send goes through: roster bots carry `openclaw/<agent>` in
   *  ref; config-level bots use cfg.model (the gateway's default alias). */
  private modelFor(botRef: string): string {
    if (botRef.startsWith(`${MODEL_PREFIX}/`) || botRef === MODEL_PREFIX) {return botRef}

    return this.cfg.model || `${MODEL_PREFIX}/default`
  }

  async send(botRef: string, text: string, cb: TaskCallbacks): Promise<TaskResult> {
    const history = this.histories.get(botRef) ?? []
    const sys = systemPromptFor(this.cfg, botRef)

    // OpenClaw agents bring their own persona; a configured prompt rides
    // along as a system message only when the user wrote one.
    if (history.length === 0 && sys) {
      history.push({ role: 'system', content: sys })
    }

    history.push({ role: 'user', content: text })
    this.histories.set(botRef, history)

    let actionsRun = 0

    for (let hop = 0; hop < 8; hop++) {
      const res = await fetch(`${this.base()}${ENDPOINTS.chatCompletions}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.modelFor(botRef),
          messages: history,
          tools: [PAGE_ACTION_TOOL],
          stream: false,
        }),
      })

      if (!res.ok) {throw new Error(`${this.cfg.name} ${res.status}: ${(await res.text()).slice(0, 200)}`)}

      const data = (await res.json()) as {
        choices?: { message?: ChatMessage; finish_reason?: string }[]
      }

      const msg = data.choices?.[0]?.message

      if (!msg) {throw new Error(`${this.cfg.name}: empty reply`)}
      history.push(msg)

      const calls = msg.tool_calls ?? []

      if (calls.length === 0) {
        const out = msg.content ?? ''

        if (out) {cb.onDelta?.(out)}

        return { text: out, actionsRun }
      }

      for (const call of calls) {
        if (call.function.name !== 'page_action') {continue}
        let args: Record<string, unknown> = {}

        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch { /* malformed args → report as an error result */ }

        const action = String(args['action'] ?? '')
        const actionArgs = (args['arguments'] ?? args) as Record<string, unknown>
        let result: unknown

        try {
          result = await new Promise(resolve => cb.onPageAction?.(action, actionArgs, resolve))
          actionsRun++
        } catch (e) {
          result = { ok: false, error: String(e) }
        }

        history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result ?? { ok: false }),
        })
      }
    }

    return { text: '(action limit reached)', actionsRun }
  }

  dispose() {
    this.histories.clear()
  }
}
