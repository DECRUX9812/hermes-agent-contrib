/**
 * D3 — routines calendar grouping invariants.
 *
 *   1. The next-up strip is the soonest live fires across ALL profiles,
 *      capped at five — cross-bot ordering, not per-bot lists.
 *   2. Paused/disabled jobs and jobs with no parseable fire time park in
 *      `dormant`, never in the schedule; live jobs group by local day in
 *      chronological order.
 */

import { describe, expect, it } from 'vitest'

import { groupFleetRoutines } from './fleet-schedule'
import type { FleetRoutine } from './fleet-schedule'
import type { RosterRow, RoutineJob } from './types'

const bot = (name: string) => ({ name }) as RosterRow
const job = (id: string, fields: Partial<RoutineJob> = {}) => ({ job_id: id, ...fields }) as RoutineJob

const at = (offsetHours: number, base = new Date('2030-01-05T00:00:00Z')) =>
  new Date(base.getTime() + offsetHours * 3_600_000).toISOString()

describe('groupFleetRoutines', () => {
  it('next-up is the soonest five live fires across every bot, chronological', () => {
    const items: FleetRoutine[] = [
      { bot: bot('a'), job: job('a3', { next_run_at: at(50) }) },
      { bot: bot('b'), job: job('b1', { next_run_at: at(1) }) },
      { bot: bot('a'), job: job('a1', { next_run_at: at(2) }) },
      { bot: bot('c'), job: job('c1', { next_run_at: at(3) }) },
      { bot: bot('b'), job: job('b2', { next_run_at: at(4) }) },
      { bot: bot('a'), job: job('a2', { next_run_at: at(5) }) },
      { bot: bot('c'), job: job('c2', { next_run_at: at(6) }) }
    ]

    const groups = groupFleetRoutines(items)

    expect(groups.nextUp.map(item => item.job.job_id)).toEqual(['b1', 'a1', 'c1', 'b2', 'a2'])
    expect(groups.dormant).toEqual([])
  })

  it('paused or unscheduled jobs park in dormant; live jobs group by local day', () => {
    const items: FleetRoutine[] = [
      { bot: bot('a'), job: job('paused-job', { enabled: false, next_run_at: at(1) }) },
      { bot: bot('b'), job: job('nodate', { next_run_at: undefined }) },
      { bot: bot('a'), job: job('day1', { next_run_at: at(1) }) },
      { bot: bot('b'), job: job('day1b', { next_run_at: at(2) }) },
      { bot: bot('c'), job: job('day2', { next_run_at: at(30) }) }
    ]

    const groups = groupFleetRoutines(items)

    expect(groups.dormant.map(item => item.job.job_id).sort()).toEqual(['nodate', 'paused-job'])
    expect(groups.days).toHaveLength(2)
    expect(groups.days[0].items.map(item => item.job.job_id)).toEqual(['day1', 'day1b'])
    expect(groups.days[1].items.map(item => item.job.job_id)).toEqual(['day2'])
  })
})
