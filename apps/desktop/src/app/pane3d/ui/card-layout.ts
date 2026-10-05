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

/**
 * A vertical position that clears the obstacles and stays inside the pane,
 * trying `prefer` first and then the opposite direction. Falls back to a clamp
 * when neither fits (a pane smaller than its own content).
 */
function placeVertical(
  box: CardBox,
  obstacles: readonly CardBox[],
  viewport: CardSize,
  gap: number,
  margin: number,
  prefer: 'down' | 'up'
): number {
  const primary = clearVertical(box, obstacles, gap, prefer)

  if (withinBounds(primary, box.height, viewport, margin)) {
    return primary
  }

  const secondary = clearVertical(box, obstacles, gap, prefer === 'down' ? 'up' : 'down')

  if (withinBounds(secondary, box.height, viewport, margin)) {
    return secondary
  }

  return clamp(primary, margin, Math.max(margin, viewport.height - box.height - margin))
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
  const side =
    preference.find(candidate => !obstacles.some(box => boxesOverlap(boxFor(candidate), box, gap))) ?? preference[0]

  const box = boxFor(side)

  return {
    left: box.x,
    originX: side === 'right' ? 'left' : 'right',
    side,
    top: placeVertical(box, obstacles, viewport, gap, margin, 'down')
  }
}

/**
 * Keeps several open cards from covering each other — or a neighbouring
 * avatar. A card that overlaps an already-placed box is pushed straight down
 * until it clears it, then the whole column is kept inside the pane.
 * Horizontal position and the unfold origin are untouched — the card still sits
 * beside its own avatar, just lower when a neighbour already occupies that spot.
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
    let y = box.y
    let moved = true
    let guard = 0

    while (moved && guard <= boxes.length + obstacles.length) {
      moved = false
      guard += 1

      for (const other of placed) {
        if (boxesOverlap({ ...box, y }, other, gap)) {
          y = other.y + other.height + gap
          moved = true
        }
      }
    }

    if (y + box.height > viewport.height - margin) {
      y = Math.max(margin, viewport.height - margin - box.height)
    }

    placed.push({ ...box, y })
    out.push({ x: box.x, y })
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
