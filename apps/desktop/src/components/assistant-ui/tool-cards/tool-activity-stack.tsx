import { type JSX, memo, type ReactNode } from 'react'

import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { ToolCard } from './tool-card'
import type { ToolCardGroup } from './types'

export interface ToolActivityStackProps {
  groups: readonly ToolCardGroup[]
  /** The bot doing the work (group rooms): a small face drawn on each card's icon tile. */
  actor?: ReactNode
  /** Shown as a Review button on a card waiting for approval. */
  onReviewApproval?: () => void
  className?: string
}

/** Live tool activity cards, inline in the chat. Renders nothing when there
 *  is nothing to show. Groups stay keyed by their stable key so a group that
 *  grows or settles keeps its DOM node and animates instead of remounting. */
function ToolActivityStackImpl({ actor, className, groups, onReviewApproval }: ToolActivityStackProps): JSX.Element | null {
  const { t } = useI18n()

  if (groups.length === 0) {
    return null
  }

  return (
    <div
      aria-label={t.assistant.toolCards.activityLabel}
      className={cn('flex min-w-0 max-w-full flex-col gap-1.5', className)}
      data-slot="tool-activity-stack"
      role="list"
    >
      {groups.map(group => (
        <ToolCard actor={actor} group={group} key={group.key} onReviewApproval={onReviewApproval} />
      ))}
    </div>
  )
}

export const ToolActivityStack = memo(ToolActivityStackImpl)
