/**
 * Generic OpenAI-compatible harness — the "bring any bot" adapter.
 *
 * Point it at any `/chat/completions`-shaped endpoint (Grok's api.x.ai,
 * OpenRouter, ollama, a custom agent server like OpenClaw — anything with
 * URL + key + model). Each configured bot is one virtual agent with its own
 * system prompt and conversation memory held in the service worker.
 *
 * Page control: the tool spec exposes `page_action` (navigate/click/type/
 * scroll/press/back/tabs/snapshot/screenshot). Tool calls are executed in
 * the user's tab via the room's page bridge and results fed back — the same
 * actions the Hermes `browser.controller.*` lane carries, just routed through
 * the model's own tool loop instead of the broker.
 */

import type { Bot, GenericHarnessConfig } from '../shared/types'

import type { Harness, TaskCallbacks, TaskResult } from './harness'

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
            'tabs', 'tab_activate', 'snapshot', 'screenshot',
          ],
        },
        arguments: {
          type: 'object',
          description:
            'navigate:{url} click:{selector|x,y|text} type:{selector?,text} press:{key} ' +
            'scroll:{dx,dy|selector} tabs:{} tab_activate:{tabId} snapshot:{} screenshot:{}',
        },
      },
      required: ['action'],
    },
  },
}

export class OpenAIHarness implements Harness {
  readonly kind = 'openai-http'
  readonly pageControl = true
  readonly id: string
  readonly name: string
  private histories = new Map<string, ChatMessage[]>()
  private bots: Bot[]

  constructor(private cfg: GenericHarnessConfig) {
    this.id = cfg.id
    this.name = cfg.name
    this.bots = cfg.bots.map(b => ({
      id: `${cfg.id}:${b.name}`,
      harnessId: cfg.id,
      name: b.name,
      displayName: b.name,
      color: '#7c5cff',
      status: 'idle' as const,
      pageControl: true,
      ref: b.name,
    }))
  }

  async listBots(): Promise<Bot[]> {
    return this.bots
  }

  private systemPromptFor(ref: string): string {
    const bot = this.cfg.bots.find(b => b.name === ref)

    return (
      (bot?.systemPrompt ? `${bot.systemPrompt}\n\n` : '') +
      'You are a bot living inside the user\u2019s browser via the Hermes Bot Room ' +
      'extension. You can see and act on the page they are looking at through the ' +
      'page_action tool — use it when the task needs the page. Keep replies short ' +
      'and conversational; you are one bot in a room of bots.'
    )
  }

  async send(botRef: string, text: string, cb: TaskCallbacks): Promise<TaskResult> {
    const history = this.histories.get(botRef) ?? [
      { role: 'system', content: this.systemPromptFor(botRef) } as ChatMessage,
    ]

    history.push({ role: 'user', content: text })
    this.histories.set(botRef, history)

    let actionsRun = 0

    for (let hop = 0; hop < 8; hop++) {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
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
        const text = msg.content ?? ''

        if (text) {cb.onDelta?.(text)}

        return { text, actionsRun }
      }

      for (const call of calls) {
        if (call.function.name !== 'page_action') {continue}
        let args: Record<string, unknown> = {}

        try {
          args = JSON.parse(call.function.arguments || '{}')
        } catch { /* malformed args → tell the model */ }

        const action = String(args.action ?? '')
        const actionArgs = (args.arguments ?? args) as Record<string, unknown>
        let result: unknown

        try {
          result = await new Promise(resolve =>
            cb.onPageAction?.(action, actionArgs, resolve),
          )
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

export function makeOpenAIHarness(cfg: GenericHarnessConfig): OpenAIHarness {
  return new OpenAIHarness(cfg)
}
