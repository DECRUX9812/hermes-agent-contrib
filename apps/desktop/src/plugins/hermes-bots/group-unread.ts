/**
 * Group-room unread tracking (revamp A6): the renderer-local watermark behind
 * the roster's unread badge. Same convention as the session store's unread
 * watermarks — seed on first sight, count entries the user hasn't seen, clear
 * when the room is opened (openGroupChat already clears needs-you there).
 *
 * Keyed by groupChatRoomKey so a rename keeps the mark; runtime-only on
 * purpose — a restart re-seeds from the hydrated log instead of resurrecting
 * stale badges.
 */

import { atom } from '@hermes/plugin-sdk'

import { $groupChats, $groupChatWorkspace, groupChatRoomKey } from './group-chat'
import type { GroupChat, GroupMessage } from './types'

/** ~80 chars of the last entry's text, per the A6 one-line summary contract. */
export const GROUP_ROUND_PREVIEW_CHARS = 80

/** roomKey → `at` of the newest entry the user has seen. */
export const $groupReadAt = atom<Record<string, number>>({})

/** Entries that count as unread: anything a member (not the user) wrote after
 *  the read mark. Pure for the badge contract's tests. */
export function groupUnreadCount(log: GroupMessage[], readAt: number): number {
  return (Array.isArray(log) ? log : []).filter(
    entry => entry?.from?.kind === 'member' && Number(entry.at || 0) > readAt
  ).length
}

/** The roster row's one-line last-round summary: last speaker + the start of
 *  their text. Pure; the caller supplies the speaker label. */
export function groupLastRoundSummary(room: GroupChat | null | undefined): { last: GroupMessage | null; text: string } {
  const log = Array.isArray(room?.log) ? room.log : []
  const last = log.length ? log[log.length - 1] : null

  const text = String(last?.text || '')
    .split('\n')
    .join(' ')
    .trim()
    .slice(0, GROUP_ROUND_PREVIEW_CHARS)

  return { last, text }
}

/** Seed unseen rooms at their current tail — a first sight of stored history
 *  is "read", matching how session watermarks seed on first poll. */
export function noteGroupRoomsSeen(rooms: Record<string, GroupChat | undefined>): void {
  const current = $groupReadAt.get()
  let next: Record<string, number> | null = null

  for (const [name, room] of Object.entries(rooms)) {
    if (!room || room.tombstone) {
      continue
    }

    const key = groupChatRoomKey(name, room)

    if (key in current) {
      continue
    }

    const log = Array.isArray(room.log) ? room.log : []
    const tail = log.length ? Number(log[log.length - 1].at || 0) : 0

    if (!next) {
      next = { ...current }
    }

    next[key] = tail
  }

  if (next) {
    $groupReadAt.set(next)
  }
}

/** Read = newest entry seen. Opening a room (or watching it while open)
 *  clears the badge; called beside the needs-you clear in openGroupChat. */
/** roomKey → the read mark as it stood when the user last OPENED the room —
 *  the "while you were away" anchor. markGroupRead moves the live mark to the
 *  tail the moment a room opens (and keeps it there while open), so the
 *  catch-up card needs the value from just before. Runtime-only, like the mark. */
export const $groupVisitAnchor = atom<Record<string, number>>({})

/** Opening a room: remember where the user left off, then mark it read. */
export function markGroupOpened(group: string): void {
  const room = $groupChats.get()[group]

  if (room) {
    const key = groupChatRoomKey(group, room)
    $groupVisitAnchor.set({ ...$groupVisitAnchor.get(), [key]: $groupReadAt.get()[key] || 0 })
  }

  markGroupRead(group)
  // The rail's per-thread marks open WITH the room: the user is looking at
  // all of it, so every thread starts read. Only what arrives next and isn't
  // opened counts as new.
  markGroupThreadsRead(group)
}

/** First sight of a room (a workspace mounted that openGroupChat didn't
 *  route through): seed the threads it has never marked, so history never
 *  badges. Threads already marked keep their mark — a remount must not
 *  un-read something that arrived while the user was looking elsewhere. */
export function noteGroupThreadsSeen(group: string): void {
  const room = $groupChats.get()[group]

  if (!room) {
    return
  }

  const key = groupChatRoomKey(group, room)
  const tails = groupThreadTails(Array.isArray(room.log) ? room.log : [])
  const current = $groupThreadReadAt.get()
  const next = { ...current }
  let changed = false

  for (const [thread, at] of Object.entries(tails)) {
    const mark = `${key}::${thread}`

    if (!(mark in next)) {
      next[mark] = at
      changed = true
    }
  }

  if (changed) {
    $groupThreadReadAt.set(next)
  }
}

/** roomKey + thread → `at` of the newest entry the user has actually looked
 *  at in that thread. Runtime-only, like the room marks. */
export const $groupThreadReadAt = atom<Record<string, number>>({})

/** Newest `at` per thread in a room's log. */
function groupThreadTails(log: readonly GroupMessage[]): Record<string, number> {
  const tails: Record<string, number> = {}

  for (const entry of Array.isArray(log) ? log : []) {
    const thread = entry?.thread || 'legacy'
    const at = Number(entry?.at || 0)

    if (at > (tails[thread] ?? -1)) {
      tails[thread] = at
    }
  }

  return tails
}

/** Member entries per thread the user hasn't opened yet, keyed by thread.
 *  One pass over the log; the rail renders whatever this returns. */
export function groupThreadUnseenCounts(
  log: readonly GroupMessage[],
  readAtByThread: Readonly<Record<string, number>>
): Record<string, number> {
  const unseen: Record<string, number> = {}

  for (const entry of Array.isArray(log) ? log : []) {
    if (entry?.from?.kind !== 'member') {
      continue
    }

    const thread = entry?.thread || 'legacy'

    if (Number(entry?.at || 0) > (readAtByThread[thread] ?? -1)) {
      unseen[thread] = (unseen[thread] || 0) + 1
    }
  }

  return unseen
}

/** The marks belonging to one room, keyed by thread — the shape the rail's
 *  counts want. Pure; the caller holds the atom. */
export function groupThreadMarksFor(marks: Readonly<Record<string, number>>, roomKey: string): Record<string, number> {
  const prefix = `${roomKey}::`
  const forRoom: Record<string, number> = {}

  for (const [mark, at] of Object.entries(marks)) {
    if (mark.startsWith(prefix)) {
      forRoom[mark.slice(prefix.length)] = at
    }
  }

  return forRoom
}

/** Every thread's mark moves to its tail: the user is looking at the room
 *  (opened it, or is following the log at the bottom), so all of it is read.
 *  Called with `threads` to clear just the ones they actually opened. */
export function markGroupThreadsRead(group: string, threads?: readonly string[]): void {
  const room = $groupChats.get()[group]

  if (!room) {
    return
  }

  const key = groupChatRoomKey(group, room)
  const tails = groupThreadTails(Array.isArray(room.log) ? room.log : [])
  const next = { ...$groupThreadReadAt.get() }
  let changed = false

  for (const [thread, at] of Object.entries(
    threads ? Object.fromEntries(threads.map(t => [t, tails[t] ?? 0])) : tails
  )) {
    const mark = `${key}::${thread}`

    if (at > (next[mark] ?? -1)) {
      next[mark] = at
      changed = true
    }
  }

  if (changed) {
    $groupThreadReadAt.set(next)
  }
}

export function markGroupRead(group: string): void {
  const room = $groupChats.get()[group]

  if (!room) {
    return
  }

  const key = groupChatRoomKey(group, room)
  const log = Array.isArray(room.log) ? room.log : []
  const tail = log.length ? Number(log[log.length - 1].at || 0) : 0

  if (($groupReadAt.get()[key] || 0) === tail) {
    return
  }

  $groupReadAt.set({ ...$groupReadAt.get(), [key]: tail })
}

/** Wire the watermark lifecycle: seed rooms on first sight, keep the open
 *  room marked read as its log grows, drop marks for rooms that are gone. */
export function bindGroupReadTracking(): () => void {
  noteGroupRoomsSeen($groupChats.get())

  return $groupChats.listen(rooms => {
    noteGroupRoomsSeen(rooms)

    // A room that is open absorbs new entries as read — the user is looking.
    const open = $groupChatWorkspace.get()

    if (open && rooms[open]) {
      markGroupRead(open)
    }

    // Tombstones/deleted rooms drop their mark so a recreate starts clean.
    const live = new Set(
      Object.entries(rooms)
        .filter(([, room]) => room && !room.tombstone)
        .map(([name, room]) => groupChatRoomKey(name, room!))
    )

    const current = $groupReadAt.get()
    const stale = Object.keys(current).filter(key => !live.has(key))

    if (stale.length) {
      const next = { ...current }

      for (const key of stale) {
        delete next[key]
      }

      $groupReadAt.set(next)
    }

    // Per-thread marks follow the same lifecycle: a dead room takes its
    // marks with it, so a recreate starts clean instead of badging history.
    const threadMarks = $groupThreadReadAt.get()
    const staleThreads = Object.keys(threadMarks).filter(mark => !live.has(mark.split('::')[0]!))

    if (staleThreads.length) {
      const next = { ...threadMarks }

      for (const mark of staleThreads) {
        delete next[mark]
      }

      $groupThreadReadAt.set(next)
    }
  })
}
