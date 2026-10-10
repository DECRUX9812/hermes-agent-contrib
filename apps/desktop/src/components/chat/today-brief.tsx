import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'

import { openSession } from '@/app/open-session'
import { CRON_ROUTE } from '@/app/routes'
import type { ClientSessionState } from '@/app/types'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { formatElapsed, taskStartedMs, taskSteps } from '@/lib/task-card'
import { relativeTime } from '@/lib/time'
import { type BriefCardId, deriveTodayBrief } from '@/lib/today-brief'
import { cn } from '@/lib/utils'
import { $cronJobs } from '@/store/cron'
import { $sessions } from '@/store/session'
import { $sessionDigestById } from '@/store/session-digest'
import { $sessionDotStateById, type SessionDotState, showsRunningArc } from '@/store/session-dot-state'
import { $sessionStates } from '@/store/session-states-live'
import { $todoProgressBySession } from '@/store/todos'
import type { CronJob, SessionInfo } from '@/types/hermes'

import { useElapsedSeconds } from './activity-timer'

/** Card chrome per concern: the glyph and the tone its count badge wears. */
const CARD_STYLE: Record<BriefCardId, { icon: string; tone: string }> = {
  needsYou: { icon: 'bell-dot', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  running: { icon: 'loading', tone: 'bg-(--ui-accent)/12 text-(--ui-accent)' },
  finished: { icon: 'check-all', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  scheduled: { icon: 'calendar', tone: 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)' },
  recent: { icon: 'history', tone: 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)' }
}

function BriefCard({
  children,
  count,
  id,
  title
}: {
  children: React.ReactNode
  count: number
  id: BriefCardId
  title: string
}) {
  const style = CARD_STYLE[id]

  return (
    <section
      className="flex min-w-0 flex-col gap-1 rounded-xl bg-(--ui-widget-surface-background) p-2 text-left animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
      data-brief-card={id}
    >
      <header className="flex items-center gap-2 px-1.5 pt-0.5 pb-1">
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-lg', style.tone)}>
          <Codicon name={style.icon} size="0.8rem" spinning={id === 'running'} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-foreground">{title}</span>
        <span className="text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)">{count}</span>
      </header>
      {children}
    </section>
  )
}

function BriefRow({ meta, onOpen, title }: { meta: string; onOpen: () => void; title: string }) {
  return (
    <button
      className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[0.8125rem] text-(--ui-text-secondary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-foreground"
      onClick={() => {
        triggerHaptic('selection')
        onOpen()
      }}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="shrink-0 text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)">{meta}</span>
    </button>
  )
}

/**
 * One task, one card (the Aside home shape): how it stands — working for how
 * long, waiting on you, a reply you haven't read — then the last few things
 * the agent did, worded like the transcript. A chat with no live steps shows
 * its preview instead, so a finished task still says what it found.
 */
function TaskCard({
  digest,
  dot,
  onOpen,
  progress,
  session,
  state,
  title
}: {
  digest?: string
  dot: SessionDotState
  onOpen: () => void
  /** The plan's "3/7" while the agent follows one. */
  progress?: string
  session: SessionInfo
  state?: ClientSessionState
  title: string
}) {
  const { t } = useI18n()
  const working = showsRunningArc(dot) || dot === 'background'
  const since = working ? (taskStartedMs(state?.messages) ?? undefined) : undefined
  const elapsed = useElapsedSeconds(working && since !== undefined, undefined, since)
  const steps = taskSteps(state?.messages, Boolean(state?.busy))
  const needsYou = dot === 'needs-input'

  const status = needsYou
    ? t.todayBrief.needsYou
    : working
      ? since !== undefined
        ? t.todayBrief.taskWorking(formatElapsed(elapsed * 1000))
        : t.todayBrief.running
      : relativeTime(sessionMs(session))

  const fallback = (needsYou || working ? digest : null) || session.preview?.trim() || ''

  return (
    <button
      className={cn(
        'group flex min-h-32 min-w-0 flex-col gap-1.5 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-widget-surface-background) p-3 text-left transition-[border-color,box-shadow,transform] duration-200 animate-in fade-in-0 slide-in-from-bottom-1 hover:-translate-y-px hover:border-(--ui-stroke-primary) hover:shadow-md motion-reduce:transform-none motion-reduce:animate-none',
        needsYou && 'border-amber-500/40'
      )}
      data-task-card={session.id}
      onClick={() => {
        triggerHaptic('selection')
        onOpen()
      }}
      type="button"
    >
      <span className="flex w-full items-center gap-1.5 text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)">
        {working && <Codicon className="text-(--ui-accent)" name="loading" size="0.7rem" spinning />}
        <span className={cn('min-w-0 flex-1 truncate', needsYou && 'text-amber-700 dark:text-amber-300')}>
          {working && progress ? `${status} · ${progress}` : status}
        </span>
        {dot === 'unread' && (
          <span aria-label={t.todayBrief.taskNew} className="size-1.5 shrink-0 rounded-full bg-(--ui-accent)" />
        )}
      </span>
      <span className="w-full truncate text-[0.8125rem] font-semibold text-foreground">{title}</span>
      {steps.length ? (
        <ul className="flex w-full min-w-0 flex-col gap-0.5" data-slot="task-steps">
          {steps.map((step, index) => (
            <li
              className="flex min-w-0 items-center gap-1.5 text-[0.75rem] text-(--ui-text-tertiary)"
              key={`${index}:${step.label}`}
            >
              <Codicon
                className={cn('shrink-0', step.live ? 'text-(--ui-accent)' : 'opacity-60')}
                name={step.live ? 'loading' : 'check'}
                size="0.7rem"
                spinning={step.live}
              />
              <span className="min-w-0 flex-1 truncate">{step.label}</span>
            </li>
          ))}
        </ul>
      ) : fallback ? (
        <span className="line-clamp-3 w-full text-[0.75rem] leading-snug text-(--ui-text-tertiary)">{fallback}</span>
      ) : null}
    </button>
  )
}

const sessionMs = (session: SessionInfo) => (session.last_active || session.started_at || 0) * 1000

/**
 * The empty chat's "Today": what needs you, what is running, what finished
 * while you were away, and what runs next — a handful of cards over the
 * signals the sidebar already tracks (lib/today-brief.ts). Cards with nothing
 * to say are not drawn; an entirely quiet day shows where you left off.
 */
export function TodayBrief() {
  const { t } = useI18n()
  const b = t.todayBrief
  const navigate = useNavigate()
  const sessions = useStore($sessions)
  const dotById = useStore($sessionDotStateById)
  const cronJobs = useStore($cronJobs)
  const progressById = useStore($todoProgressBySession)
  const states = useStore($sessionStates)
  const digestById = useStore($sessionDigestById)
  const brief = deriveTodayBrief({ cronJobs, dotById, sessions })

  const sessionTitle = (session: SessionInfo) =>
    session.title || session.preview || t.sidebar.row.untitledChat(session.id.slice(0, 8))

  // Live transcripts are keyed by runtime id; the cards know stored ids.
  const stateByStored = new Map(
    Object.entries(states).map(([runtimeId, state]) => [state.storedSessionId ?? runtimeId, state])
  )

  const jobRows = (list: CronJob[]) =>
    list.map(job => (
      <BriefRow
        key={job.id}
        meta={job.next_run_at ? relativeTime(Date.parse(job.next_run_at)) : ''}
        onOpen={() => navigate(CRON_ROUTE)}
        title={job.name || job.prompt || job.id}
      />
    ))

  if (!brief.tasks.length && !brief.scheduled.length) {
    return null
  }

  return (
    <div className="mt-8 flex w-full flex-col gap-2" data-slot="today-brief">
      {brief.tasks.length > 0 && (
        <section className="flex w-full flex-col gap-2" data-slot="recent-tasks">
          <h2 className="m-0 px-0.5 text-left text-[0.8125rem] font-semibold text-foreground">{b.tasks}</h2>
          <div className="grid w-full gap-2 sm:grid-cols-3">
            {brief.tasks.map(session => (
              <TaskCard
                digest={digestById[session.id]}
                dot={dotById[session.id] ?? 'idle'}
                key={session.id}
                onOpen={() => openSession(session.id, navigate, 'in-place')}
                progress={progressById[session.id]}
                session={session}
                state={stateByStored.get(session.id)}
                title={sessionTitle(session)}
              />
            ))}
          </div>
        </section>
      )}
      {brief.scheduled.length > 0 && (
        <BriefCard count={brief.totals.scheduled} id="scheduled" title={b.scheduled}>
          {jobRows(brief.scheduled)}
        </BriefCard>
      )}
    </div>
  )
}
