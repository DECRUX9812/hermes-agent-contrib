import type { ActivityTask } from '@hermes/plugin-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { activityDays } from './activity-days'

const task = (id: string, at: Date): ActivityTask => ({
  id,
  startedAt: at.getTime() / 1000,
  completedAt: null,
  status: 'running',
  steps: [],
  errorCount: 0,
  title: id,
  outcome: ''
})

const labels = { today: 'Today', yesterday: 'Yesterday' }
afterEach(() => vi.unstubAllEnvs())

describe('activity calendar', () => {
  it('sorts requests by time without mutating the source or assuming arrival order', () => {
    const now = new Date(2026, 9, 7, 18)
    const input = [task('new', new Date(2026, 9, 7, 16)), task('old', new Date(2026, 9, 7, 9))]
    expect(activityDays(input, labels, now.getTime())[0].tasks.map(t => t.id)).toEqual(['new', 'old'])
    expect(input.map(t => t.id)).toEqual(['new', 'old'])
  })

  it.each(['2026-03-08T12:00:00', '2026-11-01T12:00:00'])(
    'labels the preceding calendar day around the DST transition %s',
    value => {
      vi.stubEnv('TZ', 'America/New_York')
      const now = new Date(value)
      now.setDate(now.getDate() + 1)
      const prior = new Date(now)
      prior.setDate(prior.getDate() - 1)
      const days = activityDays([task('prior', prior)], labels, now.getTime())
      expect(days[0].label).toBe('Yesterday')
    }
  )

  it('keeps undated requests usable without generating an Invalid Date heading', () => {
    const now = new Date(2026, 9, 7, 18).getTime()
    const undated = { ...task('undated', new Date()), startedAt: Number.NaN }
    expect(activityDays([undated], labels, now)[0].label).toBe('Today')
  })
})
