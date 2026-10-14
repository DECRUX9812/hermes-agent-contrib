/** What a live tool activity card shows. Built from a tool call by `toolCardView`
 *  and rendered by `ToolActivityStack`; the view never carries raw JSON. */

export type ToolCardFamily = 'browser' | 'code' | 'files' | 'generic' | 'mcp' | 'search' | 'terminal' | 'web'

export type ToolCardState = 'approval' | 'done' | 'error' | 'running'

/** A browser call's picture of the page: a screenshot only when the tool returned
 *  one, otherwise the address it was on. Never synthesized. */
export type ToolCardThumb = { kind: 'screenshot'; src: string; url?: string } | { host: string; kind: 'site'; url: string }

export interface ToolCardDetail {
  label: string
  value: string
}

export interface ToolCardView {
  /** The tool call id, or a stable hash of name + args when the call has none. */
  id: string
  family: ToolCardFamily
  /** A `ToolIcon` name. */
  icon: string
  /** Human tool name: the family name ("Browser"), a known tool name ("Memory"),
   *  or an MCP server's title ("Linear"). */
  name: string
  /** Localized status: present tense while running ("Opening github.com"),
   *  past tense once settled ("Opened github.com"). */
  status: string
  state: ToolCardState
  /** Error only: one short line. */
  reason?: string
  thumb?: ToolCardThumb
  /** Human summary of the arguments, at most four rows. */
  args: ToolCardDetail[]
  /** Plain-text output preview, clamped. */
  output?: string
  durationLabel?: string
  /** ms epoch. */
  startedAt?: number
  /** ms epoch. */
  completedAt?: number
}

/** Consecutive calls of one tool, shown as one card. */
export interface ToolCardGroup {
  /** The first card's id; stable while the group grows. */
  key: string
  family: ToolCardFamily
  icon: string
  name: string
  /** The latest card's state. Error and approval cards never share a group. */
  state: ToolCardState
  /** At least one, in call order. */
  cards: ToolCardView[]
  /** The latest screenshot in the group, else the latest site. */
  thumb?: ToolCardThumb
}
