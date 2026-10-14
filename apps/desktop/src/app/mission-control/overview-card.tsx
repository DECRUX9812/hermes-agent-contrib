import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { sessionDotClassName } from '@/app/chat/session-status-dot'
import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { useI18n } from '@/i18n'
import { formatElapsedClock } from '@/lib/time'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { respondToApprovalAction } from '@/store/native-notifications'
import { $approvalRequests } from '@/store/prompts'
import { $sessionDigestById } from '@/store/session-digest'
import { sessionLiveSummary } from '@/store/session-live'
import { openSessionTile } from '@/store/session-states-tiles'
import { sessionTileDelegate } from '@/store/session-states-tiles-core'

import type { OverviewCardData } from './types'

/** Stagger step per card, capped so a full grid settles fast. */
const ENTER_STAGGER_MS = 20
const ENTER_STAGGER_CAP_MS = 200

export function OverviewCard({
  card,
  index,
  onOpen,
  onStop
}: {
  card: OverviewCardData
  index: number
  onOpen: (storedSessionId: string) => void
  onStop?: (runtimeId: string) => Promise<void>
}) {
  const { t } = useI18n()
  const p = t.sidebar.peek

  const summary = useStore(sessionLiveSummary(card.storedSessionId))
  const digest = useStoreSelector($sessionDigestById, digests => digests[card.storedSessionId])

  const approval = useStoreSelector($approvalRequests, all =>
    summary.runtimeId ? all[summary.runtimeId] : undefined
  )

  const elapsed = useElapsedSeconds(summary.turnStartedAt != null, undefined, summary.turnStartedAt ?? undefined)

  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<null | string>(null)

  const live = summary.group !== 'done'
  const runtimeId = summary.runtimeId

  const toolLine = summary.tool
    ? summary.tool.target
      ? `${summary.tool.name} · ${summary.tool.target}`
      : summary.tool.name
    : null

  const handleStop = async () => {
    if (!runtimeId || stopping) {
      return
    }

    setStopping(true)
    setStopError(null)

    try {
      if (onStop) {
        await onStop(runtimeId)
      } else {
        await sessionTileDelegate()?.interruptSession(runtimeId)
      }
    } catch (error) {
      setStopError(error instanceof Error ? error.message : p.stopFailed)
      setStopping(false)
    }
  }

  return (
    <div
      className={cn(
        'rounded-card bg-surface-raised p-3 shadow-e1 focus-ring motion-safe:animate-enter',
        !live && 'text-fg-muted'
      )}
      data-overview-card={card.storedSessionId}
      onKeyDown={event => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          onOpen(card.storedSessionId)
        }
      }}
      style={{ animationDelay: `${Math.min(index * ENTER_STAGGER_MS, ENTER_STAGGER_CAP_MS)}ms` }}
      tabIndex={0}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          {live ? (
            <span aria-hidden="true" className={sessionDotClassName(summary.dotState)} />
          ) : (
            <Codicon className="shrink-0 text-success" name="check" size="0.75rem" />
          )}
          <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-fg">{card.title}</span>
          {live && summary.turnStartedAt != null ? (
            <span className="shrink-0 text-ui-2xs text-fg-muted tabular-nums">{formatElapsedClock(elapsed)}</span>
          ) : null}
        </div>
        {digest ? (
          <p className="line-clamp-2 min-w-0 break-words text-ui-xs leading-snug text-fg-secondary">{digest}</p>
        ) : null}
        {summary.todoTotal > 0 ? (
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 min-w-0 flex-1 rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.round((summary.todoDone / summary.todoTotal) * 100)}%` }}
              />
            </div>
            <span className="shrink-0 text-ui-2xs text-fg-muted tabular-nums">
              {p.planFraction(summary.todoDone, summary.todoTotal)}
            </span>
          </div>
        ) : null}
        {live && toolLine ? (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-ui-2xs text-fg-muted">{p.lastTool}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-ui-2xs text-fg-muted">{toolLine}</span>
            {summary.tool?.status === 'running' ? <GlyphSpinner className="size-3 shrink-0" /> : null}
            {summary.tool?.status === 'error' ? (
              <Codicon className="shrink-0 text-danger" name="error" size="0.75rem" />
            ) : null}
          </div>
        ) : null}
        <div className="mt-0.5 flex items-center gap-1.5">
          <Button onClick={() => onOpen(card.storedSessionId)} size="xs" variant="secondary">
            {t.common.open}
          </Button>
          <Button onClick={() => openSessionTile(card.storedSessionId, 'right')} size="xs" variant="ghost">
            <Codicon name="split-horizontal" />
            {t.sidebar.row.openInSplit}
          </Button>
          <span className="flex-1" />
          {summary.group === 'working' && runtimeId ? (
            <Button disabled={stopping} onClick={handleStop} size="xs" variant="ghost">
              <Codicon name="debug-stop" />
              {t.composer.stop}
            </Button>
          ) : null}
          {approval !== undefined && runtimeId ? (
            <Button onClick={() => void respondToApprovalAction(runtimeId, 'approve')} size="xs" variant="default">
              {t.common.approve}
            </Button>
          ) : null}
        </div>
        {stopError ? <p className="text-ui-2xs text-danger">{stopError}</p> : null}
      </div>
    </div>
  )
}
