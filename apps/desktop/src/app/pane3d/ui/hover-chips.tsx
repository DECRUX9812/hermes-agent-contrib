import { Button } from '@/components/ui/button'

import { PANE_COPY } from '../copy'

export interface HoverChipsProps {
  onAsk: () => void
  onHide: () => void
}

/** The two chips over a hovered avatar (architecture §Milestone 1). */
export function HoverChips({ onAsk, onHide }: HoverChipsProps) {
  return (
    <div
      className="pointer-events-auto absolute bottom-[calc(100%+8px)] left-1/2 flex -translate-x-1/2 gap-1"
      data-pane-hit
    >
      <Button data-pane-hit onClick={onAsk} size="xs" type="button" variant="floating">
        {PANE_COPY.ask}
      </Button>
      <Button data-pane-hit onClick={onHide} size="xs" type="button" variant="floating">
        {PANE_COPY.hide}
      </Button>
    </div>
  )
}
