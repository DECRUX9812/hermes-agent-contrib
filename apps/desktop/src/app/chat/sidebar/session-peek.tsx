import { compactNumber } from '@hermes/shared'
import { HoverCard } from 'radix-ui'
import type * as React from 'react'

import { PrTag } from '@/app/chat/pr-tag'
import { sessionDotClassName } from '@/app/chat/session-status-dot'
import { formatMessageTimestamp } from '@/components/assistant-ui/thread/timestamp'
import { usePopoverPortalContainer } from '@/components/ui/dialog-portal-context'
import { menuMotionClass } from '@/components/ui/menu'
import type { SessionInfo } from '@/hermes'
import { type Translations, useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { displayPath } from '@/lib/display-path'
import { displayModelName } from '@/lib/model-status-label'
import { sessionProjectLabel } from '@/lib/session-project-label'
import { handoffOriginSource, sessionSourceLabel } from '@/lib/session-source'
import { fmtDateTime } from '@/lib/time'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { normalizeProfileKey } from '@/store/profile'
import { $projects } from '@/store/projects'
import { $pullRequestsByBranch, sessionPrKey } from '@/store/pull-requests'
import { sessionColorFor } from '@/store/session-color'
import { $sessionDotStateById, type SessionDotState } from '@/store/session-dot-state'
import { sessionCostUsd } from '@/store/sidebar-archive'
import { $subagentsBySession } from '@/store/subagents'

/** Deliberate-dwell delay: longer than `OverflowTip`'s 600ms so the row's own
 *  tips answer a casual lingering hover first — the peek only claims a cursor
 *  that stays put past them. The card is an inspection gesture, not a reflex. */
const PEEK_OPEN_DELAY_MS = 800
const PEEK_CLOSE_DELAY_MS = 150

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

function PeekRow({ children, label, wrap }: { children: React.ReactNode; label: string; wrap?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-14 shrink-0 text-[0.625rem] leading-4 text-(--ui-text-quaternary)">{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 text-[0.6875rem] leading-4 text-(--ui-text-tertiary)',
          wrap ? 'break-words' : 'truncate'
        )}
      >
        {children}
      </span>
    </div>
  )
}

function SessionPeekBody({ session }: { session: SessionInfo }) {
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
        <span className="text-[0.625rem] font-medium text-(--ui-text-tertiary)">{STATE_LABEL[dotState](r, p)}</span>
        {session.archived ? <span className="text-[0.625rem] text-(--ui-text-quaternary)">· {p.archived}</span> : null}
      </div>
      <p className="line-clamp-2 min-w-0 break-words text-[0.8125rem] font-medium leading-snug text-(--ui-text-primary)">
        {title}
      </p>
      {session.preview ? (
        <p className="line-clamp-3 min-w-0 break-words text-[0.6875rem] leading-snug text-(--ui-text-quaternary)">
          {session.preview}
        </p>
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
        {stats.length ? (
          <PeekRow label={p.stats} wrap>
            {stats.join(' · ')}
          </PeekRow>
        ) : null}
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
    </div>
  )
}

/**
 * SESSION PEEK — a dwell-triggered hovercard that shows a row's full context
 * (status, workspace, branch + PR, model, size, delegated agents, timestamps)
 * without resuming the session. The inspect gesture of the control surface:
 * hover is an offer, never a navigation.
 *
 * The trigger is the row body, so every store subscription above mounts only
 * while a card is actually open (Radix lazy-mounts portal content) — hundreds
 * of rows cost zero listeners at rest. All data comes from stores the
 * sidebar already maintains; opening a peek fetches nothing.
 */
export function SessionPeek({
  children,
  onOpenChange,
  session
}: {
  children: React.ReactNode
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
            'z-50 w-72 origin-(--radix-hover-card-content-transform-origin) rounded-lg border border-(--ui-stroke-secondary) bg-(--popover-surface) p-3 outline-hidden backdrop-blur-md [--popover-surface:color-mix(in_srgb,var(--ui-bg-elevated)_92%,transparent)]',
            menuMotionClass
          )}
          collisionPadding={8}
          side="right"
          sideOffset={8}
        >
          <SessionPeekBody session={session} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  )
}
