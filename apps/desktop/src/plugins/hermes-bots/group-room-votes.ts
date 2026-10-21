/**
 * The room's decision protocol: a question put to the team, every pick read
 * off the thread that follows, and the call recorded — so a decision the user
 * made at 2am is still legible a week later.
 *
 * A decision is one line anyone writes (the composer's "Ask to decide" chip
 * fills the template):
 *
 *     @everyone decide: ship the rewrite or keep the old one? · options: ship / keep
 *
 * Members answer in that thread. A pick is either the protocol word —
 *
 *     vote: ship
 *
 * — or simply naming the option in a reply ("ship it", "keep the old one"),
 * which is how people actually answer. The LAST pick per voice wins, because
 * people change their mind mid-thread and the current answer is the one that
 * counts. "(pass)" never counts as a pick.
 *
 * The decision is called when the user records it (the card's Call it button,
 * or a later "decided:" line in the thread). Until then the card shows where
 * the team stands: unanimous, a majority, a split, or who is still missing.
 *
 * Pure derivation over the room log — no state of its own, so the card always
 * matches the conversation it summarizes.
 */

import { groupThreadOf } from './group-chat'
import { isGroupPassText } from './group-turns'
import type { GroupMember, GroupMessage } from './types'

const DECIDE = /(?:^|\s)@everyone\s+decide\s*:\s*(.+)/i
const FIELD_SPLIT = /\s*[·|;]\s*/
const OPTIONS = /^options?\s*:\s*/i
const VOTE = /\b(?:vote|pick|voting)\s*:\s*(.+)$/i
/** The user recording the outcome, in their own words or the card's. */
const DECIDED = /(?:^|\s)(?:@everyone\s+)?decide[sd]?\s*:\s*(.+)/i

/** Option labels split on " / ", " | " or " · " — the template's own shapes. */
function splitOptions(text: string): string[] {
  return String(text || '')
    .split(/\s*(?:\/|\||·)\s*/)
    .map(part => part.trim())
    .filter(Boolean)
}

/** An option label matched as a word, longest first so "ship now" beats "ship". */
function namesOption(text: string, option: string): boolean {
  if (!option) {
    return false
  }

  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`(^|[^\\w])${escaped}([^\\w]|$)`, 'i').test(text)
}

export interface RoomVote {
  at: number
  id: string
  index: number
  options: string[]
  question: string
  /** The option the user called, or '' while the decision is still open. */
  decided: string
  /** Log index of that call, or -1. */
  decidedIndex: number
  /** Members who have not picked yet — the card's "waiting on". */
  missing: string[]
  from: string
  thread: string
  /** Speaker name → the option they last picked. */
  votes: Record<string, string>
}

/** One "decide:" line → its question and options, or null when it isn't one. */
export function parseDecisionLine(text: string): null | { options: string[]; question: string } {
  for (const line of String(text || '').split('\n')) {
    const match = line.match(DECIDE)

    if (!match) {
      continue
    }

    const parts = match[1]!.split(FIELD_SPLIT).map(part => part.trim())
    const optionsPart = parts.find(part => OPTIONS.test(part))

    const question = parts
      .filter(part => !OPTIONS.test(part))
      .join(' · ')
      .trim()

    const options = optionsPart ? splitOptions(optionsPart.replace(OPTIONS, '')) : []

    if (question) {
      return { options, question }
    }
  }

  return null
}

/** The option a reply picks, or '' when it names none. */
function pickOf(text: string, options: readonly string[]): string {
  const explicit = text.match(VOTE)
  const said = String(explicit ? explicit[1]! : text).trim()

  // Longest label first: "ship now" must not lose to its own prefix.
  return [...options].sort((a, b) => b.length - a.length).find(option => namesOption(said, option)) || ''
}

export function deriveRoomVotes(log: readonly GroupMessage[], members: readonly GroupMember[]): RoomVote[] {
  const votes: RoomVote[] = []

  log.forEach((entry, index) => {
    const parsed = parseDecisionLine(entry.text)

    if (!parsed) {
      return
    }

    const thread = groupThreadOf(entry)
    const tally: Record<string, string> = {}
    let decided = ''
    let decidedIndex = -1

    for (let next = index + 1; next < log.length; next++) {
      const later = log[next]!

      if (groupThreadOf(later) !== thread) {
        continue
      }

      const text = String(later.text || '').trim()
      const who = later.from?.kind === 'user' ? 'You' : later.from?.name || ''

      if (!text || !who) {
        continue
      }

      // The user calling it: the card's button, or the same words by hand.
      if (later.from?.kind === 'user') {
        const call = text.match(DECIDED)
        const called = call ? pickOf(call[1]!, parsed.options) : ''

        if (called) {
          decided = called
          decidedIndex = next
        }

        continue
      }

      if (isGroupPassText(text)) {
        continue
      }

      const pick = pickOf(text, parsed.options)

      if (pick) {
        tally[who] = pick
      }
    }

    votes.push({
      at: Number(entry.at) || 0,
      id: entry.id || `${thread}:${index}`,
      index,
      options: parsed.options,
      question: parsed.question,
      decided,
      decidedIndex,
      missing: members.filter(m => !(m.name in tally)).map(m => m.name),
      from: entry.from?.kind === 'user' ? 'You' : entry.from?.name || '',
      thread,
      votes: tally
    })
  })

  return votes
}

/** Where the team stands. The card turns this into one word, and it is
 *  measured against everyone who was asked — not just the votes cast, so a
 *  2-of-5 lead never reads as a team that has decided. */
export function voteConsensus(
  vote: RoomVote,
  members: readonly GroupMember[]
): 'majority' | 'split' | 'unanimous' | 'waiting' {
  const counts = new Map<string, number>()

  for (const pick of Object.values(vote.votes)) {
    counts.set(pick, (counts.get(pick) || 0) + 1)
  }

  if (!counts.size) {
    return 'waiting'
  }

  const top = Math.max(...counts.values())
  const asked = Math.max(members.length, 1)

  // Nobody left to ask and one option carries every pick.
  if (!vote.missing.length && counts.size === 1) {
    return 'unanimous'
  }

  if (top > asked / 2) {
    return counts.size === 1 && !vote.missing.length ? 'unanimous' : 'majority'
  }

  // A tie for the lead, or no option past a quarter of the room.
  return counts.size > 1 && [...counts.values()].filter(n => n === top).length > 1 ? 'split' : 'majority'
}

/** Votes keyed by the log index that asked — the same shape handoffs use, so
 *  a card lands directly under the line that called for it. */
export function roomVotesAt(votes: readonly RoomVote[]): Map<number, RoomVote[]> {
  const at = new Map<number, RoomVote[]>()

  for (const vote of votes) {
    at.set(vote.index, [...(at.get(vote.index) ?? []), vote])
  }

  return at
}

// ── What the room sends (protocol words, so never translated) ──────────────

/** A decision line in the exact shape parseDecisionLine reads back. */
export function decideLine(question: string, options: readonly string[]): string {
  return `@everyone decide: ${question} · options: ${options.join(' / ')}`
}

/** Recording the outcome — the card's Call it button, and the words that
 *  read the same when someone types them by hand. */
export function decidedLine(option: string): string {
  return `decided: ${option}`
}

export function voteLine(option: string): string {
  return `vote: ${option}`
}
