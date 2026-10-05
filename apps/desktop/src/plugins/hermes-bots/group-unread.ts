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
  })
}
