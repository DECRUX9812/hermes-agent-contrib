/**
 * G8 — dated task log derivation over the A3 runs feed.
 *
 * `deriveBotRuns` already yields one run per completed/in-flight action
 * (chat turn, routine fire, relay delivery, group round). The log form just
 * buckets those runs by LOCAL calendar day — 'Today'/'Yesterday' read as
 * day keys so the renderer can localize them; anything older formats as a
 * date. Bucketing is pure so the invariant (runs land in arrival order
 * inside the right day) stays unit-testable.
 */

import type { BotRun } from './bot-runs'

export type TaskLogDayLabel = 'date' | 'today' | 'yesterday'

export interface TaskLogDay {
  /** Local midnight of the bucket, for a stable key + date formatting. */
  at: number
  label: TaskLogDayLabel
  runs: BotRun[]
}

function dayStart(ms: number): number {
  const d = new Date(ms)

  d.setHours(0, 0, 0, 0)

  return d.getTime()
}

/** The one-line action text a log row renders: the run's own title first
 *  (routine name), else its outcome summary. */
export function taskLogLine(run: BotRun): string {
  return (run.title || '').trim() || (run.summary || '').trim()
}

/** Group runs (already newest-first from deriveBotRuns) into day buckets,
 *  newest day first, arrival order preserved inside each bucket. */
export function taskLogGroups(runs: readonly BotRun[], now = Date.now()): TaskLogDay[] {
  const todayStart = dayStart(now)
  const yesterdayStart = todayStart - 86_400_000
  const groups = new Map<number, TaskLogDay>()

  for (const run of runs) {
    if (!Number.isFinite(run.at) || run.at <= 0) {
      continue
    }

    const start = dayStart(run.at)
    let group = groups.get(start)

    if (!group) {
      group = {
        at: start,
        label: start === todayStart ? 'today' : start === yesterdayStart ? 'yesterday' : 'date',
        runs: []
      }
      groups.set(start, group)
    }

    group.runs.push(run)
  }

  return [...groups.values()].sort((a, b) => b.at - a.at)
}
