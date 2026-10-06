import type { ScreenRect } from '../protocol'

import {
  betterCardFit,
  boxesOverlap,
  CARD_GAP,
  CARD_MARGIN,
  type CardBox,
  type CardFit,
  type CardSize,
  clamp,
  clearVertical,
  fitCardInColumn,
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

/** One card to place: its avatar, the width and natural height it wants, and whether it scrolls. */
export interface CardRequest {
  avatar: ScreenRect
  /** Card width and the natural (uncapped) height it wants. */
  card: CardSize
  /** An expanded card caps and scrolls in the chosen band; a collapsed card keeps its height. */
  expanded: boolean
}

export interface CardPlacement {
  left: number
  top: number
  side: CardSide
  /** The transform origin nearest the avatar, so the card unfolds toward it. */
  originX: CardSide
  /** Height cap for an expanded card's scrollable body; absent for collapsed cards. */
  maxHeight?: number
  /** True when no clear band reached the minimum and least-overlap inside the pane was used. */
  degenerate: boolean
}

interface SideFit {
  fit: CardFit
  left: number
  side: CardSide
}

/** The side with more room comes first; ties keep the card on the right. */
function sideOrder(avatar: ScreenRect, viewport: CardSize): [CardSide, CardSide] {
  const spaceRight = viewport.width - (avatar.x + avatar.width)
  const spaceLeft = avatar.x

  return spaceRight >= spaceLeft ? ['right', 'left'] : ['left', 'right']
}

/** Fit a card's column on one side against the current obstacle set. */
function fitSide(
  side: CardSide,
  request: CardRequest,
  obstacles: readonly CardBox[],
  viewport: CardSize,
  gap: number,
  margin: number
): SideFit {
  const { avatar, card } = request
  const raw = side === 'right' ? avatar.x + avatar.width + gap : avatar.x - card.width - gap
  const left = clamp(raw, margin, Math.max(margin, viewport.width - card.width - margin))
  // Both sides aim at the same avatar mid-line, so the side comparison is fair.
  const desiredTop = avatar.y + avatar.height / 2 - card.height / 2

  const fit = fitCardInColumn(
    left,
    card.width,
    card.height,
    desiredTop,
    obstacles,
    viewport,
    gap,
    margin,
    request.expanded
  )

  return { fit, left, side }
}

/**
 * The single placement algorithm for every notification card, collapsed or
 * expanded (architecture §8.5, VAL-NOTIFY-005/007). Cards are processed in the
 * given (DOM) order; each is fitted against the avatars plus every card already
 * placed this frame, so a card can never land on a neighbour and two expanded
 * cards can never share a column.
 *
 * For each card BOTH sides are scored against every obstacle-free vertical band
 * of that column (`freeVerticalBands`) and the better fit wins: a usable clear
 * band beats the degenerate fallback, showing the whole card beats scrolling,
 * the taller band beats a shorter one, and a tie goes to the side with more room
 * (`sideOrder`). Because the side is chosen HERE, a card whose preferred side is
 * taken by a card already placed moves to the clear band on the opposite side
 * instead of overlapping (the round-3 scrutiny defect in `stackCards`).
 *
 * Only when neither side has a usable band does the card fall back to the
 * least-overlap position inside the pane; it may then cover an obstacle, but it
 * never leaves the pane. The returned `left`/`top`/`maxHeight` are final: the
 * caller applies them without a second placement pass.
 */
export function placeCards(
  requests: readonly CardRequest[],
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN,
  obstacles: readonly CardBox[] = []
): CardPlacement[] {
  const placed: CardBox[] = [...obstacles]
  const out: CardPlacement[] = []

  for (const request of requests) {
    const [first, second] = sideOrder(request.avatar, viewport)
    const preferred = fitSide(first, request, placed, viewport, gap, margin)
    const other = fitSide(second, request, placed, viewport, gap, margin)
    // `betterCardFit` is strict, so an equal fit keeps the roomier side (first).
    const chosen = betterCardFit(other.fit, preferred.fit, request.card.height) ? other : preferred

    // Later cards see this one exactly as it renders: a capped expanded card
    // occupies its band, not its uncapped natural height.
    placed.push({ height: chosen.fit.height, width: request.card.width, x: chosen.left, y: chosen.fit.top })
    out.push({
      degenerate: chosen.fit.degenerate,
      left: chosen.left,
      maxHeight: request.expanded ? chosen.fit.maxHeight : undefined,
      originX: chosen.side === 'right' ? 'left' : 'right',
      side: chosen.side,
      top: chosen.fit.top
    })
  }

  return out
}

function toCardLayout(placement: CardPlacement): CardLayout {
  return { left: placement.left, originX: placement.originX, side: placement.side, top: placement.top }
}

/**
 * Where a single collapsed card sits — a thin adapter over `placeCards` for the
 * speech-bubble fallback and the placement contract tests. Beside its avatar on
 * the roomier side, in the best clear band, clamped fully inside the pane
 * (VAL-NOTIFY-007).
 */
export function cardLayout(
  avatar: ScreenRect,
  card: CardSize,
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN,
  obstacles: readonly CardBox[] = []
): CardLayout {
  const [placement] = placeCards([{ avatar, card, expanded: false }], viewport, gap, margin, obstacles)

  return toCardLayout(placement)
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
 * head, tail toward the speaker, and never over another avatar's body or an
 * already-placed card. When the row is too close to the top of the pane for the
 * bubble to clear its neighbours, it flips to the speaker's side exactly like a
 * card.
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
