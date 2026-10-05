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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Where a notification card sits for an avatar's projected rect: BESIDE it
 * (never over it) on the side with more room, clamped fully inside the pane
 * (architecture §8.5, VAL-NOTIFY-007).
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
  margin: number = CARD_MARGIN
): CardLayout {
  const spaceRight = viewport.width - (avatar.x + avatar.width)
  const spaceLeft = avatar.x
  const side: CardSide = spaceRight >= spaceLeft ? 'right' : 'left'
  const left = side === 'right' ? avatar.x + avatar.width + gap : avatar.x - card.width - gap

  return {
    left: clamp(left, margin, Math.max(margin, viewport.width - card.width - margin)),
    originX: side === 'right' ? 'left' : 'right',
    side,
    top: clamp(
      avatar.y + avatar.height / 2 - card.height / 2,
      margin,
      Math.max(margin, viewport.height - card.height - margin)
    )
  }
}

export interface CardBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Keeps several open cards from covering each other: a card that overlaps an
 * already-placed one is pushed straight down until it clears it, then the whole
 * column is kept inside the pane. Horizontal position and the unfold origin are
 * untouched — the card still sits beside its own avatar, just lower when a
 * neighbour already occupies that spot.
 *
 * Pure and order-stable so the placement contract is unit-tested.
 */
export function stackCards(
  boxes: CardBox[],
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN
): { x: number; y: number }[] {
  const placed: CardBox[] = []
  const out: { x: number; y: number }[] = []

  for (const box of boxes) {
    let y = box.y
    let moved = true
    let guard = 0

    while (moved && guard <= boxes.length) {
      moved = false
      guard += 1

      for (const other of placed) {
        const overlapsX = box.x < other.x + other.width && other.x < box.x + box.width
        const overlapsY = y < other.y + other.height && other.y < y + box.height

        if (overlapsX && overlapsY) {
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
