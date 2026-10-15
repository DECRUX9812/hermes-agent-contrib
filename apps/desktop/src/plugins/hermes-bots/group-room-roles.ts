/**
 * Role labels inside one room ("Lead", "Designer", "Reviewer"): what a bot
 * does HERE, shown in the members panel and on its messages in place of its
 * global title. Set when a room is created from a template or edited later.
 *
 * Presentation on this machine, like a room's pin and order: kept in this
 * browser's storage keyed by the room's stable key (`groupChatRoomKey`), never
 * in the room record the gateway mirrors. Storage can refuse; the labels then
 * hold for the session.
 */

import { atom } from 'nanostores'

const STORAGE_KEY = 'hermes.bots.roomRoles.v1'

/** roomKey → member key (`groupMemberKey`) → role label. */
export type RoomRoles = Record<string, Record<string, string>>

function load(): RoomRoles {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null

    return parsed && typeof parsed === 'object' ? (parsed as RoomRoles) : {}
  } catch {
    return {}
  }
}

export const $roomRoles = atom<RoomRoles>(typeof window === 'undefined' ? {} : load())

function save(next: RoomRoles): void {
  $roomRoles.set(next)

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage refused: the labels still hold for this session.
  }
}

/** The member's role in this room, or '' when none was given. */
export function roomRole(roles: RoomRoles, roomKey: string, memberKey: string): string {
  return (roles[roomKey]?.[memberKey] || '').trim()
}

/** Replace one room's labels; empty labels are dropped. */
export function setRoomRoles(roomKey: string, labels: Record<string, string>): void {
  const kept = Object.fromEntries(
    Object.entries(labels)
      .map(([member, label]) => [member, label.trim()] as const)
      .filter(([, label]) => label)
  )

  const next = { ...$roomRoles.get() }

  if (Object.keys(kept).length) {
    next[roomKey] = kept
  } else {
    delete next[roomKey]
  }

  save(next)
}
