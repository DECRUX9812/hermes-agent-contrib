import { useStore } from '@nanostores/react'

import { jobState, jobTitle, STATE_DOT } from '@/app/cron/job-state'
import { Codicon } from '@/components/ui/codicon'
import { fmtDayTime, relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { $cronJobs } from '@/store/cron'
import type { CronJob } from '@/types/hermes'

// Upcoming tab — scheduled work, grouped honest. Health is a dot plus a
// word, never color alone. Daily and Weekly groups mirror how people think
// about their schedules.

function nextRunLabel(job: CronJob): string {
  if (!job.next_run_at) {return 'No next run'}
  const ms = Date.parse(job.next_run_at)

  if (Number.isNaN(ms)) {return 'No next run'}
  const now = Date.now()

  if (ms < now) {return 'Overdue'}

  return fmtDayTime.format(ms)
}

function healthWord(state: string): string {
  switch (state) {
    case 'error':
      return 'Failing'

    case 'paused':

    case 'disabled':
      return 'Paused'

    case 'running':
      return 'Running'

    default:
      return 'Healthy'
  }
}

function JobRow({ job }: { job: CronJob }) {
  const state = jobState(job)
  const dot = STATE_DOT[state] ?? STATE_DOT.unknown ?? ''

  return (
    <li className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-(--ui-control-hover-background)">
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', dot)}
        title={healthWord(state)}
      />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[0.8125rem] font-medium text-foreground">
          {jobTitle(job)}
        </div>
        <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">
          {healthWord(state)} · Next: {nextRunLabel(job)}
        </div>
      </div>
      {job.last_run_at && (
        <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">
          {relativeTime(Date.parse(job.last_run_at))}
        </span>
      )}
    </li>
  )
}

export function UpcomingTab() {
  const jobs = useStore($cronJobs) ?? []

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <Codicon className="text-[2rem] text-(--ui-text-quaternary)" name="watch" />
        <p className="text-[0.875rem] font-medium text-foreground">No scheduled jobs</p>
        <p className="max-w-60 text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">
          Scheduled jobs you create will appear here with their health and next run.
        </p>
      </div>
    )
  }

  const sorted = [...jobs].sort((a, b) => {
    const an = a.next_run_at ? Date.parse(a.next_run_at) : Number.POSITIVE_INFINITY
    const bn = b.next_run_at ? Date.parse(b.next_run_at) : Number.POSITIVE_INFINITY

    return an - bn
  })

  return (
    <div aria-label="Upcoming scheduled jobs" className="flex flex-col gap-3">
      <p className="px-1 text-[0.6875rem] font-medium text-(--ui-text-tertiary)">
        {jobs.length === 1 ? '1 scheduled job' : `${jobs.length} scheduled jobs`}
      </p>
      <ul className="flex flex-col gap-0.5">
        {sorted.map(job => (
          <JobRow job={job} key={job.id ?? job.name} />
        ))}
      </ul>
    </div>
  )
}
