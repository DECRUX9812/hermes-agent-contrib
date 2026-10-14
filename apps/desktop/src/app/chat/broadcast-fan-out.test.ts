import { describe, expect, it, vi } from 'vitest'

import type { SessionLiveGroup } from '@/store/session-live'

import { type BroadcastPorts, type BroadcastTarget, fanOutBroadcast } from './broadcast-fan-out'

const target = (storedSessionId: string, group: SessionLiveGroup, runtimeId: null | string = `rt-${storedSessionId}`): BroadcastTarget => ({
  storedSessionId,
  runtimeId,
  group,
  composerTarget: `tile:${storedSessionId}`
})

function ports(overrides: Partial<BroadcastPorts> = {}) {
  return {
    enqueue: vi.fn<BroadcastPorts['enqueue']>(),
    submit: vi.fn<BroadcastPorts['submit']>(async () => undefined),
    ...overrides
  }
}

describe('fanOutBroadcast', () => {
  it('skips panes that need the user, queues busy ones, and sends to idle ones', async () => {
    const p = ports()

    const outcome = await fanOutBroadcast(
      'run tests',
      [target('a', 'done'), target('b', 'needs-you'), target('c', 'working'), target('d', 'done', null)],
      null,
      p
    )

    expect(outcome).toEqual({ sent: 1, queued: 2, skipped: 1, failed: 0 })
    expect(p.submit).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: 'rt-a' }), 'run tests')
    expect(p.enqueue).toHaveBeenCalledWith('c', 'run tests')
    expect(p.enqueue).toHaveBeenCalledWith('d', 'run tests')
    expect(p.enqueue).toHaveBeenCalledTimes(2)
  })

  it('never delivers to the origin pane, even when it is listed as a target', async () => {
    const p = ports()

    const outcome = await fanOutBroadcast('hi', [target('origin', 'done'), target('other', 'done')], 'origin', p)

    expect(p.submit).toHaveBeenCalledTimes(1)
    expect(p.submit).toHaveBeenCalledWith(expect.objectContaining({ composerTarget: 'tile:other' }), 'hi')
    expect(outcome).toEqual({ sent: 1, queued: 0, skipped: 0, failed: 0 })
  })

  it('counts a failed send without queueing it a second time', async () => {
    const p = ports({
      submit: vi.fn(async () => {
        throw new Error('gateway down')
      })
    })

    const outcome = await fanOutBroadcast('hi', [target('a', 'done')], null, p)

    expect(outcome).toEqual({ sent: 0, queued: 0, skipped: 0, failed: 1 })
    expect(p.enqueue).not.toHaveBeenCalled()
  })

  it('reports nothing when there are no other panes', async () => {
    const outcome = await fanOutBroadcast('hi', [], 'origin', ports())

    expect(outcome).toEqual({ sent: 0, queued: 0, skipped: 0, failed: 0 })
  })
})
