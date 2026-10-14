/**
 * Archived rooms: local presentation, never synced. An archived room leaves
 * the pin band and its user section and waits under the Archived band until
 * the user opens it again. Keyed by the room's stable key
 * (`groupChatRoomKey`), like the per-room role labels.
 */

import { atom } from 'nanostores'

import { $groupChats, groupChatRoomKey } from './group-chat'
import { toggleGroupChatPinned } from './group-pin'

const STORAGE_KEY = 'hermes.bots.roomArchive.v1'

/** Archived room keys. Presence means archived; the value carries nothing. */
export type RoomArchive = Record<string, true>

function load(): RoomArchive {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null

    if (!parsed || typeof parsed !== 'object') {
      return {}
    }

    return Object.fromEntries(Object.keys(parsed as Record<string, unknown>).map(key => [key, true as const]))
  } catch {
    return {}
  }
}

export const $roomArchive = atom<RoomArchive>(typeof window === 'undefined' ? {} : load())

function save(next: RoomArchive): void {
  $roomArchive.set(next)

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage refused: the archive still holds for this session.
  }
}

/** Whether the room key is archived. */
export function isRoomArchived(archived: RoomArchive, roomKey: string): boolean {
  return Boolean(roomKey && archived?.[roomKey])
}

/** Archive or unarchive by stable room key. Archiving unpins the room, since
 *  a pinned room that also waits under Archived would read as two places. */
export function setRoomArchived(roomKey: string, archived: boolean): void {
  if (!roomKey) {
    return
  }

  const next = { ...$roomArchive.get() }

  if (archived) {
    next[roomKey] = true
  } else {
    delete next[roomKey]
  }

  save(next)

  if (archived) {
    const entry = Object.entries($groupChats.get()).find(
      ([name, room]) => room && !room.tombstone && groupChatRoomKey(name, room) === roomKey
    )

    if (entry && entry[1].pinned) {
      toggleGroupChatPinned(entry[0])
    }
  }
}
