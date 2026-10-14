/**
 * Who in a room needs the user, who is on it, who is idle: the members panel's
 * grouping, derived from the room's own signals. Pure, so the grouping rules
 * are testable without rendering.
 */

import { groupMemberKey } from './group-membership'
import type { GroupMember, GroupPrompt } from './types'

export type RoomMemberStatus = 'idle' | 'offline' | 'waiting' | 'working'

export interface RoomMemberEntry {
  key: string
  member: GroupMember
  /** The open question or approval this member is blocked on. */
  prompt: GroupPrompt | null
  /** When the current state began: the prompt's stamp or the working stamp. */
  since: number | null
  status: RoomMemberStatus
}

export interface RoomMemberGroups {
  lead: RoomMemberEntry | null
  waiting: RoomMemberEntry[]
  working: RoomMemberEntry[]
  idle: RoomMemberEntry[]
}

export interface RoomMemberSignals {
  available: (member: GroupMember) => boolean
  leadMember: GroupMember | null
  members: readonly GroupMember[]
  prompts: readonly GroupPrompt[]
  /** Member names mid-turn in this room, including live work on other threads. */
  working: ReadonlySet<string>
  /** Working stamp per member name (the activity log's `member`). */
  workingSince: ReadonlyMap<string, number>
}

function entryFor(member: GroupMember, signals: RoomMemberSignals): RoomMemberEntry {
  const key = groupMemberKey(member)
  const prompt = signals.prompts.find(p => p.memberKey === key) ?? null

  let status: RoomMemberStatus = 'idle'

  if (prompt) {
    status = 'waiting'
  } else if (signals.working.has(member.name)) {
    status = 'working'
  } else if (!signals.available(member)) {
    status = 'offline'
  }

  const since = prompt ? prompt.at : status === 'working' ? (signals.workingSince.get(member.name) ?? null) : null

  return { key, member, prompt, since, status }
}

// Longest-running first, so a member does not jump when another one starts.
const bySince = (a: RoomMemberEntry, z: RoomMemberEntry) =>
  (a.since ?? Number.MAX_SAFE_INTEGER) - (z.since ?? Number.MAX_SAFE_INTEGER)

// Reachable before offline, then by name, so the idle list stays put.
const byName = (a: RoomMemberEntry, z: RoomMemberEntry) =>
  Number(a.status === 'offline') - Number(z.status === 'offline') || a.member.name.localeCompare(z.member.name)

/** Waiting beats working beats idle; the lead sits alone above the groups. */
export function roomMemberGroups(signals: RoomMemberSignals): RoomMemberGroups {
  const leadKey = signals.leadMember ? groupMemberKey(signals.leadMember) : ''
  const groups: RoomMemberGroups = { lead: null, waiting: [], working: [], idle: [] }

  for (const member of signals.members) {
    const entry = entryFor(member, signals)

    if (entry.key === leadKey) {
      groups.lead = entry
    } else if (entry.status === 'waiting') {
      groups.waiting.push(entry)
    } else if (entry.status === 'working') {
      groups.working.push(entry)
    } else {
      groups.idle.push(entry)
    }
  }

  groups.waiting.sort(bySince)
  groups.working.sort(bySince)
  groups.idle.sort(byName)

  return groups
}

/** Elapsed time as m:ss, minutes unbounded: a 75-minute run reads 75:00. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))

  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
