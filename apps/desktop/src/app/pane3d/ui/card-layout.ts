import type { ScreenRect } from '../protocol'

import {
  bestVertical,
  betterFit,
  boxesOverlap,
  CARD_GAP,
  CARD_MARGIN,
  type CardBox,
  type CardSize,
  clamp,
  clearVertical,
  fitExpanded,
  totalOverlap,
  withinBounds
} from './card-geometry'

export type CardSide = 'left' | 'right'

export interface CardLayout {
  left: number
  top: number
  /** Which side of the avatar the card sits on. */
  side: CardSide
  /** The transform origin nearest the avatar, so the card unfolds toward it. */
  originX: CardSide
}

/**
 * Where a notification card sits for an avatar's projected rect: BESIDE it
 * (never over it) on the side with more room, clamped fully inside the pane
 * (architecture §8.5, VAL-NOTIFY-007).
 *
 * `obstacles` are the OTHER visible avatars' projected rects. With 3+ avatars a
 * card placed on the roomier side can land over a neighbour's face, so the side
 * choice prefers one that is clear of every obstacle, and a side that is blocked
 * has the card pushed clear vertically instead (flip side or push down, staying
 * inside the pane).
 *
 * Pure so the placement contract is unit-tested; the card's frame loop feeds it
 * the live avatar rect, which is what makes the card follow its avatar when the
 * anchor moves.
 */
export function cardLayout(
  avatar: ScreenRect,
  card: CardSize,
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN,
  obstacles: readonly CardBox[] = []
): CardLayout {
  const spaceRight = viewport.width - (avatar.x + avatar.width)
  const spaceLeft = avatar.x
  const preference: CardSide[] = spaceRight >= spaceLeft ? ['right', 'left'] : ['left', 'right']

  const boxFor = (side: CardSide): CardBox => {
    const left = side === 'right' ? avatar.x + avatar.width + gap : avatar.x - card.width - gap

    return {
      height: card.height,
      width: card.width,
      x: clamp(left, margin, Math.max(margin, viewport.width - card.width - margin)),
      y: clamp(
        avatar.y + avatar.height / 2 - card.height / 2,
        margin,
        Math.max(margin, viewport.height - card.height - margin)
      )
    }
  }

  // Flip to the other side when the roomier one is occupied by a neighbour.
  const preferred =
    preference.find(candidate => !obstacles.some(box => boxesOverlap(boxFor(candidate), box, gap))) ?? preference[0]

  // Resolve vertically on the preferred side; if that still cannot clear every
  // obstacle, try the other side and take whichever placement is clearer.
  const choices = [preferred, ...preference.filter(side => side !== preferred)].map(side => {
    const box = boxFor(side)
    const top = bestVertical(box, obstacles, viewport, gap, margin)

    return { box, overlap: totalOverlap({ ...box, y: top }, obstacles, gap), side, top }
  })

  const chosen =
    choices[0].overlap <= 0.5
      ? choices[0]
      : (choices.find(choice => choice.overlap <= 0.5) ??
        choices.reduce((best, choice) => (choice.overlap < best.overlap ? choice : best)))

  return {
    left: chosen.box.x,
    originX: chosen.side === 'right' ? 'left' : 'right',
    side: chosen.side,
    top: chosen.top
  }
}

export interface ExpandedCardLayout extends CardLayout {
  /** Height cap for the card: the chosen clear band's height. The body scrolls past it. */
  maxHeight: number
  /** True when no clear band reached MIN_CARD_HEIGHT and least-overlap was used. */
  degenerate: boolean
}

/**
 * Where an expanded card sits: like `cardLayout` it hugs its avatar's side, but
 * it is placed in the best obstacle-free vertical band of that side (see
 * `freeVerticalBands`) and capped to it, so the scrollable body absorbs a long
 * host message instead of the card growing over a neighbouring avatar
 * (VAL-NOTIFY-007). Both sides are scored, and the side with the better band
 * wins; when neither side has a usable band the placement degrades to
 * least-overlap (documented on `fitExpanded`).
 *
 * Pure so the placement contract is unit-tested; the card's frame loop feeds it
 * the measured content height and the live avatar rects.
 */
export function expandedCardLayout(
  avatar: ScreenRect,
  card: CardSize,
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN,
  obstacles: readonly CardBox[] = []
): ExpandedCardLayout {
  const spaceRight = viewport.width - (avatar.x + avatar.width)
  const spaceLeft = avatar.x
  const preference: CardSide[] = spaceRight >= spaceLeft ? ['right', 'left'] : ['left', 'right']
  const desiredTop = avatar.y + avatar.height / 2 - card.height / 2

  const candidates = preference.map(side => {
    const raw = side === 'right' ? avatar.x + avatar.width + gap : avatar.x - card.width - gap
    const left = clamp(raw, margin, Math.max(margin, viewport.width - card.width - margin))

    return { fit: fitExpanded(left, card.width, desiredTop, card.height, obstacles, viewport, gap, margin), left, side }
  })

  const chosen = candidates.reduce((best, candidate) =>
    betterFit(candidate.fit, best.fit, card.height) ? candidate : best
  )

  return {
    degenerate: chosen.fit.degenerate,
    left: chosen.left,
    maxHeight: chosen.fit.maxHeight,
    originX: chosen.side === 'right' ? 'left' : 'right',
    side: chosen.side,
    top: chosen.fit.top
  }
}

/** A card box with the extra facts an expanded card carries into `stackCards`. */
export interface StackCardBox extends CardBox {
  /** Expanded cards are capped to a clear band instead of overflowing onto a neighbour. */
  expanded?: boolean
  /** The expanded content height; the card is capped to the chosen band. */
  naturalHeight?: number
}

export interface StackPlacement {
  x: number
  y: number
  /** Height cap for an expanded card's scrollable body. Absent for collapsed cards. */
  maxHeight?: number
}

/**
 * Keeps several open cards from covering each other — or a neighbouring
 * avatar. Each card is validated against every card already placed AND every
 * obstacle: the placement with the least overlap wins, so a card that would
 * otherwise be clamped onto a neighbour near the bottom edge stacks upward (or
 * into whatever clear band exists) instead. An expanded card additionally has
 * its cap re-derived against the cards already placed, so a long body shrinks
 * to a band that clears them (or its neighbours) rather than growing over them.
 * Horizontal position and the unfold origin are untouched — the card still sits
 * beside its own avatar, just higher or lower when that spot is taken.
 *
 * Pure and order-stable so the placement contract is unit-tested.
 */
export function stackCards(
  boxes: readonly StackCardBox[],
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN,
  obstacles: readonly CardBox[] = []
): StackPlacement[] {
  const placed: CardBox[] = [...obstacles]
  const out: StackPlacement[] = []

  for (const box of boxes) {
    if (box.expanded) {
      const natural = box.naturalHeight ?? box.height
      const fit = fitExpanded(box.x, box.width, box.y, natural, placed, viewport, gap, margin)

      placed.push({ height: fit.height, width: box.width, x: box.x, y: fit.top })
      out.push({ maxHeight: fit.maxHeight, x: box.x, y: fit.top })
    } else {
      const top = bestVertical(box, placed, viewport, gap, margin)

      placed.push({ ...box, y: top })
      out.push({ x: box.x, y: top })
    }
  }

  return out
}

export type BubblePlacement = 'above' | 'left' | 'right'

export interface BubbleLayout {
  left: number
  top: number
  placement: BubblePlacement
  /** Transform origin nearest the speaker, so the bubble unfolds toward it. */
  originX: CardSide
  originY: 'bottom' | 'center'
}

/**
 * Where a speech bubble sits for its speaker (architecture §8.6): above the
 * head, tail toward the speaker, and never over another avatar's body. When the
 * row is too close to the top of the pane for the bubble to clear its
 * neighbours, it flips to the speaker's side exactly like a card.
 */
export function bubbleLayout(
  speaker: ScreenRect,
  bubble: CardSize,
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN,
  obstacles: readonly CardBox[] = []
): BubbleLayout {
  const centerX = speaker.x + speaker.width / 2

  const above: CardBox = {
    height: bubble.height,
    width: bubble.width,
    x: clamp(centerX - bubble.width / 2, margin, Math.max(margin, viewport.width - bubble.width - margin)),
    y: speaker.y - bubble.height - gap
  }

  // Push the bubble up over any neighbour's head; if that leaves the pane, fall
  // back to the speaker's side rather than sitting on its own face.
  const y = clearVertical(above, obstacles, gap, 'up')
  const cleared = { ...above, y }

  if (withinBounds(y, bubble.height, viewport, margin) && !obstacles.some(box => boxesOverlap(cleared, box, gap))) {
    return { left: cleared.x, originX: 'left', originY: 'bottom', placement: 'above', top: y }
  }

  const beside = cardLayout(speaker, bubble, viewport, gap, margin, obstacles)

  return {
    left: beside.left,
    originX: beside.originX,
    originY: 'center',
    placement: beside.side,
    top: beside.top
  }
}
