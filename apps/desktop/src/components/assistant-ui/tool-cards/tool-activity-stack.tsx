import { type JSX, memo, type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { formatToolRunDuration, summarizeToolRun, type ToolRunSummary } from './model'
import { ToolStepPill } from './tool-step-pill'
import type { ToolCardGroup, ToolCardView } from './types'

type ActivityRow =
  | { card: ToolCardView; key: string; kind: 'step' }
  | { key: string; kind: 'summary'; summary: ToolRunSummary }

function activityRows(steps: readonly ToolCardView[], live: boolean, expanded: boolean): ActivityRow[] {
  const rows: ActivityRow[] = []
  let completed: ToolCardView[] = []

  const flush = () => {
    const summary = summarizeToolRun(completed, live)

    if (summary) {
      rows.push({ key: completed.at(0)?.id ?? 'run', kind: 'summary', summary })

      if (expanded) {
        rows.push(...completed.map(card => ({ card, key: card.id, kind: 'step' as const })))
      }
    } else {
      rows.push(...completed.map(card => ({ card, key: card.id, kind: 'step' as const })))
    }

    completed = []
  }

  for (const card of steps) {
    if (card.state === 'done' && !card.interrupted) {
      completed.push(card)

      continue
    }

    flush()
    rows.push({ card, key: card.id, kind: 'step' })
  }

  flush()

  return rows
}

export interface ToolActivityStackProps {
  groups: readonly ToolCardGroup[]
  /** The bot doing the work (group rooms): a small face drawn on each card's icon tile. */
  actor?: ReactNode
  /** A turn remains live until its assistant message completes, even between tool calls. */
  live?: boolean
  /** Runtime session owning these tool calls (group-room members can differ from the visible chat). */
  sessionId?: string
  /** Shown as a Review button on a card waiting for approval. */
  onReviewApproval?: () => void
  className?: string
}

/** Live tool activity cards, inline in the chat. Renders nothing when there
 *  is nothing to show. Groups stay keyed by their stable key so a group that
 *  grows or settles keeps its DOM node and animates instead of remounting. */
function ToolActivityStackImpl({
  actor,
  className,
  groups,
  live: suppliedLive,
  onReviewApproval,
  sessionId
}: ToolActivityStackProps): JSX.Element | null {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)

  if (groups.length === 0) {
    return null
  }

  const live = suppliedLive ?? groups.some(group => group.state === 'approval' || group.state === 'running')

  const steps = groups
    .flatMap(group => group.cards)
    .map(card =>
      !live && card.state === 'running' && card.step.result === undefined && card.completedAt === undefined
        ? { ...card, interrupted: true, state: 'done' as const, status: t.assistant.toolCards.stopped }
        : card
    )

  const rows = activityRows(steps, live, expanded)
  const folded = !expanded && rows.some(row => row.kind === 'summary')

  return (
    <div
      aria-label={t.assistant.toolCards.activityLabel}
      className={cn('flex min-w-0 max-w-full flex-col gap-1', className)}
      data-slot="tool-activity-stack"
      data-tool-stack-folded={folded ? '' : undefined}
      role="list"
      style={{ overflowAnchor: 'auto' }}
    >
      {rows.map(row =>
        row.kind === 'summary' ? (
          <button
            aria-expanded={expanded}
            aria-label={t.assistant.toolCards.usedTools(row.summary.count)}
            className="flex min-h-7 min-w-0 max-w-full items-center gap-1.5 rounded-row px-2 text-left text-ui-xs text-fg-muted hover:bg-hover focus-ring"
            data-tool-run-anchor=""
            key={`run:${row.key}`}
            onClick={() => setExpanded(value => !value)}
            type="button"
          >
            <Codicon className="shrink-0 text-success" name="check" size={12} />
            <span className="truncate">{t.assistant.toolCards.usedTools(row.summary.count)}</span>
            {row.summary.durationMs !== undefined ? (
              <>
                <span aria-hidden className="text-fg-subtle">·</span>
                <span className="shrink-0 font-mono tabular-nums text-fg-subtle">
                  {formatToolRunDuration(row.summary.durationMs)}
                </span>
              </>
            ) : null}
            <Codicon
              className="ml-auto shrink-0 text-fg-subtle"
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={12}
            />
          </button>
        ) : (
          <StepRow
            actor={actor}
            card={row.card}
            key={row.key}
            onReviewApproval={
              groups.find(group => group.cards.includes(row.card))?.state === 'approval' ? onReviewApproval : undefined
            }
            sessionId={sessionId}
          />
        )
      )}
    </div>
  )
}

function StepRow({
  actor,
  card,
  onReviewApproval,
  sessionId
}: {
  actor?: ReactNode
  card: ToolCardView
  onReviewApproval?: () => void
  sessionId?: string
}) {
  const { t } = useI18n()

  return (
    <div className="flex min-w-0 max-w-full items-center gap-1">
      <ToolStepPill actor={actor} card={card} sessionId={sessionId} />
      {card.state === 'approval' && onReviewApproval ? (
        <Button onClick={onReviewApproval} size="xs" variant="outline">
          {t.assistant.toolCards.reviewApproval}
        </Button>
      ) : null}
    </div>
  )
}

export const ToolActivityStack = memo(ToolActivityStackImpl)
