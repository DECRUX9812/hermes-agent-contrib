import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { BrowserSteps } from './tool-card-steps'
import type { ToolCardGroup, ToolCardView } from './types'

function CardBlock({ card, showStatus }: { card: ToolCardView; showStatus: boolean }) {
  const { t } = useI18n()
  const copy = t.assistant.toolCards

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showStatus ? <div className="truncate text-ui-xs text-fg-muted">{card.status}</div> : null}
      {card.args.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-ui-2xs text-fg-subtle">{copy.details.request}</div>
          {card.args.map(detail => (
            <div className="flex min-w-0 gap-2" key={detail.label}>
              <span className="w-16 shrink-0 text-fg-subtle">{detail.label}</span>
              <span className="min-w-0 flex-1 break-words font-mono text-ui-2xs text-fg-secondary line-clamp-3">
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="text-ui-2xs text-fg-subtle">{copy.details.output}</div>
      {card.output ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-surface-sunken p-2 font-mono text-ui-2xs text-fg-secondary">
          {card.output}
        </pre>
      ) : (
        <div className="text-ui-2xs text-fg-subtle">{copy.details.noOutput}</div>
      )}
      {card.reason ? <div className="text-ui-xs text-danger">{card.reason}</div> : null}
      {card.durationLabel ? (
        <div className="text-ui-2xs text-fg-subtle">
          {copy.details.duration} <span className="tabular-nums">{card.durationLabel}</span>
        </div>
      ) : null}
    </div>
  )
}

/** The expandable panel under a card row. Mounted on first open and kept so
 *  closing never drops a loaded screenshot. */
export function ToolCardDetails({
  group,
  live,
  open
}: {
  group: ToolCardGroup
  live: boolean
  open: boolean
}) {
  const multi = group.cards.length > 1

  return (
    <div className="motion-collapse" data-open={open}>
      <div>
        <div className={cn('flex min-w-0 flex-col gap-2 pt-1 pr-1 pb-1 text-ui-xs', live ? 'pl-12' : 'pl-6')}>
          {group.family === 'browser' ? <BrowserSteps group={group} /> : null}
          {group.cards.map(card => (
            <CardBlock card={card} key={card.id} showStatus={multi} />
          ))}
        </div>
      </div>
    </div>
  )
}
