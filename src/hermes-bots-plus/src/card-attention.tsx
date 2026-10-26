import { Codicon, Tip } from '@hermes/plugin-sdk'

import { botAttentionHint } from './data'
import { useBots } from './i18n'

/** One attention treatment shared by the card's compact identity line. */
export function CardAttention({ count, reason }: { count: number; reason?: null | string }) {
  const b = useBots()

  if (count <= 0) {
    return null
  }

  return (
    <Tip label={reason ? botAttentionHint(reason) : b.roster.attentionItems(count)}>
      <span
        aria-label={b.roster.needsAttention}
        className="flex shrink-0 items-center gap-0.5 text-[0.6875rem] font-medium tabular-nums text-amber-600 dark:text-amber-300"
      >
        <Codicon name="warning" />
        {count}
      </span>
    </Tip>
  )
}
