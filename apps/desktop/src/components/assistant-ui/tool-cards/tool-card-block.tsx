import { useI18n } from '@/i18n'

import type { ToolCardView } from './types'

/** One call's request, output, error and duration inside an expanded card. */
export function CardBlock({ card, showStatus }: { card: ToolCardView; showStatus: boolean }) {
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
