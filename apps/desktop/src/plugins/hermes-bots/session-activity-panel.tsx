/**
 * Bot Mode — one session's activity, end to end.
 *
 * The panel this replaces merged every conversation, every room prompt and
 * every routine into a single "activity" list. That list could not answer the
 * only question a user has when a bot is blocked: *which session is waiting,
 * and on what?* This feed selects one session, reads only that session's
 * persisted tool rows, merges only that session's live events and approvals,
 * and renders them in one chronological timeline. Switching sessions replaces
 * the whole feed; there is no "all sessions" mode to leak across.
 *
 * Approvals are rows in the same timeline. The card is attached to the task
 * that raised it, answers through the same runtime path the chat card uses,
 * and settles the feed row even when the waiting task already finished.
 */

import {
  atom,
  Button,
  cn,
  Codicon,
  GlyphSpinner,
  host,
  PanelEmpty,
  relativeTime,
  useI18n,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { $groupClarify } from './group-chat'
import { answerGroupClarify } from './group-turns'
import { useBots } from './i18n'
import { requestForBot } from './routing'
import {
  $sessionActivity,
  activityCounts,
  activityFor,
  activityFromHistory,
  activityFromToolEvent,
  approvalFromPrompt,
  decideInSession,
  groupByDay,
  mergeIntoSession,
  type SessionActivity,
  settledApprovalActivity,
  timestampMs
} from './session-activity'
import type { RosterRow, RoutineJob } from './types'

interface SessionOption {
  id: string
  last_active?: null | number
  /** The live compression tip when the list row carries one. */
  resolved_id?: null | string
  title?: null | string
}

const DAY = 24 * 60 * 60 * 1000

/** Stable stand-in for shells that predate `host.state.focusedStoredSessionId`. */
const NO_STORED_SESSION = atom<null | string>(null)
const NO_RUNTIME_SESSION = atom<null | string>(null)

function dayLabel(at: number): string {
  const today = Math.floor(Date.now() / DAY) * DAY

  if (at >= today) {
    return 'Today'
  }

  if (at >= today - DAY) {
    return 'Yesterday'
  }

  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function duration(item: SessionActivity): string {
  if (!item.finishedAt || item.finishedAt < item.startedAt) {
    return ''
  }

  const seconds = Math.max(0, (item.finishedAt - item.startedAt) / 1000)

  if (seconds < 1) {
    return '<1s'
  }

  return seconds < 60 ? `${Math.round(seconds)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function methodMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code

  return code === -32601 || /method not found|unknown method/i.test(String((error as Error)?.message ?? error))
}

const STATUS_GLYPH: Record<SessionActivity['status'], string> = {
  cancelled: 'debug-stop',
  expired: 'clock',
  failed: 'error',
  pending: 'bell',
  running: 'sync',
  succeeded: 'check',
  waiting: 'shield'
}

function statusTone(status: SessionActivity['status']): string {
  if (status === 'failed') {
    return 'text-(--ui-icon-attention)'
  }

  if (status === 'waiting' || status === 'pending') {
    return 'text-(--ui-icon-attention)'
  }

  if (status === 'running') {
    return 'text-(--ui-accent)'
  }

  return 'text-(--ui-text-secondary)'
}

function statusLabel(
  status: SessionActivity['status'],
  s: NonNullable<ReturnType<typeof useBots>['sessionActivity']>
): string {
  switch (status) {
    case 'running':
      return s.running

    case 'waiting':

    case 'pending':
      return s.waiting

    case 'failed':
      return s.failedStatus

    case 'cancelled':
      return s.cancelled

    case 'expired':
      return s.expired

    default:
      return s.succeeded
  }
}

function StatusBadge({
  status,
  text
}: {
  status: SessionActivity['status']
  text: NonNullable<ReturnType<typeof useBots>['sessionActivity']>
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-current/20 px-1.5 py-0.5 text-10 font-medium',
        statusTone(status)
      )}
    >
      {status === 'running' ? (
        <GlyphSpinner className="text-10" spinner="breathe" />
      ) : (
        <Codicon aria-hidden name={STATUS_GLYPH[status]} size="0.65rem" />
      )}
      {statusLabel(status, text)}
    </span>
  )
}

function CollapsibleSection({
  children,
  count,
  defaultOpen = true,
  icon,
  title
}: {
  children: ReactNode
  count?: number
  defaultOpen?: boolean
  icon?: string
  title: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="min-w-0" data-testid="session-section">
      <button
        aria-expanded={open}
        className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
        onClick={() => setOpen(current => !current)}
        type="button"
      >
        <Codicon
          className={cn('shrink-0 text-(--ui-text-quaternary) transition-transform duration-200', open && 'rotate-90')}
          name="chevron-right"
          size="0.7rem"
        />
        {icon ? <Codicon className="shrink-0 text-(--ui-text-tertiary)" name={icon} size="0.8rem" /> : null}
        <span className="min-w-0 flex-1 truncate text-11 font-semibold text-(--ui-text-primary)">{title}</span>
        {count ? (
          <span className="shrink-0 rounded-full bg-(--ui-inline-code-background) px-1.5 py-0.5 text-10 tabular-nums text-(--ui-text-secondary)">
            {count}
          </span>
        ) : null}
      </button>
      <div className="session-collapse" data-open={open}>
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </section>
  )
}

function ApprovalCard({
  activity,
  bot,
  onAnswer,
  answering,
  error,
  s,
  sessionId
}: {
  activity: SessionActivity
  bot: string
  onAnswer: (activity: SessionActivity, choice: string) => void
  answering: boolean
  error: null | string
  s: NonNullable<ReturnType<typeof useBots>['sessionActivity']>
  sessionId: string
}) {
  const approval = activity.approval

  if (!approval) {
    return null
  }

  const settled = approval.status !== 'pending'

  const statusText =
    approval.status === 'approved'
      ? s.approvalApproved
      : approval.status === 'denied'
        ? s.approvalDenied
        : approval.status === 'expired'
          ? s.approvalExpired
          : ''

  return (
    <div
      className="mt-2 grid gap-2 rounded-xl border border-(--ui-stroke-tertiary) bg-(--ui-surface-overlay)/55 px-3 py-2.5"
      data-testid="session-approval"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Codicon className="mt-0.5 shrink-0 text-(--ui-icon-attention)" name="shield" size="0.9375rem" />
        <div className="min-w-0 flex-1">
          <div className="text-11 leading-snug text-(--ui-text-secondary)">
            {approval.description || approval.command}
          </div>
        </div>
        {settled ? (
          <span className="shrink-0 rounded-full bg-(--ui-inline-code-background) px-2 py-0.5 text-10 font-medium text-(--ui-text-secondary)">
            {statusText}
          </span>
        ) : null}
      </div>
      {approval.command ? (
        <pre className="max-h-32 overflow-auto rounded-md bg-(--ui-inline-code-background) px-2 py-1.5 font-mono text-10 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-(--ui-text-primary)">
          {approval.command}
        </pre>
      ) : null}
      {!settled && approval.kind === 'approval' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {approval.choices.map(choice => (
            <Button
              aria-label={`${s.answer} ${choice}`}
              disabled={answering}
              key={choice}
              onClick={() => onAnswer(activity, choice)}
              size="xs"
              variant={choice === 'deny' ? 'secondary' : 'default'}
            >
              {choice === 'deny' ? s.approvalDenied : choice === 'once' ? s.approvalApproved : choice}
            </Button>
          ))}
          <span className="text-10 text-(--ui-text-tertiary)">{s.approvalHint}</span>
        </div>
      ) : null}
      {!settled && approval.kind === 'clarify' ? (
        <div className="flex flex-wrap items-center gap-1.5 text-11 text-(--ui-text-tertiary)">
          <Button onClick={() => void host.openSession(sessionId, { intent: 'tab' })} size="xs" variant="ghost">
            {s.openChat}
          </Button>
          <span>{s.approvalHint}</span>
        </div>
      ) : null}
      {answering ? <div className="text-10 text-(--ui-text-tertiary)">{s.answering}</div> : null}
      {error ? <div className="text-10 text-destructive">{error}</div> : null}
    </div>
  )
}

function ActivityRow({
  activity,
  bot,
  expanded,
  onToggle,
  onAnswer,
  answering,
  answerError,
  s,
  sessionId
}: {
  activity: SessionActivity
  bot: string
  expanded: boolean
  onToggle: () => void
  onAnswer: (activity: SessionActivity, choice: string) => void
  answering: boolean
  answerError: null | string
  s: NonNullable<ReturnType<typeof useBots>['sessionActivity']>
  sessionId: string
}) {
  const took = duration(activity)
  const [showTrace, setShowTrace] = useState(false)

  return (
    <li className="min-w-0" data-testid="session-activity-row">
      <button
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
        onClick={onToggle}
        type="button"
      >
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
          {activity.status === 'running' ? (
            <GlyphSpinner className="text-(--ui-accent)" spinner="breathe" />
          ) : (
            <Codicon className={statusTone(activity.status)} name={STATUS_GLYPH[activity.status]} size="0.8125rem" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-(--ui-text-primary)">{activity.title}</span>
            <StatusBadge status={activity.status} text={s} />
          </span>
          {activity.summary ? (
            <span className="mt-0.5 line-clamp-2 block text-11 leading-relaxed text-(--ui-text-secondary)">
              {activity.summary}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-10 tabular-nums text-(--ui-text-tertiary)">
          <span>{relativeTime(activity.startedAt)}</span>
          {took ? <span>{took}</span> : null}
        </span>
      </button>
      {expanded ? (
        <div className="px-9 pb-2">
          {activity.detail && !activity.approval ? (
            <pre className="max-h-64 overflow-auto rounded-md bg-(--ui-inline-code-background) px-2 py-1.5 font-mono text-10 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-(--ui-text-secondary)">
              {activity.detail}
            </pre>
          ) : null}
          {activity.steps?.length ? (
            <div className="mt-1">
              <Button onClick={() => setShowTrace(current => !current)} size="xs" variant="ghost">
                {showTrace ? s.hideDetails : s.showDetails}
              </Button>
              {showTrace ? (
                <ol
                  className="mt-1 grid gap-1 border-l border-(--ui-stroke-tertiary) pl-2.5"
                  data-testid="activity-trace"
                >
                  {activity.steps.map(step => {
                    const failed = step.status === 'failed'

                    return (
                      <li className="flex min-w-0 items-start gap-1.5 text-10" key={step.id}>
                        <Codicon
                          className={
                            failed
                              ? 'mt-px shrink-0 text-(--ui-icon-attention)'
                              : 'mt-px shrink-0 text-(--ui-text-tertiary)'
                          }
                          name={failed ? 'error' : step.status === 'running' ? 'sync' : 'pass'}
                          size="0.65rem"
                        />
                        <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary)">
                          {step.tool}
                          {step.target ? ` · ${step.target}` : ''}
                        </span>
                        <span className="shrink-0 tabular-nums text-(--ui-text-quaternary)">
                          {relativeTime(step.at)}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              ) : null}
            </div>
          ) : null}
          {activity.approval ? (
            <ApprovalCard
              activity={activity}
              answering={answering}
              bot={bot}
              error={answerError}
              onAnswer={onAnswer}
              s={s}
              sessionId={sessionId}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

interface SubagentStep {
  input_bytes?: null | number
  output_bytes?: null | number
  status?: string
  targets?: Record<string, string>
  tool?: string
}

interface SubagentRow {
  duration_ms?: null | number
  goal: string
  role?: string
  session_id?: string
  started_at: number
  status: string
  stopped_at?: null | number
  subagent_id: string
  summary?: string
  tool_calls?: SubagentStep[]
}

function subagentStatus(status: string, a: ReturnType<typeof useI18n>['t']['agents']) {
  switch (status) {
    case 'succeeded':
      return { glyph: 'pass', label: a.done, tone: 'text-(--ui-green)' }

    case 'failed':
      return { glyph: 'error', label: a.failed, tone: 'text-destructive' }

    case 'cancelled':
      return { glyph: 'debug-stop', label: a.failed, tone: 'text-(--ui-text-tertiary)' }

    case 'queued':
      return { glyph: 'watch', label: a.queued, tone: 'text-(--ui-icon-attention)' }

    default:
      return { glyph: 'sync', label: a.running, tone: 'text-(--ui-accent)' }
  }
}

function stepLabel(step: SubagentStep): string {
  const tool = String(step.tool || 'tool')
    .split('_')
    .filter(Boolean)
    .join(' ')

  const targets = Object.values(step.targets || {})
    .filter(Boolean)
    .join(' · ')

  return targets ? `${tool} · ${targets}` : tool
}

function shortMs(ms: null | number | undefined): string {
  if (!ms || ms < 0) {
    return ''
  }

  const seconds = Math.round(ms / 1000)

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function SubagentCard({ agent }: { agent: SubagentRow }) {
  const { t } = useI18n()
  const a = t.agents
  const [open, setOpen] = useState(false)
  const status = subagentStatus(agent.status, a)

  const duration =
    agent.duration_ms ?? (agent.stopped_at && agent.started_at ? (agent.stopped_at - agent.started_at) * 1000 : null)

  const steps = agent.tool_calls || []

  return (
    <li
      className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-surface-overlay)/35"
      data-testid="subagent-row"
    >
      <button
        aria-expanded={open}
        className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
        onClick={() => setOpen(current => !current)}
        type="button"
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          {agent.status === 'running' ? (
            <GlyphSpinner className="text-(--ui-accent)" spinner="breathe" />
          ) : (
            <Codicon className={status.tone} name={status.glyph} size="0.8rem" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-11 font-medium leading-snug text-(--ui-text-primary)">
            {agent.goal || agent.subagent_id}
          </span>
          {agent.summary ? (
            <span className="mt-0.5 line-clamp-2 block text-10 leading-relaxed text-(--ui-text-tertiary)">
              {agent.summary}
            </span>
          ) : null}
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-10 text-(--ui-text-tertiary)">
            <span className={status.tone}>{status.label}</span>
            {agent.role ? (
              <span className="rounded bg-(--ui-inline-code-background) px-1 py-px">{agent.role}</span>
            ) : null}
            {steps.length ? <span>{a.toolsCount(steps.length)}</span> : null}
            {duration ? <span>{shortMs(duration)}</span> : null}
          </span>
        </span>
        <Codicon
          className={cn('mt-0.5 shrink-0 text-(--ui-text-quaternary) transition-transform', open && 'rotate-90')}
          name="chevron-right"
          size="0.75rem"
        />
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-(--ui-stroke-tertiary) px-3 py-2" data-testid="subagent-detail">
          {agent.summary ? (
            <p className="text-11 leading-relaxed text-(--ui-text-secondary)">{agent.summary}</p>
          ) : (
            <p className="text-11 text-(--ui-text-tertiary)">{a.waitingActivity}</p>
          )}
          {steps.length ? (
            <ol className="grid gap-1 border-l border-(--ui-stroke-tertiary) pl-2.5">
              {steps.map((step, index) => {
                const failed = step.status === 'error' || step.status === 'failed'

                return (
                  <li className="flex min-w-0 items-start gap-1.5 text-10" key={`${step.tool}-${index}`}>
                    <Codicon
                      className={
                        failed ? 'mt-px shrink-0 text-destructive' : 'mt-px shrink-0 text-(--ui-text-tertiary)'
                      }
                      name={failed ? 'error' : 'pass'}
                      size="0.65rem"
                    />
                    <span className="min-w-0 truncate text-(--ui-text-secondary)">{stepLabel(step)}</span>
                  </li>
                )
              })}
            </ol>
          ) : null}
          <div className="flex flex-wrap gap-2 text-10 text-(--ui-text-tertiary)">
            {agent.session_id ? <span className="font-mono">{agent.session_id.slice(0, 12)}</span> : null}
            {a.filesCount((agent.tool_calls || []).length)}
          </div>
        </div>
      ) : null}
    </li>
  )
}

export function SessionActivityPanel({
  bot,
  jobs,
  onOpenScheduled,
  owner,
  sessions,
  sessionsError,
  sessionsLoading,
  onRetrySessions
}: {
  bot: string
  jobs?: RoutineJob[]
  onOpenScheduled?: () => void
  owner: RosterRow
  sessions: SessionOption[]
  sessionsError: boolean
  sessionsLoading: boolean
  onRetrySessions: () => void
}) {
  const b = useBots()
  const s = b.sessionActivity!
  const [selectedId, setSelectedId] = useState('')
  const [limit, setLimit] = useState(20)
  const [expandedId, setExpandedId] = useState<null | string>(null)
  const [answering, setAnswering] = useState<null | string>(null)
  const [answerError, setAnswerError] = useState<null | string>(null)
  const [explainOpen, setExplainOpen] = useState(false)

  // Newest session first; selecting one is the ONLY way a feed appears.
  const ordered = useMemo(
    () => [...sessions].sort((left, right) => Number(right.last_active ?? 0) - Number(left.last_active ?? 0)),
    [sessions]
  )

  useEffect(() => {
    if (!ordered.length) {
      setSelectedId('')

      return
    }

    if (!ordered.some(session => session.id === selectedId)) {
      setSelectedId(String(ordered[0].id || ''))
    }
  }, [ordered, selectedId])

  useEffect(() => {
    setLimit(20)
    setExpandedId(null)
    setAnswerError(null)
  }, [selectedId])

  const selected = ordered.find(session => session.id === selectedId) || null
  const resolvedId = String(selected?.resolved_id ?? '') || selectedId
  const focusedStored = String(useValue(host.state.focusedStoredSessionId ?? NO_STORED_SESSION) ?? '')
  const focusedRuntime = String(useValue(host.state.focusedSessionId ?? NO_RUNTIME_SESSION) ?? '')
  const isFocusedSession = Boolean(selectedId) && (focusedStored === selectedId || focusedStored === resolvedId)
  const runtimeId = isFocusedSession ? focusedRuntime : resolvedId

  const history = useQuery({
    enabled: Boolean(selectedId && owner?.name),
    queryFn: () => requestForBot(owner, 'session.history', { limit: 200, session_id: selectedId }),
    queryKey: ['bot-session-activity', bot, selectedId],
    refetchOnWindowFocus: false,
    staleTime: 5000
  })

  const approvals = useQuery({
    enabled: Boolean(selectedId),
    queryFn: async () => {
      try {
        const body = await host.request<{ activities?: Array<Record<string, unknown>> }>('bot_context.activities', {
          profile: bot,
          session_id: resolvedId,
          status: 'pending'
        })

        return Array.isArray(body?.activities) ? body.activities : []
      } catch {
        // The plugin is optional; the mirrored group prompt still covers a
        // bot that is blocked inside a room.
        return []
      }
    },
    queryKey: ['bot-session-approvals', bot, selectedId],
    refetchInterval: 15000,
    retry: false
  })

  const approvalLog = useQuery({
    enabled: Boolean(selectedId),
    queryFn: async () => {
      try {
        const body = await host.request<{ decisions?: Array<Record<string, unknown>> }>('bot_context.history', {
          profile: bot,
          session_id: resolvedId,
          limit: 20
        })

        return Array.isArray(body?.decisions) ? body.decisions : []
      } catch {
        return []
      }
    },
    queryKey: ['bot-session-approval-history', bot, selectedId],
    retry: false,
    staleTime: 15000
  })

  const subagents = useQuery({
    enabled: Boolean(selectedId),
    queryFn: async () => {
      try {
        const body = await host.request<{ subagents?: SubagentRow[] }>('bot_context.subagents', {
          session_id: runtimeId || resolvedId
        })

        return Array.isArray(body?.subagents) ? body.subagents : []
      } catch {
        return []
      }
    },
    queryKey: ['bot-session-subagents', bot, selectedId, runtimeId],
    refetchInterval: 5000,
    retry: false,
    staleTime: 2000
  })

  // Persisted tool rows → one item per call, oldest first.
  useEffect(() => {
    if (!selectedId || !history.data) {
      return
    }

    const data = history.data as { messages?: unknown; rows?: unknown } | unknown[]
    const rows = Array.isArray(data) ? data : (data.messages ?? data.rows ?? [])
    mergeIntoSession(
      { profile: bot, sessionId: selectedId },
      activityFromHistory({ profile: bot, sessionId: selectedId }, rows)
    )
  }, [bot, history.data, selectedId])

  // Live tool events, only for the session the runtime is actually on.
  useEffect(() => {
    if (!selectedId || !runtimeId) {
      return
    }

    const ref = { profile: bot, sessionId: selectedId }

    const offStart = host.onEvent('tool.start', event => {
      if (String(event.session_id ?? '') !== runtimeId) {
        return
      }

      const item = activityFromToolEvent(ref, 'tool.start', event.payload as Record<string, unknown>)

      if (item) {
        mergeIntoSession(ref, [item])
      }
    })

    const offDone = host.onEvent('tool.complete', event => {
      if (String(event.session_id ?? '') !== runtimeId) {
        return
      }

      const item = activityFromToolEvent(ref, 'tool.complete', event.payload as Record<string, unknown>)

      if (item) {
        mergeIntoSession(ref, [item])
      }
    })

    const offAsk = host.onEvent('approval.request', event => {
      if (String(event.session_id ?? '') !== runtimeId) {
        return
      }

      const payload = (event.payload ?? {}) as Record<string, unknown>

      const item = approvalFromPrompt(ref, {
        choices: payload.choices,
        command: payload.command,
        description: payload.description,
        kind: 'approval',
        question: payload.description ?? payload.command,
        requestId: payload.prompt_id ?? payload.request_id
      })

      if (item) {
        mergeIntoSession(ref, [item])
      }
    })

    const offSettled = host.onEvent('approval.response', event => {
      if (String(event.session_id ?? '') !== runtimeId) {
        return
      }

      const payload = (event.payload ?? {}) as Record<string, unknown>
      const requestId = String(payload.prompt_id ?? payload.request_id ?? '')
      const choice = String(payload.choice ?? '')

      if (requestId) {
        decideInSession(
          ref,
          requestId,
          choice === 'deny' ? 'denied' : choice === 'timeout' || choice === 'cancelled' ? 'expired' : 'approved',
          choice || null
        )
      }
    })

    return () => {
      offStart()
      offDone()
      offAsk()
      offSettled()
    }
  }, [bot, runtimeId, selectedId])

  // Room prompts are already mirrored by session id; merge only this bot's.
  const clarify = useValue($groupClarify)
  useEffect(() => {
    if (!selectedId) {
      return
    }

    const ref = { profile: bot, sessionId: selectedId }
    const items: SessionActivity[] = []

    for (const prompt of Object.values(clarify)) {
      if (!prompt || prompt.member !== bot || prompt.kind !== 'approval') {
        continue
      }

      if (!prompt.sessionId || String(prompt.sessionId) !== runtimeId) {
        continue
      }

      const item = approvalFromPrompt(ref, { ...prompt, requestId: prompt.requestId })

      if (item) {
        items.push(item)
      }
    }

    if (items.length) {
      mergeIntoSession(ref, items)
    }
  }, [bot, clarify, runtimeId, selectedId])

  // Plugin-side approvals are the cross-session source of truth. They are
  // merged by their own request id, so an already-mirrored prompt stays one row.
  useEffect(() => {
    if (!selectedId || !approvals.data?.length) {
      return
    }

    const ref = { profile: bot, sessionId: selectedId }
    const items: SessionActivity[] = []

    for (const activity of approvals.data) {
      const session = (activity.session ?? {}) as Record<string, unknown>

      if (String(session.id ?? '') && ![selectedId, resolvedId, runtimeId].includes(String(session.id))) {
        continue
      }

      const requestId = String(activity.activity_id ?? '')

      if (!requestId) {
        continue
      }

      const prompt = {
        choices: activity.choices,
        command: activity.command,
        description: activity.description,
        kind: activity.kind,
        question: activity.description,
        requestId
      }

      const settled = String(activity.status ?? '') !== 'pending'
      items.push(
        settled
          ? settledApprovalActivity(
              ref,
              requestId,
              String(activity.status) === 'approved'
                ? 'approved'
                : String(activity.status) === 'denied'
                  ? 'denied'
                  : 'expired',
              (activity.settled_choice as null | string) ?? null,
              timestampMs(activity.settled_at) || Date.now(),
              prompt
            )
          : (approvalFromPrompt(ref, prompt) as SessionActivity)
      )
    }

    if (items.length) {
      mergeIntoSession(ref, items)
    }
  }, [approvals.data, bot, resolvedId, runtimeId, selectedId])

  const activityStore = useValue($sessionActivity)
  const page = activityFor(activityStore, { profile: bot, sessionId: selectedId }, limit)
  const counts = activityCounts(page.items)
  const reachable = owner.sourceReachable !== false && !owner.ghost && !owner.sourceMissing

  const answer = async (activity: SessionActivity, choice: string) => {
    const requestId = activity.approval?.requestId

    if (!requestId) {
      return
    }

    setAnswering(requestId)
    setAnswerError(null)

    try {
      const prompt = Object.values($groupClarify.get()).find(
        entry => entry?.requestId === requestId && entry.member === bot
      )

      if (prompt) {
        await answerGroupClarify(prompt, { name: bot }, choice)
      } else {
        try {
          const body = await host.request<{ error?: string; ok?: boolean }>('bot_context.respond', {
            choice,
            request_id: requestId
          })

          if (body && body.ok === false) {
            throw new Error(body.error || 'The approval was refused.')
          }
        } catch (error) {
          // Only a missing plugin method falls back to the stock queue. A
          // permission refusal or a stale prompt must surface as-is.
          if (!methodMissing(error)) {
            throw error
          }

          await host.request('approval.respond', {
            choice,
            request_id: requestId,
            session_id: runtimeId || selectedId
          })
        }
      }

      decideInSession(
        { profile: bot, sessionId: selectedId },
        requestId,
        choice === 'deny' ? 'denied' : 'approved',
        choice
      )
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : String(error))
      // Keep the row actionable after a refusal: the prompt is still waiting.
      decideInSession({ profile: bot, sessionId: selectedId }, requestId, 'pending', null)
    } finally {
      setAnswering(null)
    }
  }

  if (sessionsLoading && !ordered.length) {
    return (
      <div aria-busy="true" className="grid gap-2 px-2 py-3" data-testid="session-activity-loading">
        <div className="h-8 animate-pulse rounded-md bg-(--ui-control-active-background)" />
        <div className="h-8 animate-pulse rounded-md bg-(--ui-control-active-background)" />
        <div className="h-20 animate-pulse rounded-md bg-(--ui-control-active-background)" />
      </div>
    )
  }

  if (sessionsError && !ordered.length) {
    return (
      <div className="px-2 py-2" data-testid="session-activity-error">
        <PanelEmpty
          action={
            <Button onClick={onRetrySessions} size="sm" variant="secondary">
              {s.retry}
            </Button>
          }
          description={s.failed}
          icon="warning"
          title={s.title}
        />
      </div>
    )
  }

  if (!ordered.length) {
    return (
      <div className="px-2 py-2" data-testid="session-activity-no-sessions">
        <PanelEmpty description={s.noSessionsHint} icon="comment" title={s.noSessions} />
      </div>
    )
  }

  const groups = groupByDay(page.items)

  return (
    <div className="grid min-w-0 gap-1.5" data-testid="session-activity">
      <style>{`
        .session-collapse { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .3s ease-out, opacity .3s ease-out; }
        .session-collapse[data-open="true"] { grid-template-rows: 1fr; opacity: 1; }
      `}</style>
      <div className="mx-2 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-surface-overlay)/50 px-2 py-1.5">
        <button
          aria-expanded={explainOpen}
          className="flex w-full items-center gap-1.5 text-left text-11 font-semibold text-(--ui-text-primary)"
          onClick={() => setExplainOpen(open => !open)}
          type="button"
        >
          <Codicon name={explainOpen ? 'chevron-down' : 'chevron-right'} size="0.75rem" />
          {s.explaining}
          <span className="ml-auto inline-flex items-center gap-1 text-10 font-normal text-(--ui-text-tertiary)">
            <span
              aria-hidden
              className={cn('size-1.5 rounded-full', reachable ? 'bg-(--ui-green)' : 'bg-destructive/70')}
            />
            {reachable ? s.updated : s.failedStatus}
          </span>
        </button>
        {explainOpen ? (
          <p className="mt-1 text-11 leading-relaxed text-(--ui-text-secondary)">{s.explainBody}</p>
        ) : null}
      </div>

      <CollapsibleSection count={ordered.length} icon="comment-discussion" title={s.sessionsLabel}>
        <div aria-label={s.sessionsLabel} className="flex gap-1 overflow-x-auto px-2 pb-1" role="listbox">
          {ordered.map(session => {
            const active = session.id === selectedId
            const title = String(session.title || session.id)

            return (
              <button
                aria-selected={active}
                className={cn(
                  'flex min-w-28 max-w-44 shrink-0 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)',
                  active
                    ? 'border-(--ui-accent)/40 bg-(--ui-accent)/10'
                    : 'border-(--ui-stroke-tertiary) hover:bg-(--chrome-action-hover)'
                )}
                key={session.id}
                onClick={() => setSelectedId(String(session.id))}
                role="option"
                type="button"
              >
                <span className="w-full truncate text-11 font-medium text-(--ui-text-primary)">{title}</span>
                <span className="text-10 text-(--ui-text-tertiary)">
                  {session.last_active ? relativeTime(Number(session.last_active) * 1000) : ''}
                </span>
              </button>
            )
          })}
        </div>
      </CollapsibleSection>

      <div className="flex items-center justify-between gap-2 px-2">
        <span className="text-10 text-(--ui-text-tertiary)">{s.count(page.total)}</span>
        <span className="flex items-center gap-1">
          {counts.running ? <StatusBadge status="running" text={s} /> : null}
          {counts.waiting ? <StatusBadge status="waiting" text={s} /> : null}
          {counts.failed ? <StatusBadge status="failed" text={s} /> : null}
        </span>
      </div>

      {history.isLoading && !page.total ? (
        <div aria-busy="true" className="grid gap-1.5 px-2 py-1" data-testid="session-activity-history-loading">
          <div className="h-7 animate-pulse rounded-md bg-(--ui-control-active-background)" />
          <div className="h-7 animate-pulse rounded-md bg-(--ui-control-active-background)" />
          <div className="h-7 w-3/4 animate-pulse rounded-md bg-(--ui-control-active-background)" />
        </div>
      ) : history.error && !page.total ? (
        <div className="px-2 py-1">
          <PanelEmpty
            action={
              <Button onClick={() => void history.refetch()} size="sm" variant="secondary">
                {s.retry}
              </Button>
            }
            description={s.failed}
            icon="warning"
            title={s.title}
          />
        </div>
      ) : page.total === 0 ? (
        <div className="px-2 py-1">
          <PanelEmpty description={s.emptyHint} icon="pulse" title={s.emptyTitle} />
        </div>
      ) : (
        <div className="px-1">
          {groups.map(group => (
            <CollapsibleSection count={group.items.length} icon="calendar" key={group.at} title={dayLabel(group.at)}>
              <ul className="grid gap-0.5">
                {group.items.map(activity => (
                  <ActivityRow
                    activity={activity}
                    answerError={answering === activity.approval?.requestId ? answerError : null}
                    answering={answering === activity.approval?.requestId}
                    bot={bot}
                    expanded={expandedId === activity.id}
                    key={activity.id}
                    onAnswer={(activity, choice) => void answer(activity, choice)}
                    onToggle={() => setExpandedId(current => (current === activity.id ? null : activity.id))}
                    s={s}
                    sessionId={selectedId}
                  />
                ))}
              </ul>
            </CollapsibleSection>
          ))}
          {page.hasMore ? (
            <div className="flex justify-center py-2">
              <Button onClick={() => setLimit(current => current + 20)} size="xs" variant="ghost">
                {s.loadOlder}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <CollapsibleSection
        count={approvalLog.data?.length || 0}
        defaultOpen={Boolean(approvalLog.data?.length)}
        icon="history"
        title={s.approvalHistory}
      >
        {approvalLog.data?.length ? (
          <ul className="grid gap-0.5 px-1 pb-1" data-testid="approval-history">
            {approvalLog.data.map(row => {
              const requestId = String(row.activity_id || '')
              const status = String(row.status || '')
              const approved = status === 'approved'
              const denied = status === 'denied'
              const at = timestampMs(row.settled_at) || Date.now()

              return (
                <li
                  className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-(--chrome-action-hover)"
                  key={requestId || `${row.command}-${at}`}
                >
                  <Codicon
                    className={cn(
                      'mt-0.5 shrink-0',
                      approved ? 'text-(--ui-green)' : denied ? 'text-destructive' : 'text-(--ui-text-quaternary)'
                    )}
                    name={approved ? 'pass' : denied ? 'error' : 'clock'}
                    size="0.8rem"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-11 font-medium text-(--ui-text-primary)">
                      {String(row.command || row.description || requestId)}
                    </span>
                    <span className="text-10 text-(--ui-text-tertiary)">
                      {approved ? s.approvalApproved : denied ? s.approvalDenied : s.approvalExpired}
                      {' · '}
                      {relativeTime(at)}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-3 pb-2 text-10 text-(--ui-text-tertiary)">{s.approvalHistoryEmpty}</p>
        )}
      </CollapsibleSection>

      {subagents.data?.length ? (
        <CollapsibleSection count={subagents.data.length} icon="organization" title={s.subagents}>
          <ul className="grid gap-1 px-1 pb-1">
            {subagents.data.map(agent => (
              <SubagentCard agent={agent} key={agent.subagent_id} />
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}

      {jobs?.length ? (
        <CollapsibleSection count={jobs.length} icon="watch" title={s.scheduledTasks}>
          <ul className="grid gap-0.5 px-1 pb-1">
            {jobs.slice(0, 3).map(job => {
              const next = job.next_run_at ? Date.parse(job.next_run_at) : Number.NaN

              return (
                <li className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5" key={job.job_id}>
                  <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="calendar" size="0.8rem" />
                  <span className="min-w-0 flex-1 truncate text-11 text-(--ui-text-primary)">
                    {String(job.name || job.job_id).replace(/^\[bot:[^\]]+\]\s*/, '')}
                  </span>
                  <span className="shrink-0 text-10 tabular-nums text-(--ui-text-tertiary)">
                    {Number.isFinite(next) ? relativeTime(next) : String(job.schedule || '')}
                  </span>
                </li>
              )
            })}
          </ul>
          {onOpenScheduled ? (
            <div className="px-2 pb-2 pt-1">
              <Button onClick={onOpenScheduled} size="xs" variant="ghost">
                {s.seeAll}
              </Button>
            </div>
          ) : null}
        </CollapsibleSection>
      ) : null}
    </div>
  )
}

/** A session row can be a stored id; the live runtime id is what events carry. */
export function sessionRefFor(bot: string, session: SessionOption): { profile: string; sessionId: string } {
  return { profile: bot, sessionId: String(session.id) }
}
