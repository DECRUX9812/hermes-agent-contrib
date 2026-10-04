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
  /** OpenAI-compatible base, e.g. https://api.x.ai/v1 */
  baseUrl: string
  apiKey: string
  /** "Model" field shared by every bot on this harness. */
  model: string
  /** displayName -> system prompt. One entry per virtual bot. */
  bots: { name: string; systemPrompt: string }[]
}

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
  | { type: 'init'; enabled: boolean; bots: Bot[]; rooms: Room[]; backendOk: boolean; note?: string }
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
