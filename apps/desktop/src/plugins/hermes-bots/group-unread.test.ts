import { beforeEach, describe, expect, it, vi } from 'vitest'

// Group unread badges (revamp A6): renderer-local read marks keyed by
// groupChatRoomKey. Invariants under test:
//   1. Only member-authored entries after the mark are unread — the user's
//      own messages and the history present when the room first appears
//      (first-sight seeding) never badge.
//   2. markGroupRead clears the badge and tombstoned rooms drop their mark,
//      so a recreated room starts clean instead of resurrecting stale counts.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

import { $groupChats } from './group-chat'
import { $groupReadAt, bindGroupReadTracking, groupUnreadCount, markGroupRead } from './group-unread'
import type { GroupChat, GroupMessage } from './types'

function entry(at: number, kind: 'member' | 'user'): GroupMessage {
  return { at, from: { kind, name: kind === 'member' ? 'research' : 'you' }, text: `m${at}` }
}

function room(log: GroupMessage[]): GroupChat {
  return {
    epoch: 0,
    heldMessages: {},
    holds: {},
    log,
    members: [],
    pinned: false,
    roomId: 'r1',
    running: false,
    watermarks: {}
  }
}

beforeEach(() => {
  for (const key of Object.keys(host)) {
    delete host[key]
  }

  $groupChats.set({})
  $groupReadAt.set({})
})

describe('group unread badges', () => {
  it('badges only member entries after the mark; first sight seeds as read', () => {
    const stop = bindGroupReadTracking()

    try {
      // Room appears with stored history → seeded, so nothing is unread.
      $groupChats.set({ Council: room([entry(10, 'member'), entry(20, 'user')]) })
      expect(groupUnreadCount($groupChats.get().Council!.log, $groupReadAt.get()['id:r1'] || 0)).toBe(0)

      // New member traffic badges; the user's own reply does not.
      $groupChats.set({
        Council: room([
          entry(10, 'member'),
          entry(20, 'user'),
          entry(30, 'member'),
          entry(40, 'user'),
          entry(50, 'member')
        ])
      })
      const readAt = $groupReadAt.get()['id:r1'] || 0
      expect(groupUnreadCount($groupChats.get().Council!.log, readAt)).toBe(2)

      markGroupRead('Council')
      expect(groupUnreadCount($groupChats.get().Council!.log, $groupReadAt.get()['id:r1'] || 0)).toBe(0)
    } finally {
      stop()
    }
  })

  it('drops marks for tombstoned rooms so a recreate starts clean', () => {
    const stop = bindGroupReadTracking()

    try {
      $groupChats.set({ Council: room([entry(10, 'member')]) })
      $groupChats.set({
        Council: { ...room([entry(10, 'member'), entry(20, 'member')]), tombstone: true }
      })

      expect($groupReadAt.get()['id:r1']).toBeUndefined()
    } finally {
      stop()
    }
  })
})
