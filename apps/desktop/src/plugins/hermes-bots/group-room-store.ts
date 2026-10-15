import { computed, useValue } from '@hermes/plugin-sdk'
import type { ReadableAtom } from 'nanostores'

import { $groupChats, type GroupChatRoom } from './group-chat'

/** One store per room name, so a row only wakes when its own room changes. */
const roomStores = new Map<string, ReadableAtom<GroupChatRoom | undefined>>()

/**
 * The room's slice of $groupChats. updateGroupChat swaps only the touched
 * room object, so computed keeps every other room's reference and their
 * subscribers stay quiet.
 */
export function groupChatRoomStore(name: string): ReadableAtom<GroupChatRoom | undefined> {
  const cached = roomStores.get(name)

  if (cached) {
    return cached
  }

  const store = computed($groupChats, rooms => rooms[name])
  roomStores.set(name, store)

  return store
}

/** The room's current value, re-rendering only when that room changes. */
export function useGroupChatRoom(name: string): GroupChatRoom | undefined {
  return useValue(groupChatRoomStore(name))
}
