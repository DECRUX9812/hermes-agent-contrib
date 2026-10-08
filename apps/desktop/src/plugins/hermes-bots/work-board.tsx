/**
 * The Activity tab read as a teammate's board: Now (the running task, with
 * its plan progress when one was approved), Next (the plan's remaining steps,
 * then the bot's upcoming routines) and Done (finished tasks as receipts).
 *
 * Everything derives from state the rail already holds — the focused chat's
 * tasks and messages, and the routines query — so the board never disagrees
 * with the transcript or the Scheduled tab.
 */

import {
  type ActivityStatus,
  type ActivityTask,
  type ActivityVerb,
  Button,
  cn,
  Codicon,
  currentStep,
  GlyphSpinner,
  host,
  relativeTime,
  useValue
} from '@hermes/plugin-sdk'
import { type ReactNode, useMemo, useState } from 'react'

import { ActivityDetailDialog } from './activity-detail'
import { stepLabel } from './activity-format'
import { type BotPlanState, deriveBotPlanState } from './bot-plan'
import { routineDetailIssue, routineTitle } from './cron'
import { type BotsText, useBots } from './i18n'
import { requestForBot } from './routing'
import type { RosterRow, RoutineJob } from './types'

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

const DONE_PREVIEW = 4
const ROUTINE_PREVIEW = 3
const RECEIPT_VERBS = 3

const VERB_ICONS: Record<ActivityVerb, string> = {
  asked: 'comment',
  browsed: 'globe',
  created: 'new-file',
  delegated: 'organization',
  edited: 'edit',
  looked: 'eye',
  operated: 'device-desktop',
  planned: 'checklist',
  ran: 'terminal',
  read: 'file',
  remembered: 'bookmark',
  scheduled: 'watch',
  searched: 'search',
  tracked: 'pulse',
  used: 'tools'
}

/** What a finished task touched, most-used first: its receipt at a glance. */
function receiptVerbs(task: ActivityTask): [ActivityVerb, number][] {
  const counts = new Map<ActivityVerb, number>()

  for (const step of task.steps) {
    counts.set(step.verb, (counts.get(step.verb) ?? 0) + 1)
  }

  return [...counts].sort((x, y) => y[1] - x[1]).slice(0, RECEIPT_VERBS)
}

/** Interrupt the FOCUSED chat's turn — the one this board is reading, which
 *  may be a side chat rather than the bot's canonical Bot Chat. */
async function stopFocusedTurn(owner: RosterRow): Promise<boolean> {
  const sessionId = host.state.focusedSessionId.get()

  if (!sessionId) {
    return false
  }

  try {
    await requestForBot(owner, 'session.interrupt', { session_id: sessionId }, { spawnPriority: 'foreground' })

    return true
  } catch {
    return false
  }
}

function BoardSection({ children, count, title }: { children: ReactNode; count?: number; title: string }) {
  return (
    <section className="grid min-w-0 gap-1.5" data-testid={`work-section:${title}`}>
      <h3 className="flex items-center gap-1.5 px-1 ui-section-label">
        {title}
        {count ? <span className="tabular-nums text-(--ui-text-quaternary)">{count}</span> : null}
      </h3>
      {children}
    </section>
  )
}

/** The plan step the bot is on: the first one it has not reported done. */
function activePlanStep(plan: BotPlanState): number {
  const index = plan.steps.findIndex((_, i) => !plan.doneSteps.has(i + 1))

  return index === -1 ? plan.steps.length : index + 1
}

function NowCard({
  onOpen,
  onStop,
  plan,
  task
}: {
  onOpen: () => void
  onStop?: () => void
  plan: BotPlanState | null
  task: ActivityTask
}) {
  const b = useBots()
  const a = b.activity
  const w = a.work
  const step = currentStep(task)
  const live = step && step.action.status === 'running' ? stepLabel(step, a, 'doing') : a.thinking
  const planStep = plan && !plan.complete ? activePlanStep(plan) : null
  const progress = plan ? plan.doneSteps.size / plan.steps.length : null

  return (
    <div
      className="grid min-w-0 gap-2 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) p-3 shadow-(--shadow-nous)"
      data-testid="work-now"
    >
      <span className="flex items-center gap-1.5 text-[0.75rem] font-medium text-(--ui-accent)">
        <GlyphSpinner className="text-[0.8rem]" spinner="breathe" />
        {planStep && plan ? w.stepOf(planStep, plan.steps.length) : a.working}
      </span>
      <span className="text-[0.875rem] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
        {(planStep && plan?.steps[planStep - 1]) || task.title || a.onItsOwn}
      </span>
      <span className="truncate text-[0.75rem] text-(--ui-text-tertiary)" data-testid="work-now-live">
        {live}
      </span>
      {progress !== null ? (
        <span
          aria-label={b.plan.stepsDone(plan!.doneSteps.size, plan!.steps.length)}
          aria-valuemax={plan!.steps.length}
          aria-valuemin={0}
          aria-valuenow={plan!.doneSteps.size}
          className="h-1 overflow-hidden rounded-full bg-(--ui-inline-code-background)"
          role="progressbar"
        >
          <span
            className="block h-full rounded-full bg-(--ui-accent) transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${Math.max(progress, 0.04) * 100}%` }}
          />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[0.6875rem] text-(--ui-text-quaternary)">
        <span className="truncate tabular-nums">
          {w.started(relativeTime(task.startedAt * 1000))}
          {task.steps.length ? ` · ${a.steps(task.steps.length)}` : ''}
        </span>
        <span className="-mr-1.5 ml-auto flex shrink-0 items-center gap-0.5">
          {onStop ? (
            <Button onClick={onStop} size="xs" variant="ghost">
              <Codicon name="debug-stop" />
              {b.roster.stopRun}
            </Button>
          ) : null}
          <Button onClick={onOpen} size="xs" variant="ghost">
            <Codicon name="eye" />
            {w.watch}
          </Button>
        </span>
      </span>
    </div>
  )
}

function IdleNow({ name, w }: { name: string; w: BotsText['activity']['work'] }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2 py-2" data-testid="work-idle">
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--ui-text-quaternary)" />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[0.8125rem] font-medium text-(--ui-text-secondary)">{w.idleTitle}</span>
        <span className="text-[0.75rem] leading-snug text-(--ui-text-tertiary)">{w.idleBody(name)}</span>
      </span>
    </div>
  )
}

function NextRow({
  detail,
  icon,
  onOpen,
  title,
  warn
}: {
  detail: string
  icon: string
  onOpen?: () => void
  title: string
  warn?: boolean
}) {
  const body = (
    <>
      <Codicon
        className={cn('mt-0.5 shrink-0', warn ? 'text-amber-600 dark:text-amber-300' : 'text-(--ui-text-quaternary)')}
        name={warn ? 'warning' : icon}
        size="0.85rem"
      />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-[0.8125rem] text-foreground">{title}</span>
        <span
          className={cn(
            'truncate text-[0.6875rem]',
            warn ? 'text-amber-700 dark:text-amber-300' : 'text-(--ui-text-tertiary)'
          )}
        >
          {detail}
        </span>
      </span>
    </>
  )

  return (
    <li>
      {onOpen ? (
        <button
          className="flex w-full min-w-0 gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
          onClick={onOpen}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 gap-2.5 px-2 py-1.5">{body}</div>
      )}
    </li>
  )
}

function routineWhen(job: RoutineJob, w: BotsText['activity']['work']): string {
  const at = job.next_run_at ? new Date(job.next_run_at).getTime() : NaN
  const when = Number.isFinite(at) ? w.routineAt(relativeTime(at)) : w.routine

  return routineDetailIssue(job) ? `${w.lastRunFailed} · ${when}` : when
}

function DoneRow({ onOpen, task }: { onOpen: () => void; task: ActivityTask }) {
  const b = useBots()
  const a = b.activity
  const ended = task.completedAt ?? task.startedAt
  const failed = task.status === 'error' || task.status === 'stopped'

  return (
    <li>
      <button
        className="group/done flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
        data-task-status={task.status}
        data-testid="activity-row"
        onClick={onOpen}
        type="button"
      >
        <StatusTile className="size-6 rounded-lg [&_.codicon]:text-[0.75rem]" status={task.status} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-[0.8125rem] font-medium leading-snug text-foreground">
            {task.title || a.onItsOwn}
          </span>
          {task.outcome ? (
            <span className="line-clamp-2 text-[0.75rem] leading-snug text-(--ui-text-tertiary)">{task.outcome}</span>
          ) : null}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] tabular-nums">
            <span className={failed ? 'text-destructive' : 'text-(--ui-text-quaternary)'}>
              {[failed ? a.status[task.status] : '', ended ? relativeTime(ended * 1000) : '']
                .filter(Boolean)
                .join(' · ')}
            </span>
            {receiptVerbs(task).map(([verb, count]) => (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-(--ui-inline-code-background) px-1.5 py-px text-(--ui-text-tertiary)"
                data-testid="receipt-verb"
                key={verb}
                title={a.verbs[verb]}
              >
                <Codicon name={VERB_ICONS[verb]} size="0.7rem" />
                <span className="sr-only">{a.verbs[verb]}</span>
                {count}
              </span>
            ))}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-[0.6875rem] text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover/done:opacity-100 group-focus-visible/done:opacity-100">
          {a.work.receipt}
        </span>
      </button>
    </li>
  )
}

export function WorkBoard({
  jobs,
  name,
  onAddRoutine,
  onOpenRoutine,
  owner
}: {
  jobs: readonly RoutineJob[]
  name: string
  onAddRoutine?: () => void
  onOpenRoutine: (jobId: string) => void
  /** Who the focused chat belongs to; without one the Now card offers no Stop. */
  owner?: RosterRow
}) {
  const b = useBots()
  const a = b.activity
  const w = a.work
  const tasks = useValue(host.state.focusedActivity)
  const messages = useValue(host.state.focusedMessages)
  const plan = useMemo(() => deriveBotPlanState(messages), [messages])
  // Hold the id: every streamed token re-derives the tasks, and an open
  // detail view must follow the live task rather than freeze a snapshot.
  const [openId, setOpenId] = useState<null | string>(null)
  const [showAllDone, setShowAllDone] = useState(false)
  const open = openId ? (tasks.find(task => task.id === openId) ?? null) : null

  const running = tasks.at(-1)?.status === 'running' ? tasks.at(-1)! : null
  const done = useMemo(() => tasks.filter(task => task.status !== 'running').reverse(), [tasks])
  const shownDone = showAllDone ? done : done.slice(0, DONE_PREVIEW)
  const livePlan = plan && !plan.complete ? plan : null
  const current = livePlan ? activePlanStep(livePlan) : 0
  const planNext = livePlan ? livePlan.steps.map((text, i) => ({ n: i + 1, text })).filter(s => s.n > current) : []

  const routines = useMemo(
    () =>
      jobs
        .filter(job => job.enabled !== false && job.state !== 'paused')
        .sort((x, y) => String(x.next_run_at || '~').localeCompare(String(y.next_run_at || '~')))
        .slice(0, ROUTINE_PREVIEW),
    [jobs]
  )

  if (!tasks.length && !routines.length) {
    return (
      <div className="grid place-items-center px-6 py-10 text-center" data-testid="activity-empty">
        <div className="grid max-w-60 gap-1.5">
          <Codicon className="mx-auto text-(--ui-text-quaternary)" name="pulse" size="1.25rem" />
          <div className="text-[0.8125rem] font-medium text-(--ui-text-secondary)">{a.emptyTitle}</div>
          <div className="text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">{a.emptyBody(name)}</div>
          {onAddRoutine ? (
            <Button className="mt-2 justify-self-center" onClick={onAddRoutine} size="xs" variant="secondary">
              <Codicon name="add" />
              {w.addRoutine}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-w-0 gap-5 px-3 pb-4 pt-1" data-testid="activity-feed">
      <BoardSection title={w.now}>
        {running ? (
          <NowCard
            onOpen={() => setOpenId(running.id)}
            onStop={
              owner
                ? () =>
                    void stopFocusedTurn(owner).then(ok => {
                      if (!ok) {
                        host.notifyError?.(new Error('session.interrupt rejected'), b.roster.stopRunFailed)
                      }
                    })
                : undefined
            }
            plan={livePlan}
            task={running}
          />
        ) : (
          <IdleNow name={name} w={w} />
        )}
      </BoardSection>

      {planNext.length || routines.length || onAddRoutine ? (
        <BoardSection title={w.next}>
          <ul className="grid gap-0.5">
            {planNext.map((step, i) => (
              <NextRow
                detail={i === 0 ? w.afterThisStep : w.laterInPlan}
                icon="circle-large-outline"
                key={`plan-${step.n}`}
                title={step.text}
              />
            ))}
            {routines.map(job => (
              <NextRow
                detail={routineWhen(job, w)}
                icon="watch"
                key={job.job_id}
                onOpen={() => onOpenRoutine(job.job_id)}
                title={routineTitle(job, b.cron)}
                warn={Boolean(routineDetailIssue(job))}
              />
            ))}
          </ul>
          {onAddRoutine ? (
            <Button className="justify-self-start" onClick={onAddRoutine} size="xs" variant="ghost">
              <Codicon name="add" />
              {w.addRoutine}
            </Button>
          ) : null}
        </BoardSection>
      ) : null}

      {done.length ? (
        <BoardSection count={done.length} title={w.done}>
          <ol className="grid gap-0.5">
            {shownDone.map(task => (
              <DoneRow key={task.id} onOpen={() => setOpenId(task.id)} task={task} />
            ))}
          </ol>
          {done.length > DONE_PREVIEW ? (
            <Button
              className="justify-self-start"
              onClick={() => setShowAllDone(value => !value)}
              size="xs"
              variant="ghost"
            >
              {showAllDone ? w.showLess : w.showMore(done.length - DONE_PREVIEW)}
            </Button>
          ) : null}
        </BoardSection>
      ) : null}

      <ActivityDetailDialog onClose={() => setOpenId(null)} task={open} />
    </div>
  )
}
