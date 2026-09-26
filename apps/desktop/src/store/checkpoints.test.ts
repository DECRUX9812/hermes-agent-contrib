import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $checkpointsBySession,
  checkpointForUserRow,
  ensureSessionCheckpoints,
  markCheckpointsStale,
  revertToCheckpoint,
  sessionCheckpoints
} from './checkpoints'
import { $gateway } from './gateway'
import type * as Notifications from './notifications'
import type * as SessionGoneLatch from './session-gone-latch'
import type * as SessionStates from './session-states'

const requestForOwnedSession = vi.fn()
const notifyError = vi.fn()

vi.mock('./session-states', async importOriginal => {
  const actual = await importOriginal<typeof SessionStates>()

  return {
    ...actual,
    requestForOwnedSession: (sessionId: string, _request: unknown, method: string, params: unknown) =>
      requestForOwnedSession(sessionId, method, params)
  }
})

vi.mock('./session-gone-latch', async importOriginal => {
  const actual = await importOriginal<typeof SessionGoneLatch>()

  return { ...actual, ambientRequestFor: () => vi.fn() }
})

vi.mock('./notifications', async importOriginal => {
  const actual = await importOriginal<typeof Notifications>()

  return { ...actual, notifyError: (error: unknown, label?: string) => notifyError(error, label) }
})

const listOk = (checkpoints: unknown[]) => Promise.resolve({ enabled: true, checkpoints })

beforeEach(() => {
  requestForOwnedSession.mockReset()
  notifyError.mockReset()
  $checkpointsBySession.set({})
  $gateway.set({ request: vi.fn() } as never)
})

describe('ensureSessionCheckpoints', () => {
  it('fetches once per session and populates the row-keyed lookup', async () => {
    requestForOwnedSession.mockReturnValue(
      listOk([
        { hash: 'aaa111', timestamp: '2026-01-01T00:00:00Z', message: 'auto', turn: 2, sid: 's1', user_row_id: 17 },
        { hash: 'bbb222', timestamp: '2026-01-01T00:01:00Z', message: 'auto' }
      ])
    )

    await ensureSessionCheckpoints('s1')
    await ensureSessionCheckpoints('s1')

    expect(requestForOwnedSession).toHaveBeenCalledTimes(1)
    expect(requestForOwnedSession).toHaveBeenCalledWith('s1', 'rollback.list', { session_id: 's1' })
    expect(sessionCheckpoints('s1')).toHaveLength(2)
    expect(checkpointForUserRow('s1', 17)?.hash).toBe('aaa111')
    expect(checkpointForUserRow('other-session', 17)).toBeNull()
    // Untagged checkpoint claims no row; unknown/missing rows claim nothing.
    expect(checkpointForUserRow('s1', 99)).toBeNull()
    expect(checkpointForUserRow('s1', undefined)).toBeNull()
  })

  it('dedups an in-flight fetch', async () => {
    let resolveList!: (value: unknown) => void
    requestForOwnedSession.mockReturnValue(
      new Promise(resolve => {
        resolveList = resolve
      })
    )

    const first = ensureSessionCheckpoints('s1')
    const second = ensureSessionCheckpoints('s1')

    expect(second).toBe(first)

    resolveList({ enabled: true, checkpoints: [] })
    await Promise.all([first, second])

    expect(requestForOwnedSession).toHaveBeenCalledTimes(1)
  })

  it('refreshes after markCheckpointsStale or force', async () => {
    requestForOwnedSession.mockReturnValue(listOk([]))

    await ensureSessionCheckpoints('s1')
    markCheckpointsStale('s1')
    await ensureSessionCheckpoints('s1')
    await ensureSessionCheckpoints('s1', true)

    expect(requestForOwnedSession).toHaveBeenCalledTimes(3)
  })

  it('swallows backend errors — the affordance is best-effort', async () => {
    requestForOwnedSession.mockRejectedValue(new Error('checkpoint store unavailable'))

    await ensureSessionCheckpoints('s1')

    expect(sessionCheckpoints('s1')).toEqual([])
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('does nothing without a gateway or session', async () => {
    await ensureSessionCheckpoints(null)
    $gateway.set(null as never)
    await ensureSessionCheckpoints('s1')

    expect(requestForOwnedSession).not.toHaveBeenCalled()
  })
})

describe('revertToCheckpoint', () => {
  it('calls rollback.restore with files_only + safe', async () => {
    requestForOwnedSession.mockResolvedValue({ success: true })

    expect(await revertToCheckpoint('s1', 'abc123', 'Revert failed')).toBe(true)
    expect(requestForOwnedSession).toHaveBeenCalledWith('s1', 'rollback.restore', {
      session_id: 's1',
      hash: 'abc123',
      files_only: true,
      safe: true
    })
  })

  it('toasts and returns false on a failed restore', async () => {
    requestForOwnedSession.mockResolvedValue({ success: false, error: 'unknown checkpoint' })

    expect(await revertToCheckpoint('s1', 'abc123', 'Revert failed')).toBe(false)
    expect(notifyError).toHaveBeenCalledWith(expect.any(Error), 'Revert failed')
  })

  it('returns false without a gateway', async () => {
    $gateway.set(null as never)

    expect(await revertToCheckpoint('s1', 'abc123', 'Revert failed')).toBe(false)
    expect(requestForOwnedSession).not.toHaveBeenCalled()
  })
})
