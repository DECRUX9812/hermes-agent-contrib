/**
 * The room's work list: every thread read as a ticket (Paperclip's shape —
 * the ask, who is on it, where it stands), derived purely from the room log.
 *
 * The log itself stays one arrival-ordered conversation; this is an index over
 * it, so the user can see what is in flight without scrolling for it.
 */

import { groupThreadOf } from './group-chat'
import type { GroupMessage } from './types'

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
}

const TITLE_MAX = 90

const STATUS_RANK: Record<RoomWorkStatus, number> = { waiting: 0, working: 1, open: 2, answered: 3 }

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line
}

export function roomWorkItems(
  log: readonly GroupMessage[],
  { running, waitingThreads }: { running: boolean; waitingThreads: ReadonlySet<string> }
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

    const status: RoomWorkStatus = waitingThreads.has(thread)
      ? 'waiting'
      : running && thread === activeThread
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
      title: oneLine(ask.entry.text) || thread
    }
  })

  return items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.lastAt - a.lastAt)
}
