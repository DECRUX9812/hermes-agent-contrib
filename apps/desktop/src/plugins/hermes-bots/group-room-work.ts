/**
 * The room's work list: every thread read as a ticket (Paperclip's shape —
 * the ask, who is on it, where it stands), derived purely from the room log.
 *
 * The log itself stays one arrival-ordered conversation; this is an index over
 * it, so the user can see what is in flight without scrolling for it.
 */

import { groupThreadOf } from './group-chat'
import { groupMemberKey, groupSessionMemberKey, groupSessionThread } from './group-membership'
import type { GroupMember, GroupMessage } from './types'

/** Dot states that mean a session is mid-turn right now. */
const LIVE_DOTS: ReadonlySet<string> = new Set(['background', 'stalled', 'working'])

/**
 * Who is working on which thread RIGHT NOW, read off the room's own member
 * sessions (one per member per thread) and their live status dots — the honest
 * signal: a bot grinding through a long task in its thread session shows here
 * even while the room's own round has long settled.
 */
export function roomLiveWork(
  sessions: Readonly<Record<string, string | true>> | undefined,
  dotById: Readonly<Record<string, string>> | undefined,
  members: readonly GroupMember[]
): Map<string, Set<string>> {
  const nameByKey = new Map(members.map(member => [groupMemberKey(member), member.name]))
  const live = new Map<string, Set<string>>()

  for (const [key, sessionId] of Object.entries(sessions || {})) {
    const name = nameByKey.get(groupSessionMemberKey(key))

    if (typeof sessionId === 'string' && name && LIVE_DOTS.has(dotById?.[sessionId] ?? '')) {
      const thread = groupSessionThread(key)
      live.set(thread, (live.get(thread) ?? new Set()).add(name))
    }
  }

  return live
}

/** working: a member is on it now · waiting: a bot asked you something ·
 *  answered: the last word is a bot's · open: asked, nobody has answered. */
export type RoomWorkStatus = 'answered' | 'open' | 'waiting' | 'working'

export interface RoomWorkItem {
  /** Members who have spoken in the thread, first voice first. */
  assignees: string[]
  count: number
  lastAt: number
  /** Index of the thread's newest entry in the log (the jump target). */
  lastIndex: number
  status: RoomWorkStatus
  thread: string
  title: string
  /** Members mid-turn on this thread right now. */
  working: string[]
}

const TITLE_MAX = 90

const STATUS_RANK: Record<RoomWorkStatus, number> = { waiting: 0, working: 1, open: 2, answered: 3 }

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line
}

export function roomWorkItems(
  log: readonly GroupMessage[],
  {
    live = new Map(),
    running,
    waitingThreads
  }: { live?: ReadonlyMap<string, ReadonlySet<string>>; running: boolean; waitingThreads: ReadonlySet<string> }
): RoomWorkItem[] {
  const byThread = new Map<string, { entries: { entry: GroupMessage; index: number }[] }>()
  let activeThread: null | string = null

  log.forEach((entry, index) => {
    const thread = groupThreadOf(entry)
    const bucket = byThread.get(thread) ?? { entries: [] }
    bucket.entries.push({ entry, index })
    byThread.set(thread, bucket)

    // A running room is answering the newest thing the user said.
    if (entry.from?.kind === 'user') {
      activeThread = thread
    }
  })

  const items = [...byThread].map(([thread, { entries }]): RoomWorkItem => {
    const ask = entries.find(({ entry }) => entry.from?.kind === 'user' && entry.text.trim()) ?? entries[0]!
    const last = entries.at(-1)!

    const assignees = [
      ...new Set(entries.filter(({ entry }) => entry.from?.kind === 'member').map(({ entry }) => entry.from.name))
    ]

    const working = [...(live.get(thread) ?? [])]

    const status: RoomWorkStatus = waitingThreads.has(thread)
      ? 'waiting'
      : working.length || (running && thread === activeThread)
        ? 'working'
        : last.entry.from?.kind === 'member'
          ? 'answered'
          : 'open'

    return {
      assignees,
      count: entries.length,
      lastAt: last.entry.at,
      lastIndex: last.index,
      status,
      thread,
      title: oneLine(ask.entry.text) || thread,
      working
    }
  })

  return items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.lastAt - a.lastAt)
}
