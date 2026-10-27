/**
 * Instant ack for a canonical Bot Chat — derived, never stored.
 *
 * Part A (receipt): the moment a send lands in the transcript, the line above
 * the composer restates the user's own words ("Got it — fix the sidebar").
 * Restating the ask claims nothing about progress, so it is true before the
 * turn has started.
 *
 * Part B (first real step): the first tool call the turn actually opened, by
 * its plain verb ("Searching the web…"). Reply text, a finished tool, or an
 * idle session hands off — the transcript carries the turn from there. Past
 * WAITING_AFTER_MS with nothing to show, the honest line is "Waiting on the
 * model…", never an invented step.
 *
 * Zero core: the receipt is armed by a pass-through `composer.middleware`
 * (the last in the chain, so it sees the draft that is actually sent), and
 * every later state comes from gateway events the app already emits
 * (`tool.generating` / `tool.start` / `tool.complete` / `message.delta` /
 * `message.complete` / `approval.request`) plus `host.state.busyBySession`.
 * No new gateway event. The store is in-memory: a reload mid-turn shows the
 * transcript's own status row instead, which is honest.
 */

import { atom } from '@hermes/plugin-sdk'

/** Longest restatement we will show. Beyond this it stops being a glance. */
export const RECEIPT_MAX_WORDS = 8

/** How long a receipt may stand before it admits it is waiting on the model. */
export const WAITING_AFTER_MS = 1200

export type AckToolKind = 'browse' | 'delegate' | 'edit' | 'read' | 'run' | 'search' | 'tool'

export type InstantAck = { armedAt: number; storedId: string } & (
  | { kind: 'command' | 'prompt'; state: 'receipt'; text: string }
  | { state: 'waiting' }
  | { name: string; state: 'working'; tool: AckToolKind }
)

const FENCE = /```[\s\S]*?```/g
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g
/** Bare URLs, paths, @refs and #tags are never the point of the ask. */
const NOISE_TOKEN = /^(?:https?:\/\/\S+|www\.\S+|\/[\w./-]+|~\/\S+|@\S+|#\S+)$/i
/** Leading list/quote/heading/task furniture, so the restatement starts on a word. */
const LEADING_MARKER = /^(?:[\s>*#–—•\])]+|[-–—]\s+|\d+[.)]\s*|\[[ xX]?\]\s*)/u

function stripLeadingMarkers(text: string): string {
  let out = text

  // Looped because the forms stack: a heading holds a bullet holds a task box.
  for (let pass = 0; pass < 6; pass += 1) {
    const next = out.replace(LEADING_MARKER, '')

    if (next === out) {
      break
    }

    out = next
  }

  return out
}

/** The words a receipt repeats, or null when no honest restatement exists
 *  (attachment-only send, a bare URL) — the row then stays quiet. */
export function receiptFromPrompt(text: string): { kind: 'command' | 'prompt'; text: string } | null {
  const cleaned = text
    .replace(FENCE, ' ')
    .replace(MD_LINK, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) {
    return null
  }

  const command = /^\/([a-z0-9][\w-]*)/i.exec(cleaned)

  if (command) {
    return { kind: 'command', text: `/${command[1].toLowerCase()}` }
  }

  const words = stripLeadingMarkers(cleaned)
    .split(' ')
    .filter(word => word && !NOISE_TOKEN.test(word))

  const kept = words
    .slice(0, RECEIPT_MAX_WORDS)
    .join(' ')
    .replace(/[\s,;:.!?…-]+$/u, '')

  return kept ? { kind: 'prompt', text: kept } : null
}

/** The plain verb family a tool reads as. Unknown tools stay 'tool' and are
 *  named as themselves rather than guessed at. */
export function ackToolKind(name: string): AckToolKind {
  const tool = name.toLowerCase()

  if (/^(terminal|execute_code|process|shell|bash)/.test(tool)) {
    return 'run'
  }

  if (/^(web_search|search_web|search)$/.test(tool)) {
    return 'search'
  }

  if (/^(browser_|web_extract|web_fetch|fetch_url)/.test(tool)) {
    return 'browse'
  }

  if (/^(read_file|search_files|list_files|grep|glob)/.test(tool)) {
    return 'read'
  }

  if (/^(write_file|patch|edit_file|apply_patch)/.test(tool)) {
    return 'edit'
  }

  if (/^(delegate_task|message_agent)/.test(tool)) {
    return 'delegate'
  }

  return 'tool'
}

export type InstantAckEvent =
  | { kind: 'command' | 'prompt'; storedId: string; text: string; type: 'arm' }
  | { name: string; type: 'tool-start' }
  | { type: 'waiting' }
  /** Real turn state took over: reply text, a finished tool, an approval
   *  card, turn end, or an error. */
  | { type: 'hand-off' }

/** Apply one real event. `null` = nothing left to say; the row unmounts. */
export function reduceInstantAck(current: InstantAck | null, event: InstantAckEvent, at: number): InstantAck | null {
  if (event.type === 'arm') {
    return { armedAt: at, kind: event.kind, state: 'receipt', storedId: event.storedId, text: event.text }
  }

  // Nothing armed (a background resume, a routine kickoff): no receipt to promote.
  if (!current || event.type === 'hand-off') {
    return null
  }

  if (event.type === 'tool-start') {
    return { armedAt: current.armedAt, name: event.name, state: 'working', storedId: current.storedId, tool: ackToolKind(event.name) }
  }

  // Silence is only news before the turn has named anything.
  return current.state === 'receipt' ? { armedAt: current.armedAt, state: 'waiting', storedId: current.storedId } : current
}

/** Runtime session id → its live ack. */
export const $instantAcks = atom<Record<string, InstantAck>>({})

export function noteInstantAck(runtimeId: string, event: InstantAckEvent, at = Date.now()): void {
  const all = $instantAcks.get()
  const next = reduceInstantAck(all[runtimeId] ?? null, event, at)

  if (next === (all[runtimeId] ?? null)) {
    return
  }

  const copy = { ...all }

  if (next) {
    copy[runtimeId] = next
  } else {
    delete copy[runtimeId]
  }

  $instantAcks.set(copy)
}

/** Arm a receipt for a send, unless there is no honest restatement or the
 *  session is mid-turn (that send queues or steers; the composer's own queue
 *  row is its receipt). Returns whether a receipt was armed. */
export function armInstantAck(runtimeId: null | string, storedId: null | string, text: string, busy: boolean): boolean {
  const receipt = receiptFromPrompt(text)

  if (!runtimeId || !storedId || !receipt || busy) {
    return false
  }

  noteInstantAck(runtimeId, { ...receipt, storedId, type: 'arm' })

  return true
}

interface AckGatewayEvent {
  payload?: unknown
  session_id?: string
  type: string
}

function payloadField(payload: unknown, key: string): string {
  const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined

  return typeof value === 'string' ? value : ''
}

/** Map one existing gateway event onto the ack. Pure routing — the reducer
 *  decides whether it changes anything. */
export function feedInstantAck(event: AckGatewayEvent): void {
  const runtimeId = event.session_id

  if (!runtimeId || !$instantAcks.get()[runtimeId]) {
    return
  }

  if (event.type === 'tool.generating' || event.type === 'tool.start') {
    const name = payloadField(event.payload, 'name') || payloadField(event.payload, 'tool_name')

    if (name) {
      noteInstantAck(runtimeId, { name, type: 'tool-start' })
    }

    return
  }

  if (event.type === 'message.delta') {
    // Reply text takes over the bubble; an empty frame is not a reply.
    if ((payloadField(event.payload, 'text') || payloadField(event.payload, 'delta')).trim()) {
      noteInstantAck(runtimeId, { type: 'hand-off' })
    }

    return
  }

  // A finished tool's card carries the turn from here; an approval card is
  // its own claim; a completed or failed turn has nothing left to ack.
  noteInstantAck(runtimeId, { type: 'hand-off' })
}

/** The existing events the ack listens to. */
export const INSTANT_ACK_EVENTS = [
  'approval.request',
  'error',
  'message.complete',
  'message.delta',
  'tool.complete',
  'tool.generating',
  'tool.start'
] as const

/** How long an armed ack may stand on a session that never went busy before
 *  it is dropped — `busy` lags a send by a tick, and a refused send never
 *  starts a turn at all. */
export const IDLE_GRACE_MS = 2000

/** Drop acks whose turn is over (or never started past the grace). */
export function sweepInstantAcks(busyBySession: Record<string, boolean>, now = Date.now()): void {
  for (const [runtimeId, ack] of Object.entries($instantAcks.get())) {
    if (!busyBySession[runtimeId] && (ack.state === 'working' || now - ack.armedAt >= IDLE_GRACE_MS)) {
      noteInstantAck(runtimeId, { type: 'hand-off' }, now)
    }
  }
}
