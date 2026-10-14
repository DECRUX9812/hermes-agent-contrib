import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as groupActivity from './group-activity'
import type * as groupChat from './group-chat'
import type { GroupChatRoom } from './group-chat'
import type * as groupRounds from './group-rounds'
import { createGroupGateway, runTimersInline, scriptedStorage } from './group-test-utils'
import type { GatewayOptions, ScriptedGateway } from './group-test-utils'
import type * as groupTurns from './group-turns'
import type { GroupChat, GroupMember } from './types'

// stopGroupMember: stop ONE bot and let the rest of the round carry on. The
// room-wide stop bumps the epoch and holds everyone; the member stop holds
// only its target (same #93129 stamp) and interrupts only its thread session,
// without touching the epoch, `running`, or `turn`.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

interface Room {
  activity: typeof groupActivity
  chat: typeof groupChat
  gateway: ScriptedGateway
  rounds: typeof groupRounds
  turns: typeof groupTurns
}

async function loadRoom(options: GatewayOptions = {}): Promise<Room> {
  vi.resetModules()
  const gateway = createGroupGateway(options)

  for (const key of Object.keys(host)) {
    delete host[key]
  }

  Object.assign(host, gateway.host)

  const [activity, chat, rounds, turns, shared] = await Promise.all([
    import('./group-activity'),
    import('./group-chat'),
    import('./group-rounds'),
    import('./group-turns'),
    import('./shared')
  ])

  shared.setPluginCtx(scriptedStorage(gateway.storage))

  return { activity, chat, gateway, rounds, turns }
}

const MEMBERS: GroupMember[] = [
  { name: 'alpha', title: '' },
  { name: 'beta', title: '' },
  { name: 'gamma', title: '' }
]

/** Seed a room mid-round: epoch 3, running, beta on turn with a live thread
 *  session for t1, gamma already held from an earlier stop. */
function seedRoom(room: Room, seed: Partial<GroupChatRoom> = {}) {
  room.chat.$groupChats.set({
    Room: {
      epoch: 3,
      holds: { gamma: { at: 1000, byMessageId: null, thread: null } },
      log: [],
      members: MEMBERS,
      running: true,
      sessions: { 'thread:t1::alpha': 'live-alpha-sid', 'thread:t1::beta': 'live-beta-sid' },
      turn: MEMBERS[1],
      watermarks: {},
      ...seed
    }
  } as unknown as Record<string, GroupChat>)
}

beforeEach(() => {
  runTimersInline()
})

describe('stopGroupMember', () => {
  it('holds only the target and leaves the epoch, running state, turn and other holds alone', async () => {
    const room = await loadRoom()
    seedRoom(room)

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[1], MEMBERS)

    const after = room.chat.$groupChats.get()['Room']

    expect(after.epoch).toBe(3)
    expect(after.stoppedEpoch || 0).toBe(0)
    expect(after.running).toBe(true)
    expect(after.turn?.name).toBe('beta')
    // The earlier gamma hold keeps its stamp; alpha is untouched.
    expect(after.holds?.['gamma']).toEqual({ at: 1000, byMessageId: null, thread: null })
    expect(after.holds?.['beta']?.thread).toBe('t1')
    expect(after.holds?.['alpha']).toBeUndefined()
  })

  it('interrupts the on-turn member via its thread session only', async () => {
    const room = await loadRoom()
    seedRoom(room)

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[1], MEMBERS)

    const interrupts = room.gateway.rpcFor('session.interrupt')

    expect(interrupts).toHaveLength(1)
    expect(interrupts[0].params.session_id).toBe('live-beta-sid')
  })

  it('interrupts a member that is not on turn when it has a thread session', async () => {
    const room = await loadRoom()
    seedRoom(room)

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[0], MEMBERS)

    const interrupts = room.gateway.rpcFor('session.interrupt')

    expect(interrupts).toHaveLength(1)
    expect(interrupts[0].params.session_id).toBe('live-alpha-sid')
    expect(room.chat.$groupChats.get()['Room'].holds?.['alpha']?.thread).toBe('t1')
  })

  it('holds without any interrupt when the member has no session', async () => {
    const room = await loadRoom()
    seedRoom(room, { sessions: {} })

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[0], MEMBERS)

    expect(room.gateway.rpcFor('session.interrupt')).toHaveLength(0)
    expect(room.chat.$groupChats.get()['Room'].holds?.['alpha']?.thread).toBe('t1')
    expect(room.chat.$groupChats.get()['Room'].epoch).toBe(3)
  })

  it('honours holdDetection === false: no hold, but still interrupts', async () => {
    const room = await loadRoom()
    seedRoom(room, { holdDetection: false })

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[1], MEMBERS)

    const after = room.chat.$groupChats.get()['Room']

    // The pre-existing gamma hold survives; no NEW hold is minted.
    expect(after.holds?.['beta']).toBeUndefined()
    expect(after.holds?.['gamma']).toEqual({ at: 1000, byMessageId: null, thread: null })
    expect(after.epoch).toBe(3)
    expect(after.running).toBe(true)

    const interrupts = room.gateway.rpcFor('session.interrupt')

    expect(interrupts).toHaveLength(1)
    expect(interrupts[0].params.session_id).toBe('live-beta-sid')
  })

  it('falls back to the bare pointer for unmigrated rooms, and never prefers it when migrated', async () => {
    const room = await loadRoom()
    seedRoom(room, { sessions: { alpha: 'bare-alpha-sid' } })

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[0], MEMBERS)

    expect(room.gateway.rpcFor('session.interrupt').map(call => call.params.session_id)).toEqual(['bare-alpha-sid'])

    const migrated = await loadRoom()
    seedRoom(migrated, { sessions: { alpha: 'stale-bare-sid', 'thread:t1::alpha': 'live-alpha-sid' } })

    await migrated.rounds.stopGroupMember('Room', 't1', MEMBERS[0], MEMBERS)

    expect(migrated.gateway.rpcFor('session.interrupt').map(call => call.params.session_id)).toEqual(['live-alpha-sid'])
  })

  it('keeps an existing hold stamp instead of re-stamping it', async () => {
    const room = await loadRoom()
    seedRoom(room, { holds: { alpha: { at: 500, byMessageId: 'm1', thread: null } } })

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[0], MEMBERS)

    expect(room.chat.$groupChats.get()['Room'].holds?.['alpha']).toEqual({ at: 500, byMessageId: 'm1', thread: null })
  })

  it('records a member-stopped event reading "Stopped <Name>"', async () => {
    const room = await loadRoom()
    seedRoom(room)

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[1], MEMBERS)

    const events = room.activity.currentGroupActivity('Room')
    const stopped = events.filter(event => event.kind === 'member-stopped')

    expect(stopped).toHaveLength(1)
    expect(room.activity.groupActivityLabel(stopped[0], 'Room')).toBe('Stopped beta')
    expect(room.activity.GROUP_ACTIVITY_GLYPHS['member-stopped']).toBeTruthy()
    expect(events.some(event => event.kind === 'stopped')).toBe(false)
  })

  it('settles an interrupted turn promptly without an epoch move', async () => {
    let live: Room | null = null

    const room = await loadRoom({
      onResumePoll: polls => {
        if (polls === 2) {
          void live?.rounds.stopGroupMember('Room', 't1', { name: 'helper', title: '' })
        }
      },
      pollsBusy: 50,
      turn: () => 'long answer'
    })

    live = room

    const reply = await room.turns.runGroupChatMemberTurn('Room', { name: 'helper', title: '' }, 'long task', 't1', [])

    // The held member passes instead of grinding to the turn timeout: the
    // poll loop exits on the hold at the next beat (same prompt-settle bound
    // as the room-wide stop), not fifty beats later at the deadline.
    expect(reply).toBeNull()
    expect(room.gateway.rpcFor('session.resume').length).toBeLessThanOrEqual(6)

    const ended = room.chat.$groupChats.get()['Room']
    const events = room.activity.currentGroupActivity('Room')

    expect(ended.epoch || 0).toBe(0)
    expect(events.some(event => event.kind === 'timed-out')).toBe(false)
    expect(events.some(event => event.kind === 'member-stopped')).toBe(true)
  })

  it('leaves the remaining members drivable after one member stops', async () => {
    const room = await loadRoom()
    seedRoom(room)

    await room.rounds.stopGroupMember('Room', 't1', MEMBERS[1], MEMBERS)

    const after = room.chat.$groupChats.get()['Room']

    expect(after.running).toBe(true)
    expect(Object.keys(after.holds || {}).sort()).toEqual(['beta', 'gamma'])
  })
})
