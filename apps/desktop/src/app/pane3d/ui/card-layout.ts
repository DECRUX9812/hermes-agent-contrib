import type { ScreenRect } from '../protocol'

export type CardSide = 'left' | 'right'

export interface CardSize {
  width: number
  height: number
}

export interface CardLayout {
  left: number
  top: number
  /** Which side of the avatar the card sits on. */
  side: CardSide
  /** The transform origin nearest the avatar, so the card unfolds toward it. */
  originX: CardSide
}

export const CARD_GAP = 14
export const CARD_MARGIN = 8

/**
 * The tallest a card may grow and still sit wholly inside the pane (§8.5,
 * VAL-NOTIFY-007): the viewport minus the top and bottom margins. An expanded
 * body is bounded by this so a long host body can never push the card (or its
 * action/close) outside the pane; the body scrolls instead.
 */
export function expandedCardMaxHeight(viewportHeight: number, margin: number = CARD_MARGIN): number {
  return Math.max(0, viewportHeight - margin * 2)
}

export interface CardBox {
  x: number
  y: number
  width: number
  height: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Boxes (padded by `pad`) intersect. */
export function boxesOverlap(a: CardBox, b: CardBox, pad = 0): boolean {
  return (
    a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
  )
}

function withinBounds(y: number, height: number, viewport: CardSize, margin: number): boolean {
  return y >= margin - 0.5 && y + height <= viewport.height - margin + 0.5
}

/**
 * Push a box vertically until it clears every obstacle, moving in `prefer`'s
 * direction. Pure and order-stable; the caller decides what to do if the
 * result leaves the pane.
 */
function clearVertical(box: CardBox, obstacles: readonly CardBox[], gap: number, prefer: 'down' | 'up'): number {
  let y = box.y
  let moving = true
  let guard = 0

  while (moving && guard <= obstacles.length + 1) {
    moving = false
    guard += 1

    for (const other of obstacles) {
      if (!boxesOverlap({ ...box, y }, other, gap)) {
        continue
      }

      y = prefer === 'up' ? other.y - box.height - gap : other.y + other.height + gap
      moving = true
    }
  }

  return y
}

/** Intersection area of two boxes inflated by `pad`; 0 when they do not touch. */
function overlapArea(a: CardBox, b: CardBox, pad: number): number {
  const width = Math.min(a.x + a.width + pad, b.x + b.width + pad) - Math.max(a.x - pad, b.x - pad)
  const height = Math.min(a.y + a.height + pad, b.y + b.height + pad) - Math.max(a.y - pad, b.y - pad)

  return width > 0 && height > 0 ? width * height : 0
}

function totalOverlap(box: CardBox, obstacles: readonly CardBox[], pad: number): number {
  return obstacles.reduce((sum, other) => sum + overlapArea(box, other, pad), 0)
}

/** Candidate tops are swept at this step so an unobstructed band is never missed. */
const VERTICAL_STEP = 8

/**
 * The top for `box` (whose `y` is the DESIRED position) that keeps it inside
 * the pane and as clear as possible of `obstacles`. Candidates are the desired
 * spot, both pane edges, every obstacle's clear edges and a fine sweep; the
 * winner has the least total overlap, then the smallest distance from the
 * desired spot, preferring downward.
 *
 * This is what lets a card near the bottom edge stack UPWARD instead of being
 * clamped back onto a neighbour (§8.5): a placement that overlaps nothing
 * always beats one that overlaps something, however far away it has to go.
 */
function bestVertical(
  box: CardBox,
  obstacles: readonly CardBox[],
  viewport: CardSize,
  gap: number,
  margin: number
): number {
  const min = margin
  const max = Math.max(min, viewport.height - margin - box.height)
  const desired = clamp(box.y, min, max)
  const candidates = new Set<number>([min, max, desired])

  for (const other of obstacles) {
    candidates.add(clamp(other.y - box.height - gap, min, max))
    candidates.add(clamp(other.y + other.height + gap, min, max))
  }

  for (let y = min; y <= max; y += VERTICAL_STEP) {
    candidates.add(y)
  }

  let best = desired
  let bestOverlap = Number.POSITIVE_INFINITY
  let bestDistance = Number.POSITIVE_INFINITY

  for (const y of candidates) {
    const overlap = totalOverlap({ ...box, y }, obstacles, gap)
    const distance = Math.abs(y - desired)

    const better =
      overlap < bestOverlap - 0.5 ||
      (Math.abs(overlap - bestOverlap) <= 0.5 &&
        (distance < bestDistance - 0.5 || (Math.abs(distance - bestDistance) <= 0.5 && y > best)))

    if (better) {
      best = y
      bestOverlap = overlap
      bestDistance = distance
    }
  }

  return best
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

/**
 * Keeps several open cards from covering each other — or a neighbouring
 * avatar. Each card is validated against every card already placed AND every
 * obstacle: the placement with the least overlap wins, so a card that would
 * otherwise be clamped onto a neighbour near the bottom edge stacks upward (or
 * into whatever clear band exists) instead. Horizontal position and the unfold
 * origin are untouched — the card still sits beside its own avatar, just higher
 * or lower when that spot is taken.
 *
 * Pure and order-stable so the placement contract is unit-tested.
 */
export function stackCards(
  boxes: readonly CardBox[],
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN,
  obstacles: readonly CardBox[] = []
): { x: number; y: number }[] {
  const placed: CardBox[] = [...obstacles]
  const out: { x: number; y: number }[] = []

  for (const box of boxes) {
    const top = bestVertical(box, placed, viewport, gap, margin)

    placed.push({ ...box, y: top })
    out.push({ x: box.x, y: top })
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
