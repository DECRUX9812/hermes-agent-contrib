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
import {
  $groupReadAt,
  $groupThreadReadAt,
  bindGroupReadTracking,
  groupThreadMarksFor,
  groupThreadUnseenCounts,
  groupUnreadCount,
  markGroupRead,
  markGroupThreadsRead
} from './group-unread'
import type { GroupChat, GroupMessage } from './types'

function entry(at: number, kind: 'member' | 'user', thread = 'legacy'): GroupMessage {
  return { at, from: { kind, name: kind === 'member' ? 'research' : 'you' }, text: `m${at}`, thread }
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
  $groupThreadReadAt.set({})
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

  it('drops per-thread marks for tombstoned rooms so a recreate starts clean', () => {
    const stop = bindGroupReadTracking()

    try {
      $groupChats.set({ Council: room([entry(10, 'member', 'a')]) })
      markGroupThreadsRead('Council')
      expect(Object.keys($groupThreadReadAt.get())).toEqual(['id:r1::a'])

      $groupChats.set({ Council: { ...room([entry(10, 'member', 'a')]), tombstone: true } })
      expect($groupThreadReadAt.get()).toEqual({})
    } finally {
      stop()
    }
  })
})

describe('the rail\'s per-thread "new" counts', () => {
  it('counts only member entries a thread gained past its own mark', () => {
    const log = [entry(10, 'user', 'a'), entry(20, 'member', 'a'), entry(30, 'user', 'a'), entry(40, 'member', 'b')]

    // Nothing opened yet: every member entry is new, the user's own are not.
    expect(groupThreadUnseenCounts(log, {})).toEqual({ a: 1, b: 1 })

    // Thread a was opened after its 30 mark — only b still nudges.
    expect(groupThreadUnseenCounts(log, { a: 30 })).toEqual({ b: 1 })

    // Opening everything clears the whole rail.
    expect(groupThreadUnseenCounts(log, { a: 30, b: 40 })).toEqual({})
  })

  it("reads each room's marks off its own roomKey, never another room's", () => {
    const marks = { 'id:r1::a': 20, 'id:r1::b': 5, 'id:r2::a': 99 }

    expect(groupThreadMarksFor(marks, 'id:r1')).toEqual({ a: 20, b: 5 })
    expect(groupThreadMarksFor(marks, 'id:r9')).toEqual({})
  })

  it('marks the threads actually opened, and a room-wide mark for All activity', () => {
    $groupChats.set({ Council: room([entry(10, 'member', 'a'), entry(20, 'member', 'b')]) })

    markGroupThreadsRead('Council', ['a'])
    expect($groupThreadReadAt.get()).toEqual({ 'id:r1::a': 10 })

    // A mark only ever moves forward — re-opening an old thread cannot
    // un-read something that arrived since.
    markGroupThreadsRead('Council', ['a'])
    expect($groupThreadReadAt.get()).toEqual({ 'id:r1::a': 10 })

    markGroupThreadsRead('Council')
    expect($groupThreadReadAt.get()).toEqual({ 'id:r1::a': 10, 'id:r1::b': 20 })
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
