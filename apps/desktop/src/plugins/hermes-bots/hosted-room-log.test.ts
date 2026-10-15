import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runTimersInline } from './group-test-utils'
import type {
  hostedRoomOwnerMember as hostedRoomOwnerMemberType,
  loadHostedRoomCheckpoint as loadHostedRoomCheckpointType,
  mergeHostedRoomEntries as mergeHostedRoomEntriesType,
  mergeHostedRoomEvents as mergeHostedRoomEventsType,
  persistHostedRoomCheckpoint as persistHostedRoomCheckpointType,
  projectHostedRoomEvents as projectHostedRoomEventsType,
  recordHostedRoomEvent as recordHostedRoomEventType,
  resetHostedRoomViewsForTest as resetHostedRoomViewsForTestType,
  roomDriveMode as roomDriveModeType,
  sendHostedRoomMessage as sendHostedRoomMessageType
} from './hosted-room-log'
import type { GroupChat, GroupMember, GroupMessage } from './types'
import type { RoomEvent } from '@hermes/shared'

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

interface HostedModule {
  hostedRoomOwnerMember: typeof hostedRoomOwnerMemberType
  loadHostedRoomCheckpoint: typeof loadHostedRoomCheckpointType
  mergeHostedRoomEntries: typeof mergeHostedRoomEntriesType
  mergeHostedRoomEvents: typeof mergeHostedRoomEventsType
  persistHostedRoomCheckpoint: typeof persistHostedRoomCheckpointType
  projectHostedRoomEvents: typeof projectHostedRoomEventsType
  recordHostedRoomEvent: typeof recordHostedRoomEventType
  resetHostedRoomViewsForTest: typeof resetHostedRoomViewsForTestType
  roomDriveMode: typeof roomDriveModeType
  sendHostedRoomMessage: typeof sendHostedRoomMessageType
  hostedRoomViewSnapshot: (roomId: string) => { activeMemberId: null | string }
}

async function loadHosted(): Promise<HostedModule> {
  vi.resetModules()
  const module = await import('./hosted-room-log')

  return module as HostedModule
}

const local = (name: string): GroupMember => ({
  connectionId: 'local',
  name,
  targetProfile: name
})

const remote = (name: string): GroupMember => ({
  ...local(name),
  connectionId: 'remote',
  remoteSource: true
})

function event(seq: number, kind: string, payload: Record<string, unknown>, eventId = `${kind}-${seq}`): RoomEvent {
  return {
    actor: { id: 'gateway', kind: 'gateway' },
    created_at: 1_700_000_000 + seq,
    event_id: eventId,
    kind,
    payload,
    room_id: 'room-1',
    seq
  }
}

beforeEach(() => {
  runTimersInline()
})

describe('hosted room drive policy', () => {
  it('uses the hosted driver only for a text-only all-local room on a capable gateway', async () => {
    const hosted = await loadHosted()
    const room: GroupChat = { roomId: 'room-1' }
    const ready = { capabilities: { driver: true }, status: 'ready' as const }

    expect(hosted.roomDriveMode(room, [local('ops'), local('review')], ready)).toBe('hosted')
    expect(hosted.roomDriveMode(room, [local('ops'), remote('review')], ready)).toBe('client')
    expect(hosted.roomDriveMode(room, [local('ops'), local('review')], { capabilities: { driver: false }, status: 'ready' })).toBe('client')
    expect(hosted.roomDriveMode({ ...room, holdDetection: false }, [local('ops'), local('review')], ready)).toBe('client')
    expect(hosted.roomDriveMode(room, [local('ops'), local('review')], ready, true)).toBe('client')
    expect(hosted.roomDriveMode({ ...room, holds: { ops: { at: 1 } } }, [local('ops'), local('review')], ready)).toBe('client')
  })

  it('keeps the room owner addressable after a roster edit removes that seat', async () => {
    const hosted = await loadHosted()

    expect(
      hosted.hostedRoomOwnerMember(
        { hostedRoomOwner: 'ops', roomId: 'room-1' },
        [local('review')]
      )?.targetProfile
    ).toBe('ops')
  })
})

describe('hosted room event projection', () => {
  it('deduplicates paged events by id and sequence without reordering history', async () => {
    const hosted = await loadHosted()
    const first = event(1, 'message.user', { text: 'one', thread_id: 't1' }, 'user-1')
    const duplicateId = event(2, 'message.member', { member_id: 'ops', text: 'dup', thread_id: 't1' }, 'user-1')
    const duplicateSeq = event(1, 'message.member', { member_id: 'ops', text: 'dup', thread_id: 't1' }, 'member-1')
    const second = event(2, 'message.member', { member_id: 'ops', text: 'two', thread_id: 't1' }, 'member-2')

    expect(hosted.mergeHostedRoomEvents([first, second], [duplicateId, duplicateSeq])).toEqual([first, second])
  })

  it('keeps renderer-local history as a prefix and projects backend messages after it', async () => {
    const hosted = await loadHosted()
    const members = [{ ...local('ops'), connectionLabel: 'This Mac' }]
    const localHistory: GroupMessage[] = [
      { at: 1, from: { kind: 'user', name: 'You' }, id: 'local-1', text: 'before reload', thread: 'legacy' }
    ]
    const entries = hosted.projectHostedRoomEvents(
      [
        event(1, 'message.user', { text: 'hello', thread_id: 't1' }, 'evt-user'),
        event(2, 'message.member', { member_id: 'ops', text: 'answer', thread_id: 't1' }, 'evt-member')
      ],
      members
    )
    const merged = hosted.mergeHostedRoomEntries(localHistory, entries)

    expect(merged.map(entry => entry.text)).toEqual(['before reload', 'hello', 'answer'])
    expect(merged[2].from).toEqual({ kind: 'member', name: 'ops', source: 'This Mac' })
    expect(entries.map(entry => entry.eventId)).toEqual(['evt-user', 'evt-member'])
  })

  it('derives the live member from turn.started until a terminal event clears it', async () => {
    const hosted = await loadHosted()

    hosted.resetHostedRoomViewsForTest()
    hosted.recordHostedRoomEvent(
      'room-1',
      event(3, 'turn.started', {
        execution_generation: 1,
        member: 'ops',
        member_id: 'ops',
        task_id: 'task-1',
        thread_id: 't1',
        turn_id: 'turn-1'
      }),
      [local('ops')]
    )
    expect(hosted.hostedRoomViewSnapshot('room-1').activeMemberId).toBe('ops')

    hosted.recordHostedRoomEvent(
      'room-1',
      event(4, 'turn.settled', {
        discussion_event_id: 'evt-user',
        member_id: 'ops',
        message_event_id: null,
        passed: false,
        round_index: 0,
        seen_through_seq: 3,
        task_id: 'task-1',
        thread_id: 't1',
        turn_id: 'turn-1'
      }),
      [local('ops')]
    )
    expect(hosted.hostedRoomViewSnapshot('room-1').activeMemberId).toBeNull()
  })
})

describe('hosted room reload cache and retry-safe sends', () => {
  it('persists and reloads a monotonic log cursor', async () => {
    const hosted = await loadHosted()
    const storage = new Map<string, string>()
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      }
    }

    expect(hosted.persistHostedRoomCheckpoint('room-1', { cursor: 7, events: [event(7, 'message.user', { text: 'x' })] }, adapter)).toBe(true)
    expect(hosted.loadHostedRoomCheckpoint('room-1', adapter)).toEqual({
      cursor: 7,
      events: [event(7, 'message.user', { text: 'x' })]
    })
  })

  it('reuses the caller event id when the committed response is lost', async () => {
    const hosted = await loadHosted()
    const calls: Array<Record<string, unknown>> = []
    const committed = event(8, 'message.user', { text: 'hello', thread_id: 't1' }, 'stable-send')
    const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
      calls.push(params)

      if (calls.length === 1) {
        throw new Error('response lost')
      }

      return { event: committed }
    })

    await expect(
      hosted.sendHostedRoomMessage('room-1', local('ops'), 'hello', 't1', 'stable-send', request)
    ).resolves.toEqual(committed)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(calls[1])
    expect(calls[0].event_id).toBe('stable-send')
  })
})
