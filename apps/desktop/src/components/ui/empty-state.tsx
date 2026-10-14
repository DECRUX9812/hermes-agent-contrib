import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'

// Canonical centered empty state: a 32px muted icon tile over a compact
// title + description and one optional action. The default for "no results /
// nothing here yet" page bodies. For richer master-detail lists that want an
// icon + action, use PanelEmpty (overlays/panel); the file-tree's inline
// uppercase error state is its own deliberately-distinct treatment.
export function EmptyState({
  action,
  description,
  icon = 'inbox',
  title,
  className
}: {
  /** Single follow-up rendered as a secondary Button (label + onClick). */
  action?: { label: ReactNode; onClick: () => void }
  description?: ReactNode
  /** Codicon glyph for the muted tile. Defaults to the inbox mark. */
  icon?: string
  title: ReactNode
  className?: string
}) {
  return (
    <div className={cn('animate-enter grid min-h-48 place-items-center text-center', className)}>
      <div className="grid justify-items-center gap-2">
        <span className="grid size-8 place-items-center rounded-card bg-surface-sunken text-fg-muted">
          <Codicon name={icon} size="1.125rem" />
        </span>
        {typeof title === 'string' ? (
          <div className="text-ui-sm font-medium text-fg">{title}</div>
        ) : (
          title
        )}
        {description ? (
          typeof description === 'string' ? (
            <div className="max-w-xs text-ui-xs text-fg-muted">{description}</div>
          ) : (
            description
          )
        ) : null}
        {action ? (
          <Button onClick={action.onClick} variant="secondary">
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
