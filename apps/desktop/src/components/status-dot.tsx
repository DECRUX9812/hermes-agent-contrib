import type { ComponentProps } from 'react'
import { memo } from 'react'

import { cn } from '@/lib/utils'

export type StatusState = 'running' | 'queued' | 'needs-approval' | 'done' | 'error'

const STATE_CLASS: Record<StatusState, string> = {
  running: 'bg-brand',
  queued: 'bg-fg-subtle',
  'needs-approval': 'bg-warning',
  done: 'bg-success',
  error: 'bg-danger'
}

interface StatusBadgeProps extends ComponentProps<'span'> {
  state: StatusState
}

/** Shared five-state status mark. A supplied aria-label makes the mark
 *  announce itself; otherwise the surrounding row provides its label. */
export const StatusBadge = memo(function StatusBadge({
  'aria-label': ariaLabel,
  className,
  state,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      className={cn('inline-block size-1.5 shrink-0 rounded-full', STATE_CLASS[state], className)}
      data-status={state}
      role={ariaLabel ? 'img' : undefined}
      {...props}
    />
  )
})
