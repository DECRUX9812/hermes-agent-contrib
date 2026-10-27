import {
  buildToolView,
  compactPreview,
  findFirstUrl,
  parseMaybeObject,
  stableHash,
  stripAnsi,
  type ToolPart,
  type ToolView
} from '@hermes/plugin-sdk'

import { type ToolCardsCopy, toolCardsT } from './tool-cards-i18n'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const capitalize = (value: string): string => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value)

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

/** Whether a hostname may trigger a network favicon lookup.
 *
 *  The lookup asks the site itself, so it must never fire for names that can
 *  only resolve on the viewer's own machine or LAN.
 */

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa']

export function isPublicHost(host: string): boolean {
  let name = host.trim().toLowerCase()

  if (name.endsWith('.')) {
    name = name.slice(0, -1)
  }

  if (!name || name === 'localhost') {
    return false
  }

  if (name.startsWith('[') && name.endsWith(']')) {
    name = name.slice(1, -1)
  }

  if (!name || name === 'localhost') {
    return false
  }

  // IPv6 literals, bracketed or bare.
  if (name.includes(':')) {
    return false
  }

  // Single-label names never leave the local resolver.
  if (!name.includes('.')) {
    return false
  }

  // IPv4 literals.
  if (/^[0-9.]+$/.test(name)) {
    return false
  }

  return !PRIVATE_SUFFIXES.some(suffix => name.endsWith(suffix))
}

const MAX_ARG_ROWS = 4
const MAX_ARG_CHARS = 200

export function clampText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

interface KnownArg {
  key: string
  label: 'code' | 'command' | 'path' | 'query' | 'target' | 'text' | 'url'
  lines?: number
}

const KNOWN_ARGS: readonly KnownArg[] = [
  { key: 'url', label: 'url' },
  { key: 'command', label: 'command' },
  { key: 'path', label: 'path' },
  { key: 'file_path', label: 'path' },
  { key: 'query', label: 'query' },
  { key: 'pattern', label: 'query' },
  { key: 'code', label: 'code', lines: 3 },
  { key: 'text', label: 'text' },
  { key: 'ref', label: 'target' },
  { key: 'selector', label: 'target' },
  { key: 'element', label: 'target' }
]

const KNOWN_KEYS = new Set(KNOWN_ARGS.map(arg => arg.key))

function humanize(key: string): string {
  return capitalize(
    key
      .replace(/[_-]+/g, ' ')
      .trim()
      .toLowerCase()
  )
}

function scalarText(value: unknown, lines?: number): string {
  if (typeof value === 'string') {
    const text = value.trim()

    return lines ? text.split('\n').slice(0, lines).join('\n') : text
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value
      .map(item => item.trim())
      .filter(Boolean)
      .join(', ')
  }

  return ''
}

export function toolCardArgs(args: unknown): ToolCardDetail[] {
  const record = parseMaybeObject(args)
  const rows: ToolCardDetail[] = []
  const labels = new Set<string>()

  const push = (label: string, value: string) => {
    if (!value || labels.has(label) || rows.length >= MAX_ARG_ROWS) {
      return
    }

    labels.add(label)
    rows.push({ label, value: clampText(value, MAX_ARG_CHARS) })
  }

  for (const arg of KNOWN_ARGS) {
    push(toolCardsT(`argLabels.${arg.label}`), scalarText(record[arg.key], arg.lines))
  }

  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_KEYS.has(key)) {
      push(humanize(key), scalarText(value))
    }
  }

  return rows
}

const MAX_OUTPUT_CHARS = 600
const MAX_REASON_CHARS = 120
const OUTPUT_TEXT_KEYS = ['output', 'stdout', 'content', 'text', 'message', 'summary'] as const
const IMAGE_PATH = /\.(png|jpe?g|webp|gif)(\?|#|$)/i
const HTTP_URL = /^https?:\/\//i

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function scalarLine(key: string, value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return `${key}: ${stripAnsi(value).trim()}`
  }

  return typeof value === 'number' || typeof value === 'boolean' ? `${key}: ${value}` : ''
}

function recordOutput(record: Record<string, unknown>, family: ToolCardFamily): string {
  const text = OUTPUT_TEXT_KEYS.map(key => record[key]).find(nonEmptyString)

  if (text) {
    return stripAnsi(text)
  }

  if (family === 'browser') {
    const page = [record.title, record.url].filter(nonEmptyString).join('\n')

    if (page) {
      return page
    }
  }

  return Object.entries(record)
    .map(([key, value]) => scalarLine(key, value))
    .filter(Boolean)
    .join('\n')
}

const UNTRUSTED_WRAPPER = /^\s*<untrusted_tool_result\b[^>]*>([\s\S]*?)<\/untrusted_tool_result>\s*$/i

/** The gateway fences tool output as `<untrusted_tool_result>` with a short
 *  preamble before the tool's JSON. Cards read the JSON, not the fence. */
export function unwrapToolResult(result: unknown): unknown {
  if (typeof result !== 'string') {
    return result
  }

  const inner = UNTRUSTED_WRAPPER.exec(result)?.[1]

  if (inner === undefined) {
    return result
  }

  const start = inner.search(/^\s*\{/m)

  if (start >= 0) {
    try {
      const parsed: unknown = JSON.parse(inner.slice(start).trim())

      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    } catch {
      // Not JSON after all: fall through to the plain text inside the fence.
    }
  }

  return inner.trim()
}

export function toolCardOutput(rawResult: unknown, family: ToolCardFamily): string | undefined {
  const result = unwrapToolResult(rawResult)
  const record = parseMaybeObject(result)
  let text = ''

  if (Object.keys(record).length > 0) {
    text = recordOutput(record, family)
  } else if (typeof result === 'string' && !/^\s*[[{]/.test(result)) {
    text = stripAnsi(result)
  }

  const trimmed = text.trim()

  return trimmed ? clampText(trimmed, MAX_OUTPUT_CHARS) : undefined
}

export function toolCardReason(part: ToolPart, view: ToolView): string | undefined {
  const record = parseMaybeObject(part.result)
  const plainResult = typeof part.result === 'string' && Object.keys(record).length === 0 ? part.result : undefined
  const raw = [record.error, record.message, plainResult].find(nonEmptyString) ?? view.detail
  const firstLine = raw.split('\n').find(line => line.trim())

  return firstLine ? compactPreview(firstLine, MAX_REASON_CHARS) : undefined
}

const SCREENSHOT_KEYS = ['screenshot_path', 'screenshot', 'screenshot_url', 'image_path', 'image_url', 'image'] as const

function lastOf(value: unknown): unknown {
  return Array.isArray(value) ? value[value.length - 1] : undefined
}

function screenshotSrc(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  const src = value.trim()

  if (/^data:image\//i.test(src)) {
    return src
  }

  return IMAGE_PATH.test(src) ? src : ''
}

const URL_IN_TEXT = /https?:\/\/[^\s"'`<>()[\]{}\\]+/i
const URL_TEXT_KEYS = ['code', 'task', 'instruction', 'instructions', 'goal', 'text', 'command', 'script'] as const
const RESULT_URL_KEYS = ['url', 'page_url', 'current_url', 'final_url'] as const

/** The first http(s) address written inside free text, trailing punctuation trimmed. */
export function urlInText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  const match = URL_IN_TEXT.exec(value)

  return match ? match[0].replace(/[.,;:!?'"]+$/, '') : ''
}

function validUrl(value: string): string {
  if (!HTTP_URL.test(value)) {
    return ''
  }

  try {
    return new URL(value).hostname ? value : ''
  } catch {
    return ''
  }
}

/** The page a browser or web call worked on: an explicit url field first,
 *  then an address written in its code or task (browser_exec scripts), then
 *  one the result reports. */
export function toolCardPageUrl(args: unknown, rawResult: unknown): string | undefined {
  const result = unwrapToolResult(rawResult)
  const argRecord = parseMaybeObject(args)
  const resultRecord = parseMaybeObject(result)

  const candidates = [
    findFirstUrl(argRecord.url, ...RESULT_URL_KEYS.map(key => resultRecord[key])),
    ...URL_TEXT_KEYS.map(key => urlInText(argRecord[key])),
    ...OUTPUT_TEXT_KEYS.map(key => urlInText(resultRecord[key])),
    urlInText(typeof result === 'string' ? result : '')
  ]

  for (const candidate of candidates) {
    const url = validUrl(candidate)

    if (url) {
      return url
    }
  }

  return undefined
}

export function toolCardThumb(
  family: ToolCardFamily,
  view: ToolView,
  result: unknown,
  pageUrl: string | undefined
): ToolCardThumb | undefined {
  if (family !== 'browser' && family !== 'web') {
    // Other tools (MCP fetchers, generic HTTP helpers) only get a site chip
    // for an address they were explicitly asked to open.
    return pageUrl ? { kind: 'site', url: pageUrl, host: new URL(pageUrl).hostname } : undefined
  }

  const record = parseMaybeObject(unwrapToolResult(result))

  const src =
    view.imageUrl ||
    SCREENSHOT_KEYS.map(key => screenshotSrc(record[key])).find(Boolean) ||
    screenshotSrc(lastOf(record.screenshots))

  if (src) {
    return { kind: 'screenshot', src, url: pageUrl }
  }

  return pageUrl ? { kind: 'site', url: pageUrl, host: new URL(pageUrl).hostname } : undefined
}

const FAMILY_BY_NAME = new Map<string, ToolCardFamily>([
  ['web_search', 'search'],
  ['search_files', 'search'],
  ['session_search', 'search'],
  ['session_search_recall', 'search'],
  ['fetch_url', 'web'],
  ['terminal', 'terminal'],
  ['process', 'terminal'],
  ['execute_code', 'code'],
  ['read_file', 'files'],
  ['write_file', 'files'],
  ['edit_file', 'files'],
  ['patch', 'files'],
  ['list_files', 'files'],
  ['list_directory', 'files']
])

const FAMILY_BY_PREFIX: ReadonlyArray<readonly [string, ToolCardFamily]> = [
  ['browser_', 'browser'],
  ['web_', 'web'],
  ['mcp__', 'mcp'],
  ['connectors__', 'mcp']
]

const FAMILY_ICON: Record<ToolCardFamily, string> = {
  browser: 'globe',
  code: 'code',
  files: 'files',
  generic: 'tools',
  mcp: 'plug',
  search: 'search',
  terminal: 'terminal',
  web: 'globe'
}

const FILE_ICON = new Map<string, string>([
  ['read_file', 'file'],
  ['write_file', 'edit'],
  ['edit_file', 'edit'],
  ['patch', 'edit'],
  ['list_files', 'files'],
  ['list_directory', 'files']
])

const KNOWN_GENERIC_TOOLS = new Map<string, { icon: string; name: keyof ToolCardsCopy['names'] }>([
  ['memory', { icon: 'brain', name: 'memory' }],
  ['skill_view', { icon: 'tools', name: 'skills' }],
  ['skills_list', { icon: 'tools', name: 'skills' }],
  ['skill_manage', { icon: 'tools', name: 'skills' }],
  ['vision_analyze', { icon: 'eye', name: 'vision' }],
  ['cronjob', { icon: 'watch', name: 'schedule' }],
  ['send_message', { icon: 'tools', name: 'message' }]
])

const t = (key: string): string => toolCardsT(key)

export function toolCardFamily(toolName: string): ToolCardFamily {
  const exact = FAMILY_BY_NAME.get(toolName)

  if (exact) {
    return exact
  }

  return FAMILY_BY_PREFIX.find(([prefix]) => toolName.startsWith(prefix))?.[1] ?? 'generic'
}

function toolCardIcon(toolName: string, family: ToolCardFamily): string {
  if (family === 'files') {
    return FILE_ICON.get(toolName) ?? FAMILY_ICON.files
  }

  if (family === 'generic') {
    return KNOWN_GENERIC_TOOLS.get(toolName)?.icon ?? FAMILY_ICON.generic
  }

  return FAMILY_ICON[family]
}

/** The icon and display name a tool card would use, for compact step lists. */
export function toolStepIdentity(toolName: string): { icon: string; name: string } {
  const family = toolCardFamily(toolName)

  return { icon: toolCardIcon(toolName, family), name: toolCardName(toolName, family) }
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function toolCardName(toolName: string, family: ToolCardFamily): string {
  if (family === 'mcp') {
    return titleCase(toolName.split('__')[1] ?? '') || t('families.mcp')
  }

  if (family === 'generic') {
    const known = KNOWN_GENERIC_TOOLS.get(toolName)

    return known ? t(`names.${known.name}`) : titleCase(toolName) || t('families.generic')
  }

  return t(`families.${family}`)
}

function toolCardState(part: ToolPart, view: ToolView, approvalPending: boolean): ToolCardState {
  if (part.interrupted) {
    return 'done'
  }

  if (view.status === 'running') {
    return approvalPending ? 'approval' : 'running'
  }

  return view.status === 'error' ? 'error' : 'done'
}

const TITLELESS_TOOLS = new Set([
  'browser_back',
  'browser_console',
  'browser_get_images',
  'browser_press',
  'browser_scroll',
  'browser_vision'
])

function toolCardStatus(part: ToolPart, view: ToolView, family: ToolCardFamily, pageUrl?: string): string {
  if (part.interrupted) {
    return t('stopped')
  }

  if (TITLELESS_TOOLS.has(part.toolName)) {
    return t(`statuses.${part.toolName}.${view.status === 'running' ? 'pending' : 'done'}`)
  }

  // A live scripted browser step (browser_exec has no url arg, its page is
  // inside the code) says where it is going; tools with a url arg already
  // title themselves that way, and the settled line keeps the tool's title.
  if (
    view.status === 'running' &&
    pageUrl &&
    (family === 'browser' || family === 'web') &&
    !parseMaybeObject(part.args).url
  ) {
    return toolCardsT('opening', new URL(pageUrl).hostname.replace(/^www\./, ''))
  }

  if (view.title) {
    return view.title
  }

  return view.status === 'running' ? t('working') : ''
}

/** A url argument the tool was handed directly, never one fished out of text. */
function explicitPageUrl(args: unknown): string | undefined {
  const url = parseMaybeObject(args).url

  return typeof url === 'string' && /^https?:\/\//i.test(url.trim()) && URL.canParse(url.trim()) ? url.trim() : undefined
}

function epochMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined
  }

  return value < 1e12 ? value * 1000 : value
}

export function toolCardView(part: ToolPart, options: { approvalPending?: boolean } = {}): ToolCardView {
  const view = buildToolView(part, '')
  const family = toolCardFamily(part.toolName)
  const state = toolCardState(part, view, options.approvalPending === true)
  const webish = family === 'browser' || family === 'web'
  const pageUrl = webish ? toolCardPageUrl(part.args, part.result) : explicitPageUrl(part.args)

  const card: ToolCardView = {
    id: part.toolCallId || stableHash(part.toolName + JSON.stringify(part.args ?? {})),
    family,
    icon: toolCardIcon(part.toolName, family),
    name: toolCardName(part.toolName, family),
    status: toolCardStatus(part, view, family, pageUrl),
    state,
    args: toolCardArgs(part.args),
    durationLabel: view.durationLabel,
    startedAt: epochMs(part.timestamp),
    completedAt: epochMs(part.completedAt)
  }

  if (state === 'error') {
    card.reason = toolCardReason(part, view) ?? t('failed')
  }

  card.thumb = toolCardThumb(family, view, part.result, pageUrl)
  card.output = toolCardOutput(part.result, family)

  return card
}

const isSoloCard = (card: ToolCardView): boolean => card.state === 'error' || card.state === 'approval'

function joinsRun(previous: ToolCardView, card: ToolCardView): boolean {
  return (
    !isSoloCard(previous) &&
    !isSoloCard(card) &&
    previous.family === card.family &&
    previous.name === card.name
  )
}

function groupOf(cards: ToolCardView[]): ToolCardGroup {
  const latest = cards[cards.length - 1]
  const thumbs = cards.map(card => card.thumb)
  const screenshot = thumbs.findLast(thumb => thumb?.kind === 'screenshot')

  return {
    key: cards[0].id,
    family: latest.family,
    icon: latest.icon,
    name: latest.name,
    state: latest.state,
    cards,
    thumb: screenshot ?? thumbs.findLast(thumb => thumb?.kind === 'site')
  }
}

export function groupToolCards(cards: readonly ToolCardView[]): ToolCardGroup[] {
  const runs: ToolCardView[][] = []

  for (const card of cards) {
    const run = runs.at(-1)

    if (run && joinsRun(run[run.length - 1], card)) {
      run.push(card)
    } else {
      runs.push([card])
    }
  }

  return runs.map(groupOf)
}

const isToolCallPart = (part: unknown): part is ToolPart =>
  isRecord(part) && (part.type === undefined || part.type === 'tool-call') && typeof part.toolName === 'string'

/** Core hands over plain tool activity only (see `isPlainToolActivity`), so
 *  every tool-call part here becomes a card. */
export function toolCardsFromParts(parts: readonly unknown[], options: { approvalCallId?: string } = {}): ToolCardGroup[] {
  const cards: ToolCardView[] = []

  for (const part of parts) {
    if (!isToolCallPart(part)) {
      continue
    }

    const approvalPending = Boolean(options.approvalCallId) && part.toolCallId === options.approvalCallId

    cards.push(toolCardView(part, { approvalPending }))
  }

  return groupToolCards(cards)
}
