import { describe, expect, it } from 'vitest'

import { warmRouteChunks } from './route-chunks'

function manualScheduler() {
  const slots: Array<() => void> = []

  return {
    schedule: (run: () => void) => void slots.push(run),
    async runNext() {
      slots.shift()?.()
      // Let the loader promise and its continuation settle.
      await new Promise(resolve => setTimeout(resolve, 0))
    },
    get pending() {
      return slots.length
    }
  }
}

describe('warmRouteChunks', () => {
  it('loads one route per idle slot, in order, and stops when the list is done', async () => {
    const calls: string[] = []
    const loader = (name: string) => () => (calls.push(name), Promise.resolve())
    const idle = manualScheduler()

    warmRouteChunks([loader('settings'), loader('cron')], idle.schedule)

    expect(calls).toEqual([])

    await idle.runNext()
    expect(calls).toEqual(['settings'])

    await idle.runNext()
    expect(calls).toEqual(['settings', 'cron'])

    await idle.runNext()
    expect(idle.pending).toBe(0)
  })

  it('keeps warming the rest when one chunk fails to load', async () => {
    const calls: string[] = []
    const idle = manualScheduler()

    warmRouteChunks(
      [
        () => (calls.push('broken'), Promise.reject(new Error('offline'))),
        () => (calls.push('next'), Promise.resolve())
      ],
      idle.schedule
    )

    await idle.runNext()
    await idle.runNext()

    expect(calls).toEqual(['broken', 'next'])
  })
})
