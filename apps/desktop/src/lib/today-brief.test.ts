/**
 * The Today brief sorts every live session into the one card its state
 * belongs to, shows a small handful (never a feed), and falls back to "pick up
 * where you left off" only when nothing needs attention.
 */

import { describe, expect, it } from 'vitest'

import type { CronJob, SessionInfo } from '@/types/hermes'

import { BRIEF_ROW_LIMIT, deriveTodayBrief, greetingFor } from './today-brief'

const session = (id: string, lastActive: number, extra: Partial<SessionInfo> = {}) =>
  ({ id, last_active: lastActive, started_at: lastActive, ...extra }) as SessionInfo

const NOW = Date.parse('2026-09-29T09:00:00Z')

describe('deriveTodayBrief', () => {
  it('puts each session on exactly the card its state belongs to, newest first', () => {
    const brief = deriveTodayBrief({
      cronJobs: [],
      dotById: { a: 'needs-input', b: 'working', c: 'unread', d: 'stalled', e: 'idle', f: 'background' },
      now: NOW,
      sessions: [session('a', 1), session('b', 2), session('c', 3), session('d', 4), session('e', 5), session('f', 6)]
    })

    expect(brief.needsYou.map(s => s.id)).toEqual(['d', 'a'])
    expect(brief.running.map(s => s.id)).toEqual(['f', 'b'])
    expect(brief.finished.map(s => s.id)).toEqual(['c'])
    expect(brief.recent).toEqual([])
  })

  it('never lists archived sessions and caps every card', () => {
    const many = Array.from({ length: 10 }, (_, i) => session(`s${i}`, i))

    const brief = deriveTodayBrief({
      cronJobs: [],
      dotById: Object.fromEntries(many.map(s => [s.id, 'working' as const])),
      now: NOW,
      sessions: [...many, session('gone', 99, { archived: true })]
    })

    expect(brief.running).toHaveLength(BRIEF_ROW_LIMIT)
    expect(brief.totals.running).toBe(10)
    expect(brief.running.map(s => s.id)).not.toContain('gone')
  })

  it('offers recent sessions only when nothing needs attention', () => {
    const quiet = deriveTodayBrief({
      cronJobs: [],
      dotById: {},
      now: NOW,
      sessions: [session('x', 1), session('y', 2)]
    })

    expect(quiet.recent.map(s => s.id)).toEqual(['y', 'x'])
  })

  it('schedules only enabled jobs due within a day, soonest first', () => {
    const job = (id: string, at: string, enabled = true) => ({ id, enabled, next_run_at: at }) as CronJob

    const brief = deriveTodayBrief({
      cronJobs: [
        job('later', '2026-09-29T18:00:00Z'),
        job('soon', '2026-09-29T09:30:00Z'),
        job('tomorrow+', '2026-09-30T12:00:00Z'),
        job('off', '2026-09-29T10:00:00Z', false)
      ],
      dotById: {},
      now: NOW,
      sessions: []
    })

    expect(brief.scheduled.map(j => j.id)).toEqual(['soon', 'later'])
  })
})

describe('greetingFor', () => {
  it('covers the whole day', () => {
    expect([6, 13, 19, 2].map(greetingFor)).toEqual(['morning', 'afternoon', 'evening', 'night'])
  })
})
