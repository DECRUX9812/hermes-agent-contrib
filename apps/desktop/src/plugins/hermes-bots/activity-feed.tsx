/**
 * The Activity tab: the bot's chat read as tasks, newest first, grouped by
 * day — one row per request with what it is doing now (or how it ended) and
 * when. A row opens the task's step timeline (activity-detail.tsx).
 *
 * Data is `host.state.focusedActivity`, derived from the messages the chat
 * already holds, so the feed works offline, survives a reload, and never
 * disagrees with the transcript it summarizes.
 */

import {
  type ActivityStatus,
  type ActivityTask,
  cn,
  Codicon,
  currentStep,
  GlyphSpinner,
  host,
  useValue
} from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'

import { activityDays } from './activity-days'
import { ActivityDetailDialog } from './activity-detail'
import { clockTime, stepLabel } from './activity-format'
import { type BotsText, useBots } from './i18n'

/** A row's second line: the live step while running, how it ended after. */
function taskLine(task: ActivityTask, a: BotsText['activity']): string {
  const step = currentStep(task)

  if (task.status === 'running') {
    return step && step.action.status === 'running' ? stepLabel(step, a, 'doing') : a.working
  }

  return task.outcome || (step ? stepLabel(step, a) : '') || a.status[task.status]
}

const TILE_TONE: Record<ActivityStatus, string> = {
  done: 'bg-(--ui-inline-code-background) text-(--ui-text-secondary)',
  error: 'bg-destructive/10 text-destructive',
  running: 'bg-(--ui-accent)/12 text-(--ui-accent)',
  stopped: 'bg-(--ui-inline-code-background) text-(--ui-text-tertiary)'
}

const TILE_ICON: Record<Exclude<ActivityStatus, 'running'>, string> = {
  done: 'pass',
  error: 'error',
  stopped: 'debug-stop'
}

export function StatusTile({ className, status }: { className?: string; status: ActivityStatus }) {
  return (
    <span
      aria-hidden
      className={cn('grid size-9 shrink-0 place-items-center rounded-xl', TILE_TONE[status], className)}
      data-status={status}
    >
      {status === 'running' ? (
        <GlyphSpinner className="text-[0.95rem]" spinner="breathe" />
      ) : (
        <Codicon name={TILE_ICON[status]} size="1rem" />
      )}
    </span>
  )
}

function ActivityRow({ onOpen, task }: { onOpen: () => void; task: ActivityTask }) {
  const b = useBots()
  const a = b.activity

  return (
    <li>
      <button
        className="group/activity flex w-full min-w-0 gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
        data-task-status={task.status}
        data-testid="activity-row"
        onClick={onOpen}
        type="button"
      >
        <StatusTile status={task.status} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium leading-snug text-foreground">
              {task.title || a.onItsOwn}
            </span>
            <span className="shrink-0 text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)">
              {clockTime(task.startedAt)}
            </span>
          </span>
          <span className="line-clamp-2 text-[0.75rem] leading-snug text-(--ui-text-tertiary)">
            {taskLine(task, a)}
          </span>
          {task.steps.length ? (
            <span className="text-[0.6875rem] tabular-nums text-(--ui-text-quaternary)">{a.steps(task.steps.length)}</span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

export function BotActivityFeed({ name }: { name: string }) {
  const b = useBots()
  const a = b.activity
  const tasks = useValue(host.state.focusedActivity)
  const days = useMemo(() => activityDays(tasks, b.rail), [tasks, b.rail])
  // Hold the id: every streamed token re-derives the tasks, and an open
  // detail view must follow the live task rather than freeze a snapshot.
  const [openId, setOpenId] = useState<null | string>(null)
  const open = openId ? (tasks.find(task => task.id === openId) ?? null) : null

  if (!tasks.length) {
    return (
      <div className="grid place-items-center px-6 py-10 text-center" data-testid="activity-empty">
        <div className="grid max-w-60 gap-1.5">
          <Codicon className="mx-auto text-(--ui-text-quaternary)" name="pulse" size="1.25rem" />
          <div className="text-[0.8125rem] font-medium text-(--ui-text-secondary)">{a.emptyTitle}</div>
          <div className="text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">{a.emptyBody(name)}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3 px-2 pb-3 pt-1" data-testid="activity-feed">
      {days.map(day => (
        <section key={day.key}>
          <h3 className="px-2 pb-2 pt-2 text-xs font-medium text-(--ui-text-secondary)">{day.label}</h3>
          <ol className="grid gap-0.5">
            {day.tasks.map(task => (
              <ActivityRow key={task.id} onOpen={() => setOpenId(task.id)} task={task} />
            ))}
          </ol>
        </section>
      ))}
      <ActivityDetailDialog onClose={() => setOpenId(null)} task={open} />
    </div>
  )
}
