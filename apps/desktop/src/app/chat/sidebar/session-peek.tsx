import { compactNumber } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { HoverCard } from 'radix-ui'
import { type ReactNode, useState } from 'react'

import { PrTag } from '@/app/chat/pr-tag'
import { sessionDotClassName } from '@/app/chat/session-status-dot'
import { formatMessageTimestamp } from '@/components/assistant-ui/thread/timestamp'
import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { usePopoverPortalContainer } from '@/components/ui/dialog-portal-context'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import type { SessionInfo } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { displayPath } from '@/lib/display-path'
import { displayModelName } from '@/lib/model-status-label'
import { sessionProjectLabel } from '@/lib/session-project-label'
import { handoffOriginSource, sessionSourceLabel } from '@/lib/session-source'
import { fmtDateTime, formatElapsedClock } from '@/lib/time'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { respondToApprovalAction } from '@/store/native-notifications'
import { normalizeProfileKey } from '@/store/profile'
import { $projects } from '@/store/projects'
import { $approvalRequests } from '@/store/prompts'
import { $pullRequestsByBranch, sessionPrKey } from '@/store/pull-requests'
import { sessionColorFor } from '@/store/session-color'
import { $sessionDigestById } from '@/store/session-digest'
import { $sessionDotStateById, type SessionDotState } from '@/store/session-dot-state'
import { sessionLiveSummary, type SessionLiveSummary } from '@/store/session-live'
import { openSessionTile } from '@/store/session-states-tiles'
import { sessionTileDelegate } from '@/store/session-states-tiles-core'
import { sessionCostUsd } from '@/store/sidebar-archive'
import { $subagentsBySession } from '@/store/subagents'

/** Deliberate-dwell delay: longer than `OverflowTip`'s 600ms so the row's own
 *  tips answer a casual lingering hover first — the peek only claims a cursor
 *  that stays put past them. The card is an inspection gesture, not a reflex. */
const PEEK_OPEN_DELAY_MS = 450
const PEEK_CLOSE_DELAY_MS = 120

const PEEK_MAX_TODOS = 6

// Same resolved state the row's dot paints — the card cannot disagree with it.
const STATE_LABEL: Record<
  SessionDotState,
  (r: Translations['sidebar']['row'], p: Translations['sidebar']['peek']) => string
> = {
  background: r => r.backgroundRunning,
  draft: r => r.draftSession,
  idle: (_r, p) => p.idle,
  'needs-input': r => r.needsInput,
  stalled: r => r.sessionRunning,
  unread: r => r.finishedUnread,
  working: r => r.sessionRunning
}

function PeekRow({ children, label, wrap }: { children: ReactNode; label: string; wrap?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-14 shrink-0 text-ui-2xs leading-4 text-fg-muted">{label}</span>
      <span className={cn('min-w-0 flex-1 text-ui-xs leading-4 text-fg-secondary', wrap ? 'break-words' : 'truncate')}>
        {children}
      </span>
    </div>
  )
}

/** Elapsed run clock. Ticks once a second via the shared elapsed hook, which
 *  pauses while the window is hidden and clears on unmount. */
function PeekElapsed({ since }: { since: number }) {
  const elapsed = useElapsedSeconds(true, undefined, since)

  return <span className="text-ui-2xs text-fg-muted tabular-nums">{formatElapsedClock(elapsed)}</span>
}

function TodoMark({ status }: { status: string }) {
  if (status === 'completed') {
    return <Codicon className="shrink-0 text-success" name="check" size="0.75rem" />
  }

  if (status === 'in_progress') {
    // Half-filled in the accent, so the mark keeps meaning "active" on every skin.
    return (
      <span aria-hidden="true" className="inline-flex size-3 shrink-0 overflow-hidden rounded-full border border-brand">
        <span className="h-full w-1/2 bg-brand" />
      </span>
    )
  }

  return <Codicon className="shrink-0 text-fg-subtle" name="circle" size="0.75rem" />
}

function PeekActions({
  onOpen,
  runtimeId,
  showApprove,
  showStop,
  sessionId
}: {
  onOpen?: () => void
  runtimeId: null | string
  showApprove: boolean
  showStop: boolean
  sessionId: string
}) {
  const { t } = useI18n()
  const p = t.sidebar.peek
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<null | string>(null)

  const handleStop = async () => {
    if (!runtimeId || stopping) {
      return
    }

    setStopping(true)
    setStopError(null)

    try {
      await sessionTileDelegate()?.interruptSession(runtimeId)
    } catch (error) {
      setStopError(error instanceof Error ? error.message : p.stopFailed)
      setStopping(false)
    }
  }

  return (
    <div>
      <div className="mt-1 flex items-center gap-1.5">
        {onOpen ? (
          <Button onClick={onOpen} size="xs" variant="secondary">
            {t.common.open}
          </Button>
        ) : null}
        <Button onClick={() => openSessionTile(sessionId, 'right')} size="xs" variant="ghost">
          <Codicon name="split-horizontal" />
          {t.sidebar.row.openInSplit}
        </Button>
        <span className="flex-1" />
        {showStop && runtimeId ? (
          <Button disabled={stopping} onClick={handleStop} size="xs" variant="ghost">
            <Codicon name="debug-stop" />
            {t.composer.stop}
          </Button>
        ) : null}
        {showApprove && runtimeId ? (
          <Button onClick={() => void respondToApprovalAction(runtimeId, 'approve')} size="xs" variant="default">
            {t.common.approve}
          </Button>
        ) : null}
      </div>
      {stopError ? <p className="mt-1 text-ui-2xs text-danger">{stopError}</p> : null}
    </div>
  )
}

function SessionPeekLiveBody({
  onOpen,
  session,
  summary
}: {
  onOpen?: () => void
  session: SessionInfo
  summary: SessionLiveSummary
}) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const p = t.sidebar.peek

  const digest = useStoreSelector($sessionDigestById, digests => digests[session.id])

  const approval = useStoreSelector($approvalRequests, all =>
    summary.runtimeId ? all[summary.runtimeId] : undefined
  )

  const title = sessionTitle(session)
  const visibleTodos = summary.todos.filter(todo => todo.status !== 'cancelled')
  const shownTodos = visibleTodos.slice(0, PEEK_MAX_TODOS)
  const hiddenTodoCount = visibleTodos.length - shownTodos.length
  const toolLine = summary.tool ? (summary.tool.target ? `${summary.tool.name} · ${summary.tool.target}` : summary.tool.name) : null

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {summary.todoTotal > 0 ? (
          <span className="text-ui-2xs font-medium text-fg-secondary tabular-nums">
            {p.planFraction(summary.todoDone, summary.todoTotal)}
          </span>
        ) : (
          <span aria-hidden="true" className={sessionDotClassName(summary.dotState)} />
        )}
        <span className="text-ui-2xs font-medium text-fg-secondary">{STATE_LABEL[summary.dotState](r, p)}</span>
        {summary.turnStartedAt != null ? <PeekElapsed since={summary.turnStartedAt} /> : null}
      </div>
      <p className="line-clamp-2 min-w-0 break-words text-ui-sm font-medium leading-snug text-fg">{title}</p>
      {digest ? <p className="line-clamp-2 min-w-0 break-words text-ui-xs leading-snug text-fg-secondary">{digest}</p> : null}
      {shownTodos.length ? (
        <ul className="flex min-w-0 flex-col gap-0.5">
          {shownTodos.map(todo => (
            <li className={cn('flex min-w-0 items-center gap-1.5', todo.parent && 'pl-4')} key={todo.id}>
              <TodoMark status={todo.status} />
              <span className="min-w-0 flex-1 truncate text-ui-xs text-fg-secondary">{todo.content}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {hiddenTodoCount > 0 ? <p className="text-ui-2xs text-fg-muted">{p.more(hiddenTodoCount)}</p> : null}
      {summary.step && summary.step !== digest ? (
        <p className="truncate text-ui-xs text-fg-secondary">{summary.step}</p>
      ) : null}
      {toolLine ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-ui-2xs text-fg-muted">{p.lastTool}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-ui-2xs text-fg-muted">{toolLine}</span>
          {summary.tool?.status === 'running' ? <GlyphSpinner className="size-3 shrink-0" /> : null}
          {summary.tool?.status === 'error' ? <Codicon className="shrink-0 text-danger" name="error" size="0.75rem" /> : null}
        </div>
      ) : null}
      <PeekActions
        onOpen={onOpen}
        runtimeId={summary.runtimeId}
        sessionId={session.id}
        showApprove={approval !== undefined}
        showStop={summary.group === 'working'}
      />
    </div>
  )
}

function SessionPeekIdleBody({ onOpen, session }: { onOpen?: () => void; session: SessionInfo }) {
  const { t } = useI18n()
  const r = t.sidebar.row
  const p = t.sidebar.peek
  const fmt = t.sidebar

  const dotState = useStoreSelector($sessionDotStateById, states => states[session.id] ?? 'idle')
  const prKey = sessionPrKey(session)
  const pr = useStoreSelector($pullRequestsByBranch, prs => (prKey ? prs[prKey] : undefined))
  const subagents = useStoreSelector($subagentsBySession, map => map[session.id])
  const workspace = useStoreSelector($projects, projects => sessionProjectLabel(session, projects))

  const title = sessionTitle(session)
  const profile = normalizeProfileKey(session.profile)
  const totalTokens = session.input_tokens + session.output_tokens
  const cost = sessionCostUsd(session)
  const runningAgents = subagents?.filter(a => a.status === 'running' || a.status === 'queued').length ?? 0
  const handoffSource = handoffOriginSource(session.handoff_state, session.handoff_platform)
  const sourceLabel = sessionSourceLabel(handoffSource ?? session.source)

  const stats = [
    session.message_count > 0 ? fmt.messageCount(session.message_count) : null,
    session.tool_call_count > 0 ? fmt.toolCallCount(session.tool_call_count) : null,
    totalTokens > 0 ? p.tokens(compactNumber(totalTokens)) : null,
    // Below a cent the figure reads as a bug — same rule the row uses.
    cost >= 0.01 ? `$${cost.toFixed(2)}` : null
  ].filter(Boolean)

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {dotState === 'idle' ? (
          <span
            aria-hidden="true"
            className={sessionDotClassName('idle')}
            style={(() => {
              const color = sessionColorFor(session)

              return color ? { backgroundColor: color } : undefined
            })()}
          />
        ) : (
          <span aria-hidden="true" className={sessionDotClassName(dotState)} />
        )}
        <span className="text-ui-2xs font-medium text-fg-secondary">{STATE_LABEL[dotState](r, p)}</span>
        {session.archived ? <span className="text-ui-2xs text-fg-muted">· {p.archived}</span> : null}
      </div>
      <p className="line-clamp-2 min-w-0 break-words text-ui-sm font-medium leading-snug text-fg">{title}</p>
      {session.preview ? (
        <p className="line-clamp-3 min-w-0 break-words text-ui-xs leading-snug text-fg-muted">{session.preview}</p>
      ) : null}
      <div className="mt-0.5 flex flex-col gap-1">
        {workspace || session.cwd ? (
          <PeekRow label={p.workspace}>{workspace ?? displayPath(session.cwd ?? '')}</PeekRow>
        ) : null}

        {session.git_branch ? (
          <PeekRow label={p.branch}>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="truncate">{session.git_branch}</span>
              {pr ? <PrTag pr={pr} showIcon={false} /> : null}
            </span>
          </PeekRow>
        ) : null}
        {session.model ? <PeekRow label={p.model}>{displayModelName(session.model)}</PeekRow> : null}
        {stats.length ? <PeekRow label={p.stats} wrap>{stats.join(' · ')}</PeekRow> : null}
        {subagents?.length ? (
          <PeekRow label={p.agents}>
            {p.agentsSummary(subagents.length)}
            {runningAgents ? ` · ${p.agentsRunning(runningAgents)}` : ''}
          </PeekRow>
        ) : null}
        {profile !== 'default' ? <PeekRow label={p.profile}>{profile}</PeekRow> : null}
        {sourceLabel ? <PeekRow label={p.source}>{sourceLabel}</PeekRow> : null}
        <PeekRow label={p.started}>{fmtDateTime.format(session.started_at * 1000)}</PeekRow>
        <PeekRow label={p.updated}>
          {formatMessageTimestamp(new Date((session.last_active || session.started_at) * 1000), t.assistant.thread)}
        </PeekRow>
      </div>
      <PeekActions onOpen={onOpen} runtimeId={null} sessionId={session.id} showApprove={false} showStop={false} />
    </div>
  )
}

function SessionPeekBody({ onOpen, session }: { onOpen?: () => void; session: SessionInfo }) {
  const summary = useStore(sessionLiveSummary(session.id))

  if (summary.group === 'done') {
    return <SessionPeekIdleBody onOpen={onOpen} session={session} />
  }

  return <SessionPeekLiveBody onOpen={onOpen} session={session} summary={summary} />
}

/**
 * SESSION PEEK — a dwell-triggered hovercard that shows a row's live context
 * (status, elapsed turn, current step, checklist, last tool) or, for idle
 * sessions, the full metadata without resuming the session. The inspect
 * gesture of the control surface: hover is an offer, never a navigation.
 *
 * The trigger is the row body, so every store subscription above mounts only
 * while a card is actually open (Radix lazy-mounts portal content) — hundreds
 * of rows cost zero listeners at rest. All data comes from stores the
 * sidebar already maintains; opening a peek fetches nothing.
 */
export function SessionPeek({
  children,
  onOpen,
  onOpenChange,
  session
}: {
  children: ReactNode
  /** The row's open/resume handler, wired to the card's Open button. */
  onOpen?: () => void
  onOpenChange?: (open: boolean) => void
  session: SessionInfo
}) {
  const container = usePopoverPortalContainer()

  return (
    <HoverCard.Root closeDelay={PEEK_CLOSE_DELAY_MS} onOpenChange={onOpenChange} openDelay={PEEK_OPEN_DELAY_MS}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal container={container}>
        <HoverCard.Content
          align="start"
          className={cn(
            'z-50 w-80 rounded-card border border-line bg-surface-raised p-3 shadow-e2 outline-none',
            '[transform-origin:var(--radix-hover-card-content-transform-origin)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--dur-fast) data-[state=open]:ease-out-quint',
            'data-[state=open]:motion-safe:zoom-in-97',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-(--dur-instant)'
          )}
          collisionPadding={8}
          side="right"
          sideOffset={8}
        >
          <SessionPeekBody onOpen={onOpen} session={session} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}
