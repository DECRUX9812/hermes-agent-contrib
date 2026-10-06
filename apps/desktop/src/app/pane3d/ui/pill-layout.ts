/**
 * Pure placement for the working task pill (architecture §8.8).
 *
 * The composer collapses into this compact pill UNDER its avatar, so the pill is
 * centred on the avatar's projected rect rather than fitted beside it like a
 * card. It still may not leave the pane and may not cover a reserved avatar box,
 * so the vertical position is cleared with the same helpers the cards use.
 */

import type { ScreenRect } from '../protocol'

import { CARD_MARGIN, type CardBox, type CardSize, clamp, clearVertical, withinBounds } from './card-geometry'

/** A little tighter than the card gap: the pill belongs to its avatar. */
export const PILL_GAP = 10

export type PillSide = 'below' | 'above'

export interface PillPlacement {
  left: number
  top: number
  side: PillSide
}

export function pillLayout(
  avatar: ScreenRect,
  pill: CardSize,
  viewport: CardSize,
  gap: number = PILL_GAP,
  margin: number = CARD_MARGIN,
  obstacles: readonly CardBox[] = []
): PillPlacement {
  const left = clamp(
    avatar.x + avatar.width / 2 - pill.width / 2,
    margin,
    Math.max(margin, viewport.width - pill.width - margin)
  )

  const below = avatar.y + avatar.height + gap
  const above = avatar.y - pill.height - gap
  const fitsBelow = withinBounds(below, pill.height, viewport, margin)
  const order: PillSide[] = fitsBelow ? ['below', 'above'] : ['above', 'below']

  for (const side of order) {
    const desired = side === 'below' ? below : above

    const cleared = clearVertical(
      { height: pill.height, width: pill.width, x: left, y: desired },
      obstacles,
      gap,
      side === 'below' ? 'down' : 'up'
    )

    if (withinBounds(cleared, pill.height, viewport, margin)) {
      return { left, side, top: cleared }
    }
  }

  // Every band is taken: keep the preferred side and stay inside the pane.
  const side: PillSide = fitsBelow ? 'below' : 'above'
  const desired = side === 'below' ? below : above

  return {
    left,
    side,
    top: clamp(desired, margin, Math.max(margin, viewport.height - pill.height - margin))
  }
}
