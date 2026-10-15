import { Button, cn, Codicon, useQuery } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import {
  browserThumbnailKey,
  type ComputerTimelineStep,
  type ComputerTodo,
  loadBrowserThumbnail,
  useComputerTimeline
} from './bot-computer'
import { useBots } from './i18n'
import type { RosterRow } from './types'

const EMPTY_STEPS: ComputerTimelineStep[] = []

function statusClass(status: string) {
  if (status === 'running' || status === 'in_progress') {
    return 'text-info'
  }

  if (status === 'done' || status === 'completed') {
    return 'text-success'
  }

  if (status === 'error') {
    return 'text-danger'
  }

  return 'text-fg-muted'
}

function stepIcon(kind: ComputerTimelineStep['kind']) {
  const icons: Record<ComputerTimelineStep['kind'], string> = {
    browser: 'globe',
    file: 'file',
    other: 'tools',
    search: 'search',
    terminal: 'terminal'
  }

  return icons[kind]
}

function StepStatus({ status }: { status: string }) {
  const b = useBots()
  const label = b.activity.status[status as keyof typeof b.activity.status] || status

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-ui-2xs', statusClass(status))}>
      {status === 'running' ? (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-info motion-reduce:animate-none" />
      ) : null}
      {label}
    </span>
  )
}

function durationText(duration: number | null | undefined) {
  if (typeof duration !== 'number' || !Number.isFinite(duration)) {
    return null
  }

  return `${duration.toFixed(1)}s`
}

function DiffLines({ diff }: { diff: string }) {
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-sunken p-2 font-mono text-ui-xs leading-relaxed">
      {diff.split('\n').map((line, index) => {
        const lineClass = line.startsWith('+')
          ? 'text-success'
          : line.startsWith('-')
            ? 'text-danger'
            : 'text-fg-secondary'

        return (
          <span className={lineClass} key={`${index}:${line}`}>
            {line}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}

function BrowserScreenshot({
  bot,
  sessionId,
  step
}: {
  bot: RosterRow
  sessionId: string
  step: ComputerTimelineStep
}) {
  const b = useBots()

  const query = useQuery({
    queryKey: browserThumbnailKey(bot, sessionId, step.id),
    queryFn: () => loadBrowserThumbnail(bot, sessionId, step.id),
    enabled: step.kind === 'browser',
    staleTime: Infinity
  })

  const thumbnail = query.data

  if (!thumbnail?.found || !thumbnail.data_base64) {
    return null
  }

  return (
    <img
      alt={thumbnail.title || b.screen.panelTitle}
      className="max-h-48 w-full rounded-control object-cover"
      src={`data:${thumbnail.mime || 'image/png'};base64,${thumbnail.data_base64}`}
    />
  )
}

function StepDetail({ bot, sessionId, step }: { bot: RosterRow; sessionId: string; step: ComputerTimelineStep }) {
  const b = useBots()
  const detail = step.detail ?? {}

  if (step.kind === 'terminal') {
    return (
      <div className="grid gap-2" data-testid="computer-step-detail">
        {detail.command ? (
          <pre className="overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-sunken p-2 font-mono text-ui-xs text-fg">
            {detail.command}
          </pre>
        ) : null}
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-sunken p-2 font-mono text-ui-xs text-fg-secondary">
          {detail.output_tail || b.activity.noOutput}
        </pre>
      </div>
    )
  }

  if (step.kind === 'file') {
    return (
      <div className="grid gap-2" data-testid="computer-step-detail">
        {detail.path ? <div className="break-all font-mono text-ui-xs text-fg-secondary">{detail.path}</div> : null}
        {detail.diff ? (
          <DiffLines diff={detail.diff} />
        ) : (
          <p className="text-ui-xs text-fg-muted">{b.activity.noOutput}</p>
        )}
      </div>
    )
  }

  if (step.kind === 'browser') {
    return (
      <div className="grid gap-2" data-testid="computer-step-detail">
        {detail.page_title ? <div className="text-ui-sm font-medium text-fg">{detail.page_title}</div> : null}
        {detail.url ? (
          <a className="break-all text-ui-xs text-info underline" href={detail.url} rel="noreferrer" target="_blank">
            {detail.url}
          </a>
        ) : null}
        <BrowserScreenshot bot={bot} sessionId={sessionId} step={step} />
        {detail.output_tail ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-xs text-fg-secondary">
            {detail.output_tail}
          </pre>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid gap-2" data-testid="computer-step-detail">
      {detail.url ? <div className="break-all text-ui-xs text-info">{detail.url}</div> : null}
      {detail.output_tail ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-ui-xs text-fg-secondary">
          {detail.output_tail}
        </pre>
      ) : (
        <p className="text-ui-xs text-fg-muted">{step.title}</p>
      )}
    </div>
  )
}

function TodoRow({ todo }: { todo: ComputerTodo }) {
  const status = todo.status.toLowerCase()
  const b = useBots()

  const labels: Record<string, string> = {
    cancelled: b.computer.todoStatus.cancelled,
    completed: b.computer.todoStatus.completed,
    in_progress: b.computer.todoStatus.inProgress,
    pending: b.computer.todoStatus.pending
  }

  const done = status === 'completed'

  return (
    <li className="flex min-w-0 items-start gap-2 text-ui-xs" data-status={status}>
      <Codicon
        className={cn(
          'mt-0.5 shrink-0',
          statusClass(status),
          status === 'in_progress' && 'animate-pulse motion-reduce:animate-none'
        )}
        name={
          done
            ? 'check'
            : status === 'cancelled'
              ? 'circle-slash'
              : status === 'in_progress'
                ? 'sync'
                : 'circle-outline'
        }
      />
      <span
        className={cn(
          'min-w-0 flex-1 wrap-anywhere',
          done
            ? 'text-fg-muted line-through'
            : status === 'pending' || status === 'cancelled'
              ? 'text-fg-muted'
              : 'text-fg'
        )}
      >
        {todo.content}
      </span>
      <span className="sr-only">{labels[status] || labels.pending}</span>
    </li>
  )
}

export function BotTodoChecklist({ bot }: { bot: RosterRow }) {
  const sessionId = bot.canonical_session?.resolved_id || bot.canonical_session?.id || ''
  const query = useComputerTimeline(bot, sessionId)
  const b = useBots()
  const todos = query.data?.todos || []

  if (!todos.length) {
    return null
  }

  return (
    <section aria-label={b.computer.taskChecklist} className="grid gap-2 px-3 pb-3" data-testid="bot-todo-checklist">
      <h3 className="text-ui-xs font-medium text-fg-secondary">{b.computer.taskChecklist}</h3>
      <ul className="grid gap-1.5">
        {todos.map(todo => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
      </ul>
    </section>
  )
}

export function BotComputerTimeline({ bot }: { bot: RosterRow }) {
  const b = useBots()
  const sessionId = bot.canonical_session?.resolved_id || bot.canonical_session?.id || ''
  const query = useComputerTimeline(bot, sessionId)
  const steps = query.data?.steps || EMPTY_STEPS
  const [live, setLive] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const selectedIndex = steps.findIndex(step => step.id === selectedId)
  const selected = live ? steps.at(-1) : steps[selectedIndex] || steps.at(-1)
  const position = selected ? steps.indexOf(selected) : -1

  useEffect(() => {
    if (live || !steps.some(step => step.id === selectedId)) {
      setSelectedId(steps.at(-1)?.id || '')
    }
  }, [live, selectedId, steps])

  const selectPosition = (next: number) => {
    const step = steps[Math.max(0, Math.min(steps.length - 1, next))]

    if (step) {
      setSelectedId(step.id)
      setLive(false)
    }
  }

  if (!sessionId) {
    return <div className="px-2 py-3 text-center text-ui-xs text-fg-muted">{b.computer.noCanonicalChat}</div>
  }

  if (query.isLoading && !query.data) {
    return <div className="px-2 py-3 text-center text-ui-xs text-fg-muted">{b.computer.loading}</div>
  }

  if (query.isError && !query.data) {
    return (
      <div className="grid justify-items-start gap-2 px-2 py-3">
        <p className="text-ui-xs text-danger">{b.computer.loadFailed}</p>
        <Button onClick={() => void query.refetch()} size="xs" variant="secondary">
          {b.computer.retry}
        </Button>
      </div>
    )
  }

  return (
    <section
      aria-label={b.computer.title}
      className="grid gap-2 border-t border-line px-2 pt-2"
      data-testid="bot-computer-timeline"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-ui-xs font-medium text-fg-secondary">{b.computer.history}</h3>
        <div className="flex items-center gap-1">
          <Button
            aria-label={b.computer.previousStep}
            disabled={position <= 0}
            onClick={() => selectPosition(position - 1)}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="chevron-left" />
          </Button>
          <input
            aria-label={b.computer.replay}
            className="w-20 accent-(--ui-accent)"
            disabled={!steps.length}
            max={Math.max(0, steps.length - 1)}
            min={0}
            onChange={event => selectPosition(Number(event.target.value))}
            onKeyDown={event => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                selectPosition(position + (event.key === 'ArrowRight' ? 1 : -1))
              }
            }}
            type="range"
            value={Math.max(position, 0)}
          />
          <Button
            aria-label={b.computer.nextStep}
            disabled={position < 0 || position >= steps.length - 1}
            onClick={() => selectPosition(position + 1)}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="chevron-right" />
          </Button>
          <Button aria-pressed={live} onClick={() => setLive(true)} size="xs" variant={live ? 'secondary' : 'ghost'}>
            {b.computer.live}
          </Button>
        </div>
      </div>
      {steps.length ? (
        <ol
          aria-label={b.computer.steps}
          className="grid max-h-48 gap-0.5 overflow-y-auto"
          data-testid="computer-step-list"
        >
          {steps.map(step => (
            <li key={step.id}>
              <Button
                aria-current={selected?.id === step.id ? 'step' : undefined}
                className={cn(
                  'flex w-full min-w-0 items-center justify-start gap-2 text-left',
                  selected?.id === step.id && 'bg-selected'
                )}
                onClick={() => {
                  setSelectedId(step.id)
                  setLive(false)
                }}
                size="sm"
                variant="ghost"
              >
                <Codicon className="shrink-0 text-fg-muted" name={stepIcon(step.kind)} />
                <span className="min-w-0 flex-1 truncate">{step.title}</span>
                <StepStatus status={step.status} />
                {durationText(step.duration_s) ? (
                  <span className="shrink-0 font-mono tabular-nums text-ui-2xs text-fg-muted">
                    {durationText(step.duration_s)}
                  </span>
                ) : null}
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-2 text-ui-xs text-fg-muted">{b.computer.empty}</p>
      )}
      {selected ? <StepDetail bot={bot} sessionId={sessionId} step={selected} /> : null}
    </section>
  )
}
