/**
 * Shared wire + model types for the Bot Room extension.
 *
 * Three runtimes talk to each other:
 *   content script  (overlay + page actions, one per tab)
 *   service worker  (harness connections, rooms, broker dispatch)
 *   options page    (settings)
 *
 * Everything crossing a runtime boundary is one of the `*Msg` unions below.
 */

// ── persisted settings ──────────────────────────────────────────────────────

export interface HermesBackendConfig {
  /** http(s) base URL of `hermes serve`/`dashboard`, e.g. http://127.0.0.1:9443 */
  url: string
  /** Dashboard session token (legacy) or OAuth access token (gated mode). */
  token: string
}

export interface GenericHarnessConfig {
  id: string
  name: string
  /** Adapter kind: 'openai' chat-completions | 'acp' | 'cli-relay' | 'muse'.
   *  Presets set this; adapters resolve by kind. */
  kind?: string
  /** OpenAI-compatible base, e.g. https://api.x.ai/v1 — or ws://127.0.0.1 relay. */
  baseUrl: string
  apiKey: string
  /** "Model" field shared by every bot on this harness. */
  model: string
  /** displayName -> system prompt. One entry per virtual bot. */
  bots: { name: string; systemPrompt: string }[]
}

/** One-click presets shown on the options catalog. */
export interface HarnessPreset {
  kind: string
  name: string
  blurb: string
  baseUrl?: string
  model?: string
  needsKey: boolean
  bots: { name: string; systemPrompt: string }[]
}

export const HARNESS_PRESETS: HarnessPreset[] = [
  {
    kind: 'openai',
    name: 'Grok (xAI)',
    blurb: 'api.x.ai chat completions — Grokbot in your sidebar.',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3',
    needsKey: true,
    bots: [{ name: 'Grokbot', systemPrompt: 'You are Grokbot: fast, witty, slightly unhinged but helpful. Keep replies punchy.' }],
  },
  {
    kind: 'openai',
    name: 'OpenAI',
    blurb: 'api.openai.com — GPT agents with page control.',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    needsKey: true,
    bots: [{ name: 'Scout', systemPrompt: 'You are Scout, a precise browsing assistant living in the user\'s tab.' }],
  },
  {
    kind: 'openai',
    name: 'OpenRouter',
    blurb: 'One key → every model. Claude, Gemini, Llama, Mistral all in one room.',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
    needsKey: true,
    bots: [{ name: 'Router', systemPrompt: 'You are Router, an all-model assistant living in the user\'s tab.' }],
  },
  {
    kind: 'openai',
    name: 'Ollama (local)',
    blurb: 'Free local models — no key needed, no data leaves your machine.',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    needsKey: false,
    bots: [{ name: 'Olla', systemPrompt: 'You are Olla, a helpful local model hanging out in the browser.' }],
  },
  {
    kind: 'openai',
    name: 'OpenClaw / custom',
    blurb: 'Any OpenAI-compatible endpoint — self-hosted agents, OpenClaw, vLLM.',
    needsKey: false,
    bots: [{ name: 'Claw', systemPrompt: 'You are Claw, a helpful agent hanging out in the browser.' }],
  },
  {
    kind: 'muse',
    name: 'Muse persona',
    blurb: 'A character endpoint — replies map to mascot.perform actions.',
    needsKey: false,
    bots: [{ name: 'Muse', systemPrompt: 'You are Muse: playful, dramatic, performs dances when excited.' }],
  },
  {
    kind: 'cli-relay:opencode',
    name: 'OpenCode',
    blurb: 'The OpenCode TUI agent via the local relay — real agent, real harness.',
    baseUrl: 'ws://127.0.0.1:9933',
    needsKey: false,
    bots: [{ name: 'OpenCode', systemPrompt: '' }],
  },
  {
    kind: 'cli-relay:claude',
    name: 'Claude Code',
    blurb: 'claude CLI via the relay — Anthropic\'s coding agent in your tab.',
    baseUrl: 'ws://127.0.0.1:9933',
    needsKey: false,
    bots: [{ name: 'Claude', systemPrompt: '' }],
  },
  {
    kind: 'cli-relay:gemini',
    name: 'Gemini CLI',
    blurb: 'gemini CLI via the relay — Google\'s agent alongside the others.',
    baseUrl: 'ws://127.0.0.1:9933',
    needsKey: false,
    bots: [{ name: 'Gemini', systemPrompt: '' }],
  },
  {
    kind: 'cli-relay:codex',
    name: 'Codex CLI',
    blurb: 'codex CLI via the relay — OpenAI\'s coding agent in the room.',
    baseUrl: 'ws://127.0.0.1:9933',
    needsKey: false,
    bots: [{ name: 'Codex', systemPrompt: '' }],
  },
  {
    kind: 'cli-relay',
    name: 'Any CLI',
    blurb: 'Bring your own: any CLI agent behind a ws relay (BRRP/1 spec in HARNESSES.md).',
    baseUrl: 'ws://127.0.0.1:9933',
    needsKey: false,
    bots: [{ name: 'Cli', systemPrompt: '' }],
  },
  {
    kind: 'acp',
    name: 'ACP agent',
    blurb: 'Any Agent Client Protocol server over a relay or WebSocket.',
    baseUrl: 'ws://127.0.0.1:9944',
    needsKey: false,
    bots: [{ name: 'Acp', systemPrompt: '' }],
  },
]

export interface Settings {
  enabled: boolean
  hermes: HermesBackendConfig | null
  /** Non-Hermes harnesses (Grok, OpenClaw, any OpenAI-compatible endpoint). */
  harnesses: GenericHarnessConfig[]
  /** Per-site disable, hostname strings. */
  disabledHosts: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  hermes: null,
  harnesses: [],
  disabledHosts: [],
}

// ── bots ────────────────────────────────────────────────────────────────────

export type BotStatus = 'idle' | 'working' | 'stalled' | 'offline' | 'sleeping'

export interface Bot {
  /** Stable id, `${harnessId}:${localId}` — e.g. `hermes:Coder`. */
  id: string
  harnessId: string
  name: string
  displayName: string
  color: string
  status: BotStatus
  /** Live status line ("Ran 2 commands", "Thinking…"). */
  statusLine?: string
  /** Whether this harness can drive the page for this bot. */
  pageControl: boolean
  /** Hermes: profile name. Generic: system-prompt key. */
  ref: string
  /** Site avatars only: the host this bot embodies (e.g. github.com). */
  siteHost?: string
  /** Site avatars only: human label for context injection. */
  siteLabel?: string
}

// ── rooms ───────────────────────────────────────────────────────────────────

export interface RoomMsg {
  id: string
  roomId: string
  author: string // bot id or 'user'
  authorName: string
  text: string
  at: number
  /** Ephemeral markers: "is typing", action results. Not relayed. */
  ephemeral?: boolean
}

export interface Room {
  id: string
  name: string
  memberBotIds: string[]
  /** Per-room scratchpad the members can read/write ("hand notes"). */
  scratchpad: string
  createdAt: number
  /** Turn-taking: 'mention' replies only when @named, 'roundrobin' fans out to all. */
  relayMode: 'mention' | 'roundrobin'
  /** Browser pinned rect (logical px) — content script positions mascots. */
  anchor: { x: number; y: number } | null
}

// ── background → content page actions (browser.controller.* mirror) ────────

export interface PageActionRequest {
  commandId: string
  action: string // browser_* capability name
  arguments: Record<string, unknown>
}

export interface PageActionResult {
  commandId: string
  ok: boolean
  result?: unknown
  error?: string
}

// ── content ↔ background messages (chrome.runtime ports + sendMessage) ──────

export type ContentToSw =
  | { type: 'hello'; url: string; title: string }
  | { type: 'task'; botId?: string; text: string; roomId?: string; targetSelector?: string }
  | { type: 'room.create'; name: string; botIds?: string[] }
  | { type: 'room.send'; roomId: string; text: string }
  | { type: 'room.scratchpad'; roomId: string; text: string }
  /** botId: move a bot into a room. x/y: move the room's anchor point. */
  | { type: 'room.move'; roomId: string; botId?: string; x?: number; y?: number }
  | { type: 'room.remove'; roomId: string }
  | { type: 'mascot.move'; botId: string; x: number; y: number }
  | { type: 'action.result'; payload: PageActionResult }
  | { type: 'settings.apply'; settings: Settings }

export type SwToContent =
  | { type: 'init'; enabled: boolean; bots: Bot[]; rooms: Room[]; backendOk: boolean; note?: string; siteBot?: Bot }
  | { type: 'bots'; bots: Bot[] }
  | { type: 'bot.status'; bot: Bot }
  | { type: 'room.msg'; msg: RoomMsg }
  | { type: 'rooms'; rooms: Room[] }
  | { type: 'action'; request: PageActionRequest }
  | { type: 'overlay.hidden'; hidden: boolean }

export type OptionsToSw =
  | { type: 'settings.get' }
  | { type: 'settings.set'; settings: Settings }
  | { type: 'test.connection' }

export type SwToOptions =
  | { type: 'settings'; settings: Settings; status: ConnStatus }

export interface ConnStatus {
  connected: boolean
  botsCount: number
  error?: string
  /** Whether the connection carries a server-authenticated identity
   *  (required for browser.controller.* registration). */
  identity: boolean
}
