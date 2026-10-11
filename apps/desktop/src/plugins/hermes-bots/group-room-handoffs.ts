/**
 * The room's handoff protocol: work passed between teammates as a CONTRACT,
 * not a bare @mention (the structured-handoff pattern: task, finish line,
 * clock, owner — and anything stuck comes to the user).
 *
 * A handoff is one line anyone in the room writes — a member or the user:
 *
 *     @coder handoff: unify replies into the composer · done when: tests green · due: 30m
 *
 * Its status is read off the thread that follows, never stored: the receiver's
 * next words in that thread accept ("accepted", "on it"), decline ("declined:
 * <why>") or deliver (a reply carrying proof — a commit hash, a test result, a
 * link), and the receiver mid-turn on the thread reads as working. A handoff
 * still open after NUDGE_AFTER_MS can be nudged; after ESCALATE_AFTER_MS it is
 * escalated to the user, as is a ping-pong loop between two teammates.
 *
 * Pure derivation over the room log — no state of its own, so the card the
 * user sees always matches the conversation it summarizes.
 */

import { groupThreadOf } from './group-chat'
import { isGroupPassText } from './group-turns'
import type { GroupMember, GroupMessage } from './types'

export const NUDGE_AFTER_MS = 10 * 60_000
export const ESCALATE_AFTER_MS = 20 * 60_000
/** Back-and-forth handoffs between the same two voices, with no delivery and
 *  no word from the user, that count as a loop. */
export const LOOP_HANDOFFS = 3

export type HandoffStatus = 'accepted' | 'declined' | 'delivered' | 'open' | 'working'

export interface RoomHandoff {
  at: number
  doneWhen: string
  /** Minutes from `at`; null when the line named no due. */
  dueMinutes: null | number
  /** Speaker name ('You' for the user). */
  from: string
  fromUser: boolean
  id: string
  /** Index of the log entry that carried the handoff. */
  index: number
  /** The receiver's answer that settled it (decline reason / delivery). */
  reply: string
  /** Log index of that answer, or -1. */
  replyIndex: number
  /** Open long enough to nudge, or to escalate to the user. */
  stale: 'escalate' | 'fresh' | 'nudge'
  status: HandoffStatus
  task: string
  thread: string
  to: string
}

export interface RoomEscalation {
  handoff: RoomHandoff
  kind: 'loop' | 'stalled'
}

const LINE = /@([a-z0-9][a-z0-9._-]*)\s+hand-?off\s*:\s*(.+)/i
const FIELD_SPLIT = /\s+[·|;]\s+/
const DONE_WHEN = /^done\s*when\s*:\s*/i
const DUE = /^due\s*:\s*(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)?\b/i
const ACCEPT = /^\(?\s*(accepted|accept|on it|taking it|got it|claimed)\b/i
const DECLINE = /^\(?\s*(declined?|can'?t take|not mine)\b\s*[:,-]?\s*/i
/** Proof that work landed: a commit hash, a test tally, a URL, or the word itself. */
const PROOF = /\b([0-9a-f]{7,40}\b|\d[\d,]*\s+(tests?\s+)?passed|https?:\/\/\S+|delivered|shipped|merged|deployed)\b/i

function resolveHandle(handle: string, members: readonly GroupMember[]): null | string {
  const wanted = handle.toLowerCase().replace(/[._-]+/g, '')

  const member = members.find(m => {
    const forms = [m.name, m.title || '', m.display_name || ''].map(v =>
      String(v)
        .toLowerCase()
        .replace(/[\s._-]+/g, '')
    )

    return forms.includes(wanted)
  })

  return member ? member.name : null
}

/** One handoff line → its fields, or null when the line isn't one. */
export function parseHandoffLine(
  text: string,
  members: readonly GroupMember[]
): null | { doneWhen: string; dueMinutes: null | number; task: string; to: string } {
  for (const line of String(text || '').split('\n')) {
    const match = line.match(LINE)
    const to = match ? resolveHandle(match[1]!, members) : null

    if (!match || !to) {
      continue
    }

    const [task = '', ...rest] = match[2]!.split(FIELD_SPLIT).map(part => part.trim())
    let doneWhen = ''
    let dueMinutes: null | number = null

    for (const part of rest) {
      const due = part.match(DUE)

      if (DONE_WHEN.test(part)) {
        doneWhen = part.replace(DONE_WHEN, '').trim()
      } else if (due) {
        const n = Number(due[1])
        dueMinutes = /^h/i.test(due[2] || '') ? n * 60 : n
      }
    }

    if (task) {
      return { doneWhen, dueMinutes, task, to }
    }
  }

  return null
}

function speakerName(entry: GroupMessage): string {
  return entry.from?.kind === 'user' ? 'You' : entry.from?.name || ''
}

export function deriveRoomHandoffs(
  log: readonly GroupMessage[],
  members: readonly GroupMember[],
  { live = new Map(), now = Date.now() }: { live?: ReadonlyMap<string, ReadonlySet<string>>; now?: number } = {}
): RoomHandoff[] {
  const handoffs: RoomHandoff[] = []

  log.forEach((entry, index) => {
    const parsed = parseHandoffLine(entry.text, members)

    if (!parsed || parsed.to === entry.from?.name) {
      return
    }

    const thread = groupThreadOf(entry)
    let status: HandoffStatus = 'open'
    let reply = ''
    let replyIndex = -1

    for (let next = index + 1; next < log.length; next++) {
      const later = log[next]!

      if (groupThreadOf(later) !== thread || later.from?.kind !== 'member' || later.from.name !== parsed.to) {
        continue
      }

      const text = String(later.text || '').trim()

      if (isGroupPassText(text)) {
        continue
      }

      if (DECLINE.test(text)) {
        status = 'declined'
        reply = text.replace(DECLINE, '').trim()
        replyIndex = next

        break
      }

      if (PROOF.test(text) && !ACCEPT.test(text)) {
        status = 'delivered'
        reply = text
        replyIndex = next

        break
      }

      // Any real word back is a pickup; keep reading for a later delivery.
      status = 'accepted'
      replyIndex = next
    }

    if ((status === 'open' || status === 'accepted') && live.get(thread)?.has(parsed.to)) {
      status = 'working'
    }

    const sentAt = Number(entry.at)
    const age = Number.isFinite(sentAt) ? now - sentAt : 0

    handoffs.push({
      at: Number(entry.at) || 0,
      doneWhen: parsed.doneWhen,
      dueMinutes: parsed.dueMinutes,
      from: speakerName(entry),
      fromUser: entry.from?.kind === 'user',
      id: entry.id || `${thread}:${index}`,
      index,
      reply,
      replyIndex,
      stale:
        status !== 'open' ? 'fresh' : age >= ESCALATE_AFTER_MS ? 'escalate' : age >= NUDGE_AFTER_MS ? 'nudge' : 'fresh',
      status,
      task: parsed.task,
      thread,
      to: parsed.to
    })
  })

  return handoffs
}

/** What reaches the user unasked: a handoff nobody picked up in time, and a
 *  ping-pong between two teammates that never delivers (one per thread). */
export function roomEscalations(handoffs: readonly RoomHandoff[], log: readonly GroupMessage[]): RoomEscalation[] {
  const out: RoomEscalation[] = handoffs
    .filter(h => h.stale === 'escalate')
    .map(handoff => ({ handoff, kind: 'stalled' }))

  const byThread = new Map<string, RoomHandoff[]>()

  for (const handoff of handoffs) {
    byThread.set(handoff.thread, [...(byThread.get(handoff.thread) ?? []), handoff])
  }

  for (const list of byThread.values()) {
    // Count the trailing run since the user last spoke in the thread.
    const lastUser = log.reduce(
      (found, entry, index) =>
        entry.from?.kind === 'user' && groupThreadOf(entry) === list[0]!.thread ? index : found,
      -1
    )

    const run = list.filter(h => h.index > lastUser && !h.fromUser)
    const pair = (h: RoomHandoff) => [h.from, h.to].sort().join('↔')
    const last = run.at(-1)

    if (
      last &&
      run.length >= LOOP_HANDOFFS &&
      !run.some(h => h.status === 'delivered') &&
      run.slice(-LOOP_HANDOFFS).every(h => pair(h) === pair(last))
    ) {
      out.push({ handoff: last, kind: 'loop' })
    }
  }

  return out
}

// ── What the room sends (protocol words, so never translated) ──────────────

/** A handoff line in the exact shape parseHandoffLine reads back. */
export function handoffLine(tag: string, task: string, doneWhen = '', dueMinutes = 30): string {
  return [`@${tag} handoff: ${task}`, ...(doneWhen ? [`done when: ${doneWhen}`] : []), `due: ${dueMinutes}m`].join(
    ' · '
  )
}

export function nudgeLine(tag: string, task: string): string {
  return `@${tag} nudge — still on "${task}"? Reply "Accepted", "Declined: <why>", or deliver with proof.`
}

export const STATUS_CHECK_LINE =
  '@everyone status check: one line each — what you are on, what blocks you, and when it lands. Pass if idle.'
