/**
 * D3 — the fleet schedule derivation: pure grouping of every bot's routine
 * jobs into the calendar's sections. Kept free of UI imports so the grouping
 * contract is unit-testable on its own.
 */

import type { RosterRow, RoutineJob } from './types'

export interface FleetRoutine {
  bot: RosterRow
  job: RoutineJob
}

/** A day-grouped schedule row: the local-day label and its jobs in
 *  chronological order. */
export interface RoutineDayGroup {
  items: FleetRoutine[]
  label: string
}

/** Group fleet jobs into a next-up strip + per-day sections. Live jobs
 *  (enabled, parseable fire time) sort soonest-first across ALL profiles —
 *  that ordering is the "next-run strip" the roster toolbar entry opens.
 *  Paused/disabled/unscheduled jobs park in `dormant` rather than disappear. */
export function groupFleetRoutines(items: readonly FleetRoutine[]): {
  days: RoutineDayGroup[]
  dormant: FleetRoutine[]
  nextUp: FleetRoutine[]
} {
  const live: FleetRoutine[] = []
  const dormant: FleetRoutine[] = []

  for (const item of items) {
    const job = item.job
    const fireAt = Date.parse(String(job?.next_run_at || ''))
    const paused = job?.enabled === false || job?.state === 'paused'

    if (paused || !Number.isFinite(fireAt)) {
      dormant.push(item)
    } else {
      live.push(item)
    }
  }

  live.sort((a, b) => Date.parse(String(a.job.next_run_at)) - Date.parse(String(b.job.next_run_at)))

  const byDay = new Map<string, FleetRoutine[]>()

  for (const item of live) {
    const day = new Date(String(item.job.next_run_at)).toDateString()
    const list = byDay.get(day) || []

    list.push(item)
    byDay.set(day, list)
  }

  return {
    days: [...byDay.entries()].map(([label, grouped]) => ({ items: grouped, label })),
    dormant,
    nextUp: live.slice(0, 5)
  }
}
