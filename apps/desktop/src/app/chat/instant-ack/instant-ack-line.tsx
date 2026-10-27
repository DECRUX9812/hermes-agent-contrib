import type { FC } from 'react'

import { SCAFFOLD_LABEL_CLASS } from '@/components/chat/scaffold-row'
import { StatusPulse } from '@/components/ui/status-pulse'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import type { InstantAck } from './state'

/**
 * One scaffold line above the composer, in the same visual language as the
 * transcript's own status row — a quiet pulse and a sentence, no badge.
 *
 * `data-slot` is the contract the latency probe measures against: the row
 * existing means the app has said something, and `data-ack-state` says what it
 * is claiming. A hand-off unmounts the row, so nothing lingers that reads as
 * progress after the turn has moved on.
 */
export const InstantAckLineView: FC<{ ack: InstantAck; className?: string }> = ({ ack, className }) => {
  const { t } = useI18n()
  const copy = t.assistant.thread

  const label =
    ack.state === 'receipt'
      ? ack.detail.startsWith('/')
        ? copy.instantAckCommand(ack.detail)
        : copy.instantAckPrompt(ack.detail)
      : ack.state === 'working'
        ? ack.detail
        : ack.state === 'approval'
          ? copy.instantAckApproval
          : copy.instantAckWaiting

  return (
    <div
      aria-label={label}
      aria-live="polite"
      className={cn(
        'flex min-w-0 max-w-full items-center gap-1.5 self-start px-1 leading-(--conversation-line-height)',
        'text-(--conversation-scaffold-text)',
        className
      )}
      data-ack-state={ack.state}
      data-conversation-scaffold=""
      data-slot="instant-ack"
      role="status"
    >
      <StatusPulse
        aria-hidden="true"
        className="dither inline-block size-3 shrink-0 rounded-[2px] text-midground/80"
        kind="opacity"
      />
      <span className={cn(SCAFFOLD_LABEL_CLASS, 'min-w-0 truncate')}>{label}</span>
    </div>
  )
}
