import { beforeEach, describe, expect, it, vi } from 'vitest'

const { host, request } = vi.hoisted(() => ({ host: {} as Record<string, unknown>, request: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

vi.mock('./routing', () => ({ requestForBot: request }))

import { $groupActivity, recordGroupActivity } from './group-activity'
import { $groupChats } from './group-chat'
import { groupSessionKey } from './group-membership'
import { groupSteerTarget, steerGroupTurn } from './group-steer'

const builder = { name: 'builder', title: '' }

function seed(running: boolean) {
  $groupChats.set({
    room: {
      epoch: 1,
      log: [],
      members: [builder],
      running,
      sessions: { [groupSessionKey('t1', builder)]: 'sess-1' },
      turn: running ? builder : null
    } as never
  })
  $groupActivity.set({})
  recordGroupActivity('room', { kind: 'working', member: 'builder', thread: 't1' })
}

describe('group steer', () => {
  beforeEach(() => request.mockReset())

  it('targets the member on turn in the thread it is working', () => {
    seed(true)
    expect(groupSteerTarget('room')).toMatchObject({ member: builder, sessionId: 'sess-1', thread: 't1' })
  })

  it('has no target when the room is idle', () => {
    seed(false)
    expect(groupSteerTarget('room')).toBeNull()
  })

  it('steers through session.steer and records a receipt', async () => {
    seed(true)
    request.mockResolvedValue({ status: 'queued' })
    await expect(steerGroupTurn('room', '  use the staging db  ')).resolves.toMatchObject({ sessionId: 'sess-1' })
    expect(request).toHaveBeenCalledWith(builder, 'session.steer', { session_id: 'sess-1', text: 'use the staging db' })
    expect($groupActivity.get().room.events.at(-1)).toMatchObject({ kind: 'steered', member: 'You', preview: 'use the staging db' })
  })

  it('returns null on a refused or failed steer so the caller queues instead', async () => {
    seed(true)
    request.mockResolvedValueOnce({ status: 'rejected' })
    await expect(steerGroupTurn('room', 'x')).resolves.toBeNull()
    request.mockRejectedValueOnce(new Error('4010'))
    await expect(steerGroupTurn('room', 'x')).resolves.toBeNull()
    expect($groupActivity.get().room.events.some(e => e.kind === 'steered')).toBe(false)
  })
})
