/**
 * Muse adapter — persona/character endpoints as bots.
 *
 * The contract for "character API as a harness": a single POST that takes
 * text and gives back a reply, plus optional stage directions that drive the
 * mascot. It exists for the Muse-style persona servers — a local character
 * card server, a roleplay backend, a companion endpoint — anything that can
 * honor the {text}→{reply} shape.
 *
 * ── THE PERSONA CONTRACT ──────────────────────────────────────────────────
 *   POST {baseUrl}            Content-Type: application/json
 *   Authorization: Bearer <apiKey>  (only when apiKey is configured)
 *
 *   Request:
 *     {
 *       bot: string                       // the cfg.bots name addressed
 *       text: string                      // user/room message
 *       persona?: string                  // the bot's configured systemPrompt
 *       model?: string                    // cfg.model, if set
 *       history: {role:'user'|'bot', content:string}[]   // last 20 msgs
 *     }
 *
 *   Response (200, JSON) — field names are tolerant:
 *     reply: string            // OR text | message | content
 *     emotion?: string         // optional mood → mascot.perform when it
 *                              // matches a perform verb (dance, wave, spin,
 *                              // jump, celebrate, sleep, point, talk)
 *     action?:  string | object | object[]   // optional stage direction(s):
 *                              //   "dance"                               — a verb
 *                              //   {"name":"point","x":120,"y":40}         — verb+args
 *                              //   [{"name":"wave"},{"name":"talk"}]       — a list
 *                              // each becomes onPageAction('mascot.perform',…)
 *
 * Non-200 / non-JSON → send() rejects; the room shows "(unreachable: …)".
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { Bot, GenericHarnessConfig } from '../../shared/types'
import type { Harness, TaskCallbacks, TaskResult } from '../harness'

import { cfgBots, systemPromptFor } from './util'

/** Verbs the content side knows how to perform (mascot3d.ts vocabulary). */
const PERFORM_VERBS = new Set([
  'dance', 'wave', 'spin', 'jump', 'celebrate', 'sleep', 'point', 'talk',
])

interface MuseReply {
  reply?: string
  text?: string
  message?: string
  content?: string
  emotion?: string
  action?: unknown
  actions?: unknown
}

export class MuseHarness implements Harness {
  readonly kind = 'muse'
  /** Stage directions only — a persona endpoint can't navigate or click. */
  readonly pageControl = false
  readonly id: string
  readonly name: string

  private bots: Bot[]
  private histories = new Map<string, { role: 'user' | 'bot'; content: string }[]>()

  constructor(private cfg: GenericHarnessConfig) {
    this.id = cfg.id
    this.name = cfg.name
    this.bots = cfgBots(cfg, false)
  }

  async listBots() {
    return this.bots
  }

  async send(botRef: string, text: string, cb: TaskCallbacks): Promise<TaskResult> {
    const history = this.histories.get(botRef) ?? []
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (this.cfg.apiKey) {headers['Authorization'] = `Bearer ${this.cfg.apiKey}`}

    const res = await fetch(this.cfg.baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        bot: botRef,
        text,
        persona: systemPromptFor(this.cfg, botRef) || undefined,
        model: this.cfg.model || undefined,
        history: history.slice(-20),
      }),
    })

    if (!res.ok) {throw new Error(`${this.cfg.name} ${res.status}: ${(await res.text()).slice(0, 200)}`)}

    const body = (await res.json()) as MuseReply
    const reply = body.reply ?? body.text ?? body.message ?? body.content ?? ''

    if (!reply) {throw new Error(`${this.cfg.name}: empty persona reply`)}

    history.push({ role: 'user', content: text }, { role: 'bot', content: reply })
    this.histories.set(botRef, history)

    cb.onDelta?.(reply)

    const directions: unknown[] = [
      ...(body.emotion ? [body.emotion] : []),
      ...(Array.isArray(body.action) ? body.action : body.action ? [body.action] : []),
      ...(Array.isArray(body.actions) ? body.actions : []),
    ]

    let actionsRun = 0

    for (const d of directions) {
      const spec = this.toPerformSpec(d)

      if (!spec) {continue}
      actionsRun++
      // Stage directions are fire-and-forget — the mascot performs, nobody
      // is waiting on a result.
      cb.onPageAction?.('mascot.perform', spec, () => undefined)
    }

    return { text: reply, actionsRun }
  }

  /** Normalize an emotion/action payload into a mascot.perform arg object. */
  private toPerformSpec(d: unknown): Record<string, unknown> | null {
    if (typeof d === 'string') {
      const verb = d.toLowerCase()

      return PERFORM_VERBS.has(verb) ? { action: verb } : null
    }

    if (d && typeof d === 'object') {
      const o = d as Record<string, unknown>
      const verb = String(o['name'] ?? o['action'] ?? o['perform'] ?? '').toLowerCase()

      if (!PERFORM_VERBS.has(verb)) {return null}
      const { name: _n, action: _a, perform: _p, ...rest } = o

      return { action: verb, ...rest }
    }

    return null
  }

  dispose() {
    this.histories.clear()
  }
}
