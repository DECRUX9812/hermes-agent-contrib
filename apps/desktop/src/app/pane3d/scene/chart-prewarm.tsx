/**
 * The chart's shader pre-warm (architecture §8.4, §8.9).
 *
 * A chart presented for the first time would otherwise link its material
 * programs on the renderer's main thread — a visible hitch right at the moment
 * the bars are rising. `scene/shader-prewarm.tsx` mounts this static copy
 * off-screen with the pane's avatars, so the same programs are already linked
 * (and kept) before any chart is ever presented. It is never animated and never
 * drawn again; the refs it fills are throwaway.
 */

import type { AvatarPalette } from '../avatars/types'
import type { ChartSpec } from '../protocol'

import { ChartBoard, type ChartRefs } from './chart-board'
import { CHART_BOARD_HEIGHT } from './chart-layout'
import { scaleBarHeights } from './chart-scale'

/** Any three points will do: the material programs do not depend on the data. */
const PREWARM_SPEC: ChartSpec = {
  series: [
    { label: 'A', value: 1 },
    { label: 'B', value: 2 },
    { label: 'C', value: 1.5 }
  ],
  title: ''
}

const PREWARM_PALETTE: AvatarPalette = { accent: '#ff8fc8', glow: '#ffc6e8', ink: '#2a1740', primary: '#e9d5ff' }
const PREWARM_REFS: ChartRefs = { bars: [], board: null, grid: null, plinth: null }

const PREWARM_HEIGHTS = scaleBarHeights(
  PREWARM_SPEC.series.map(point => point.value),
  CHART_BOARD_HEIGHT
)

export function ChartPrewarm() {
  return (
    <ChartBoard
      barHeights={PREWARM_HEIGHTS}
      boardHeight={CHART_BOARD_HEIGHT}
      palette={PREWARM_PALETTE}
      refs={PREWARM_REFS}
      spec={PREWARM_SPEC}
    />
  )
}
