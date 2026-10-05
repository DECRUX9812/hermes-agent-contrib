/**
 * One task, opened: a status badge and the request up top, the step timeline
 * on the left (started → each call → working/finished), and the selected
 * step on the right with its command or input, the raw result, exit code and
 * timing. Nothing summarized away: the right side is the Live feed's record
 * for that call.
 */

import {
  type ActivityStep,
  type ActivityTask,
  cn,
  Codicon,
  CopyButton,
  currentStep,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  GlyphSpinner
} from '@hermes/plugin-sdk'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { clockTime, stepLabel } from './activity-format'
import { type BotsText, useBots } from './i18n'

const SHELL_TOOLS = new Set(['terminal', 'process', 'process_manage', 'execute_code'])

function duration(seconds: number): string {
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }

  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

const BADGE_TONE: Record<ActivityTask['status'], string> = {
  done: 'bg-(--ui-green)/15 text-(--ui-green)',
  error: 'bg-destructive/12 text-destructive',
  running: 'bg-foreground text-background',
  stopped: 'bg-(--ui-inline-code-background) text-(--ui-text-secondary)'
}

function StepGlyph({ step }: { step: ActivityStep }) {
  const status = step.action.status

  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 grid size-5 shrink-0 place-items-center rounded-full bg-(--ui-sidebar-surface-background)',
        status === 'error'
          ? 'text-destructive'
          : status === 'running'
            ? 'text-(--ui-accent)'
            : 'text-(--ui-text-tertiary)'
      )}
    >
      {status === 'running' ? (
        <GlyphSpinner className="text-[0.8rem]" spinner="breathe" />
      ) : (
        <Codicon name={status === 'error' ? 'error' : 'pass'} size="0.95rem" />
      )}
    </span>
  )
}

function Timeline({
  a,
  onSelect,
  selectedId,
  task
}: {
  a: BotsText['activity']
  onSelect: (id: string) => void
  selectedId: null | string
  task: ActivityTask
}) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (!selectedId) {
      return
    }

    listRef.current?.querySelector(`[data-step-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const move = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    event.preventDefault()
    const index = task.steps.findIndex(step => step.id === selectedId)
    const next = task.steps[Math.min(task.steps.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]

    if (next) {
      onSelect(next.id)
    }
  }

  return (
    <ol
      aria-label={task.title || a.onItsOwn}
      className="relative grid gap-0.5 before:absolute before:bottom-4 before:left-[1.375rem] before:top-4 before:w-px before:bg-(--ui-stroke-secondary)"
      onKeyDown={move}
      ref={listRef}
    >
      <li className="flex items-center gap-2.5 px-3 py-1.5 text-[0.8125rem] text-(--ui-text-tertiary)">
        <span className="relative z-10 grid size-5 place-items-center bg-(--ui-sidebar-surface-background)">
          <span className="size-1.5 rounded-full bg-(--ui-text-quaternary)" />
        </span>
        <span className="min-w-0 flex-1">{a.started}</span>
        <span className="tabular-nums text-[0.6875rem] text-(--ui-text-quaternary)">{clockTime(task.startedAt)}</span>
      </li>
      {task.steps.map(step => {
        const selected = step.id === selectedId

        return (
          <li key={step.id}>
            <button
              aria-current={selected ? 'step' : undefined}
              className={cn(
                'flex w-full min-w-0 items-start gap-2.5 rounded-lg px-3 py-1.5 text-left text-[0.8125rem] leading-snug transition-colors focus-visible:outline-none',
                selected
                  ? 'bg-(--ui-chat-bubble-background) text-foreground shadow-sm'
                  : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) focus-visible:bg-(--chrome-action-hover)'
              )}
              data-step-id={step.id}
              onClick={() => onSelect(step.id)}
              type="button"
            >
              <StepGlyph step={step} />
              <span className="line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere]">{stepLabel(step, a)}</span>
            </button>
          </li>
        )
      })}
      <li className="flex items-start gap-2.5 px-3 py-1.5 text-[0.8125rem] text-(--ui-text-tertiary)">
        <span className="relative z-10 grid size-5 shrink-0 place-items-center bg-(--ui-sidebar-surface-background)">
          {task.status === 'running' ? (
            <GlyphSpinner className="text-[0.8rem] text-(--ui-accent)" spinner="breathe" />
          ) : (
            <Codicon
              className={task.status === 'error' ? 'text-destructive' : 'text-(--ui-text-tertiary)'}
              name={task.status === 'done' ? 'check-all' : task.status === 'error' ? 'error' : 'debug-stop'}
              size="0.95rem"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {task.status === 'running' ? a.working : task.status === 'done' ? a.finished : a.status[task.status]}
        </span>
      </li>
    </ol>
  )
}

function CodeBlock({ copyLabel, label, text }: { copyLabel: string; label: string; text: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-inline-code-background)">
      <div className="flex items-center justify-between px-3 pt-1.5 text-[0.6875rem] text-(--ui-text-quaternary)">
        <span className="font-mono">{label}</span>
        <CopyButton label={copyLabel} text={text} />
      </div>
      <pre className="max-h-72 overflow-auto px-3 pb-3 pt-1 font-mono text-[0.75rem] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground">
        {text}
      </pre>
    </div>
  )
}

function StepDetail({ a, step }: { a: BotsText['activity']; step: ActivityStep }) {
  const { action } = step
  const shell = SHELL_TOOLS.has(action.tool)
  const took = action.completedAt !== null ? Math.max(0, action.completedAt - action.startedAt) : null
  const body = shell ? action.target : [action.target, action.input].filter(Boolean).join('\n\n')

  return (
    <article className="grid gap-4" data-testid="activity-step-detail">
      <header className="grid gap-1.5">
        <h3 className="text-[1.0625rem] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
          {stepLabel(step, a)}
        </h3>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-(--ui-text-tertiary)">
          <span className="rounded-md bg-(--ui-inline-code-background) px-1.5 py-px font-mono text-[0.6875rem]">
            {action.tool}
          </span>
          {action.startedAt ? <span className="tabular-nums">{clockTime(action.startedAt)}</span> : null}
          {took !== null ? <span className="tabular-nums">{a.took(duration(took))}</span> : null}
          {action.exitCode !== null ? (
            <span
              className={cn(
                'rounded-md px-1.5 py-px font-mono text-[0.6875rem]',
                action.exitCode === 0 ? 'bg-(--ui-green)/12 text-(--ui-green)' : 'bg-destructive/12 text-destructive'
              )}
            >
              {a.exitCode(action.exitCode)}
            </span>
          ) : null}
        </div>
      </header>
      {body ? (
        <section className="grid gap-1.5">
          <h4 className="text-[0.8125rem] font-semibold text-foreground">{shell ? a.command : a.input}</h4>
          <CodeBlock copyLabel={a.copy} label={shell ? 'bash' : action.tool} text={body} />
        </section>
      ) : null}
      <section className="grid gap-1.5">
        <h4 className="text-[0.8125rem] font-semibold text-foreground">{a.result}</h4>
        {action.status === 'running' ? (
          <p className="flex items-center gap-2 text-[0.8125rem] text-(--ui-text-tertiary)">
            <GlyphSpinner className="text-[0.8rem] text-(--ui-accent)" spinner="breathe" />
            {a.waiting}
          </p>
        ) : action.output ? (
          <CodeBlock copyLabel={a.copy} label={action.status === 'error' ? 'stderr' : 'output'} text={action.output} />
        ) : (
          <p className="text-[0.8125rem] text-(--ui-text-tertiary)">{a.noOutput}</p>
        )}
      </section>
    </article>
  )
}

export function ActivityDetailDialog({ onClose, task }: { onClose: () => void; task: ActivityTask | null }) {
  const b = useBots()
  const a = b.activity
  const [selectedId, setSelectedId] = useState<null | string>(null)

  // Default to the step in flight (or the last one) until the user picks.
  const selected = (selectedId && task?.steps.find(step => step.id === selectedId)) || (task ? currentStep(task) : null)

  useEffect(() => setSelectedId(null), [task?.id])

  return (
    <Dialog onOpenChange={next => !next && onClose()} open={Boolean(task)}>
      {task ? (
        <DialogContent
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
          className="h-[min(46rem,88vh)] max-h-[88vh] max-w-[min(64rem,94vw)]"
          data-testid="activity-detail"
        >
          <header className="grid gap-2 border-b border-(--ui-stroke-tertiary) px-6 pb-4 pt-5 pr-14">
            <span className={cn('w-fit rounded-md px-2 py-0.5 text-[0.75rem] font-semibold', BADGE_TONE[task.status])}>
              {a.status[task.status]}
            </span>
            <DialogTitle className="text-xl font-semibold leading-tight [overflow-wrap:anywhere]">
              {task.title || a.onItsOwn}
            </DialogTitle>
            <DialogDescription className={cn('text-[0.8125rem] text-(--ui-text-tertiary)', !task.outcome && 'sr-only')}>
              {task.outcome || a.steps(task.steps.length)}
            </DialogDescription>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(13rem,18rem)_1fr] max-sm:grid-cols-1">
            <nav className="min-h-0 overflow-y-auto border-r border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background) p-2 max-sm:max-h-56 max-sm:border-b max-sm:border-r-0">
              <Timeline a={a} onSelect={setSelectedId} selectedId={selected?.id ?? null} task={task} />
            </nav>
            <div className="min-h-0 overflow-y-auto px-6 py-5">
              {selected ? (
                <StepDetail a={a} step={selected} />
              ) : (
                <p className="text-[0.8125rem] text-(--ui-text-tertiary)">{a.pickStep}</p>
              )}
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
