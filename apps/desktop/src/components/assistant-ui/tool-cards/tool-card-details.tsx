import { cn } from '@/lib/utils'

import { CardBlock } from './tool-card-block'
import { BrowserSteps } from './tool-card-steps'
import type { ToolCardGroup } from './types'

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
          {group.family === 'browser' ? (
            <BrowserSteps group={group} />
          ) : (
            group.cards.map(card => <CardBlock card={card} key={card.id} showStatus={multi} />)
          )}
        </div>
      </div>
    </div>
  )
}
