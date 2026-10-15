import type { ComponentProps } from 'react'
import { memo } from 'react'

import { cn } from '@/lib/utils'

export type StatusTone = 'good' | 'muted' | 'warn' | 'bad'

const TONE_BG: Record<StatusTone, string> = {
  good: 'bg-primary',
  muted: 'bg-muted-foreground/40',
  warn: 'bg-amber-500',
  bad: 'bg-destructive'
}

interface StatusDotProps extends ComponentProps<'span'> {
  tone: StatusTone
}

export const StatusDot = memo(function StatusDot({ className, tone, ...props }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-1.5 rounded-full', TONE_BG[tone], className)}
      {...props}
    />
  )
})

export type StatusState = 'running' | 'queued' | 'needs-approval' | 'done' | 'error'

const STATE_CLASS: Record<StatusState, string> = {
  running: 'bg-primary',
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
