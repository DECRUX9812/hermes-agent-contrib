import { type ReactNode, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { LogView } from '@/components/ui/log-view'
import { AlertTriangle } from '@/lib/icons'
import { cn } from '@/lib/utils'

// The single canonical error glyph (codicon's filled error mark). Use this
// everywhere an error is surfaced (boundaries, dialogs, banners) so failures
// read identically — one icon, one color, no background chip.
export function ErrorIcon({ className, size = '1.75rem' }: { className?: string; size?: string }) {
  return <Codicon className={cn('text-danger', className)} name="error" size={size} />
}

// Inline error banner for detail panes (born in Messaging's platform error,
// now shared with the MCP config pane): warn glyph + tinted rounded box.
// For centered full-surface failures use ErrorState below instead.
export function ErrorBanner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-card border border-danger/30 bg-danger/10 px-3 py-2 text-ui-xs leading-(--conversation-caption-line-height) text-danger',
        className
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 whitespace-pre-wrap break-words">{children}</span>
    </div>
  )
}

export interface ErrorStateAction {
  label: ReactNode
  onClick: () => void
  disabled?: boolean
}

export interface ErrorStateProps {
  /** Optional actions row rendered below the copy (legacy callers pass Buttons). */
  children?: ReactNode
  className?: string
  description?: ReactNode
  /** Defaults to the danger tile below. */
  icon?: ReactNode
  title: ReactNode
  /** The single primary recovery action (Retry, Restart Hermes…). */
  primaryAction?: ErrorStateAction
  /** Quieter follow-ups (Open logs, Gateway settings…) as ghost buttons. */
  secondaryActions?: ErrorStateAction[]
  /** Raw cause output — rendered in a LogView behind the disclosure. */
  details?: ReactNode
  detailsLabel?: string
  hideDetailsLabel?: string
}

// THE recoverable-error card: a danger tile over a compact title + body, one
// primary Button, ghost secondaries, and an optional "Show details"
// disclosure for the raw cause. Used by the boot-failure overlay, the route
// error boundary and every error card so all failures read the same.
// Title/description accept nodes so Radix Dialog callers can pass
// DialogTitle/DialogDescription for accessibility.
export function ErrorState({
  children,
  className,
  description,
  details,
  detailsLabel = 'Show details',
  hideDetailsLabel = 'Hide details',
  icon,
  primaryAction,
  secondaryActions,
  title
}: ErrorStateProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <div className={cn('grid justify-items-center gap-2 text-center', className)}>
      {icon ?? (
        <span className="grid size-7 place-items-center rounded-control bg-danger/10 text-danger">
          <Codicon name="error" size="1rem" />
        </span>
      )}

      {typeof title === 'string' ? <h2 className="text-ui-sm font-semibold">{title}</h2> : title}

      {typeof description === 'string' ? (
        <p className="max-w-prose text-ui-sm text-fg-muted">{description}</p>
      ) : (
        description
      )}

      {primaryAction || (secondaryActions && secondaryActions.length > 0) || children ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {primaryAction ? (
            <Button disabled={primaryAction.disabled} onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          ) : null}
          {secondaryActions?.map((action, index) => (
            <Button disabled={action.disabled} key={index} onClick={action.onClick} variant="ghost">
              {action.label}
            </Button>
          ))}
          {children}
        </div>
      ) : null}

      {details ? (
        <details className="w-full text-left" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer select-none text-center text-ui-xs text-fg-muted">
            {detailsOpen ? hideDetailsLabel : detailsLabel}
          </summary>
          <LogView className="mt-1 max-h-32">{details}</LogView>
        </details>
      ) : null}
    </div>
  )
}
