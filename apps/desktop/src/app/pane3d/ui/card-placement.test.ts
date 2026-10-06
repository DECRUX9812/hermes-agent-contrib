import { describe, expect, it } from 'vitest'

import type { AvatarId, PaneAnchor, ScreenRect } from '../protocol'
import { computeSlotLayout, reservedSlotRect } from '../scene/projection'

import { boxesOverlap, CARD_GAP, CARD_MARGIN, type CardBox } from './card-geometry'
import { type CardPlacement, type CardRequest, placeCards } from './card-layout'

/**
 * The single placement contract for every notification card (§8.5,
 * VAL-NOTIFY-005/007). `placeCards` chooses the side, the band and the cap in
 * one pass, so two expanded cards can never fight over a column: the second
 * moves to the opposite clear band instead of overlapping the first.
 */

function avatar(x: number, y: number, width = 120, height = 160): ScreenRect {
  return { height, width, x, y }
}

/** The box a placement actually renders as: expanded cards are capped to `maxHeight`. */
function boxOf(request: CardRequest, placement: CardPlacement): CardBox {
  const height =
    placement.maxHeight === undefined ? request.card.height : Math.min(request.card.height, placement.maxHeight)

  return { height, width: request.card.width, x: placement.left, y: placement.top }
}

function overlapsAny(box: CardBox, boxes: readonly CardBox[]): boolean {
  return boxes.some(other => boxesOverlap(box, other))
}

describe('placeCards — two expanded cards never share a column (round-3 scrutiny regression)', () => {
  const PANE = { height: 1000, width: 1920 }
  // The scrutiny layout: three avatars on a bottom perch; the rightmost card is
  // expanded first, then the middle avatar's card prefers the same right side.
  const ROW = [650, 800, 950].map(x => avatar(x, 840))
  const RIGHT = ROW[2]
  const MIDDLE = ROW[1]
  const LONG = 984

  it('moves the second card to the opposite side clear band, overlapping nothing', () => {
    const requests: CardRequest[] = [
      { avatar: RIGHT, card: { height: LONG, width: 264 }, expanded: true },
      { avatar: MIDDLE, card: { height: LONG, width: 264 }, expanded: true }
    ]

    const placements = placeCards(requests, PANE, CARD_GAP, CARD_MARGIN, ROW)
    const boxes = requests.map((request, index) => boxOf(request, placements[index]))

    // The first card takes the roomier side and the whole clean band.
    expect(placements[0].degenerate).toBe(false)
    expect(placements[0].side).toBe('right')

    // The second would prefer the right (its roomier side) too, but that column
    // belongs to the first card now — so it moves to the LEFT clear band.
    expect(placements[1].degenerate).toBe(false)
    expect(placements[1].side).toBe('left')

    expect(boxesOverlap(boxes[0], boxes[1])).toBe(false)
    expect(overlapsAny(boxes[1], ROW)).toBe(false)
    expect(overlapsAny(boxes[0], ROW)).toBe(false)

    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(CARD_MARGIN)
      expect(box.x + box.width).toBeLessThanOrEqual(PANE.width - CARD_MARGIN)
      expect(box.y).toBeGreaterThanOrEqual(CARD_MARGIN)
      expect(box.y + box.height).toBeLessThanOrEqual(PANE.height - CARD_MARGIN)
    }
  })

  it('is order-stable: the first card keeps its side, the second adapts', () => {
    const requests: CardRequest[] = [
      { avatar: MIDDLE, card: { height: LONG, width: 264 }, expanded: true },
      { avatar: RIGHT, card: { height: LONG, width: 264 }, expanded: true }
    ]

    const placements = placeCards(requests, PANE, CARD_GAP, CARD_MARGIN, ROW)
    const boxes = requests.map((request, index) => boxOf(request, placements[index]))

    expect(boxesOverlap(boxes[0], boxes[1])).toBe(false)
    expect(placements[0].left).toBe(
      placements[0].side === 'right' ? MIDDLE.x + MIDDLE.width + CARD_GAP : MIDDLE.x - 264 - CARD_GAP
    )
  })
})

describe('placeCards — several cards never cover each other or an avatar', () => {
  const PANE = { height: 1000, width: 1920 }
  const ROW = [100, 400, 700, 1000, 1300].map(x => avatar(x, 840))
  const CARD_WIDTH = 264

  it('stacks three collapsed cards near the bottom edge clear of every avatar', () => {
    const requests: CardRequest[] = [100, 400, 700].map(x => ({
      avatar: avatar(x, 840),
      card: { height: 150, width: CARD_WIDTH },
      expanded: false
    }))

    const placements = placeCards(requests, PANE, CARD_GAP, CARD_MARGIN, ROW)
    const boxes = requests.map((request, index) => boxOf(request, placements[index]))

    for (const [index, box] of boxes.entries()) {
      expect(overlapsAny(box, ROW), `card ${index} overlaps an avatar`).toBe(false)
      expect(box.x).toBeGreaterThanOrEqual(CARD_MARGIN)
      expect(box.x + box.width).toBeLessThanOrEqual(PANE.width - CARD_MARGIN)
      expect(box.y).toBeGreaterThanOrEqual(CARD_MARGIN)
      expect(box.y + box.height).toBeLessThanOrEqual(PANE.height - CARD_MARGIN)
    }

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(boxesOverlap(boxes[i], boxes[j]), `card ${i} overlaps card ${j}`).toBe(false)
      }
    }
  })

  it('a collapsed card beside an avatar stays at its mid-line when nothing is in the way', () => {
    const request: CardRequest = {
      avatar: avatar(600, 300),
      card: { height: 150, width: CARD_WIDTH },
      expanded: false
    }

    const [placement] = placeCards([request], PANE, CARD_GAP, CARD_MARGIN, [request.avatar])

    expect(placement.top).toBe(300 + 160 / 2 - 150 / 2)
    expect(placement.degenerate).toBe(false)
  })
})

/**
 * Property gate (seeded, 600 layouts): every card stays inside the pane, and a
 * non-degenerate card overlaps no avatar and no card already placed when it was
 * fitted (nor any other non-degenerate card). A degenerate card may overlap by
 * design — the approved least-overlap fallback for a pane with no usable band
 * (see `fitCardInColumn`); when a whole layout is non-degenerate, no two cards
 * overlap at all.
 */
describe('placeCards — randomized placement property (600 seeded layouts)', () => {
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0

    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('never lets a non-degenerate card overlap an avatar or an earlier card', () => {
    const rng = mulberry32(0x5eed)
    let nonDegenerate = 0
    let degenerate = 0
    let cleanLayouts = 0

    for (let layout = 0; layout < 600; layout += 1) {
      const width = 1280 + Math.floor(rng() * (2560 - 1280 + 1))
      const height = 900 + Math.floor(rng() * 500)
      const count = 1 + Math.floor(rng() * 5)
      const rowY = height - 240 + Math.floor(rng() * 80)
      const avatars: ScreenRect[] = []

      for (let index = 0; index < count; index += 1) {
        const base = CARD_MARGIN + ((index + 0.5) * (width - CARD_MARGIN * 2)) / count - 60
        const x = Math.round(Math.max(CARD_MARGIN, Math.min(width - CARD_MARGIN - 120, base + (rng() - 0.5) * 90)))

        avatars.push(avatar(x, rowY))
      }

      // 1–4 cards on distinct avatars, in a random (stable within the layout) order.
      const order = avatars.map((_, index) => index).sort(() => rng() - 0.5)
      const cardCount = Math.min(order.length, 1 + Math.floor(rng() * 4))

      const requests: CardRequest[] = order.slice(0, cardCount).map(index => {
        const expanded = rng() < 0.5
        const natural = expanded ? 300 + Math.floor(rng() * 2000) : 140 + Math.floor(rng() * 160)

        return { avatar: avatars[index], card: { height: natural, width: 264 }, expanded }
      })

      const placements = placeCards(requests, { height, width }, CARD_GAP, CARD_MARGIN, avatars)
      const boxes = requests.map((request, index) => boxOf(request, placements[index]))

      // Every card, degenerate or not, stays inside the pane.
      for (const [index, box] of boxes.entries()) {
        expect(box.x, `layout ${layout} card ${index} x`).toBeGreaterThanOrEqual(CARD_MARGIN - 0.5)
        expect(box.x + box.width, `layout ${layout} card ${index} right`).toBeLessThanOrEqual(width - CARD_MARGIN + 0.5)
        expect(box.y, `layout ${layout} card ${index} y`).toBeGreaterThanOrEqual(CARD_MARGIN - 0.5)
        expect(box.y + box.height, `layout ${layout} card ${index} bottom`).toBeLessThanOrEqual(
          height - CARD_MARGIN + 0.5
        )
      }

      if (placements.every(placement => !placement.degenerate)) {
        cleanLayouts += 1
      }

      for (const [index, placement] of placements.entries()) {
        if (placement.degenerate) {
          degenerate += 1

          continue
        }

        nonDegenerate += 1
        const box = boxes[index]

        expect(overlapsAny(box, avatars), `layout ${layout} card ${index} covers an avatar`).toBe(false)

        for (let other = 0; other < boxes.length; other += 1) {
          if (other === index) {
            continue
          }

          // A card is fitted against everything placed before it, and two
          // non-degenerate cards are mutually clear. Only a degenerate card
          // placed later may cover this one (the approved fallback).
          if (other < index || !placements[other].degenerate) {
            expect(boxesOverlap(box, boxes[other]), `layout ${layout} card ${index} covers card ${other}`).toBe(false)
          }
        }
      }
    }

    // The generator must exercise both paths, or the gate proves nothing.
    expect(nonDegenerate).toBeGreaterThan(1000)
    expect(degenerate).toBeGreaterThan(0)
    expect(cleanLayouts).toBeGreaterThan(300)
  })
})

describe('placeCards — an open card clears the perch an emerging avatar climbs into (VAL-NOTIFY-007)', () => {
  const PANE = { height: 1198, width: 2132 }
  // The live repro, at the reported geometry: Muse idles on the perch line at
  // the right of the pane while Grok becomes visible in the slot immediately
  // left of her and spends his emergence below that line.
  const MUSE: ScreenRect = { height: 131, width: 195, x: 1425, y: 156 }
  const GROK_PERCH: ScreenRect = { height: 126, width: 105, x: 1297, y: 161 }
  const GROK_CLIMBING: ScreenRect = { ...GROK_PERCH, y: 251 }
  // What the obstacle source publishes while Grok is still below the edge: the
  // union of his animated rect and the perch he is rising into.
  const GROK_OBSTACLE: CardBox = { height: 216, width: 105, x: 1297, y: 161 }

  it('places the existing card on the clear side, overlapping neither body', () => {
    const request: CardRequest = { avatar: MUSE, card: { height: 156, width: 264 }, expanded: false }
    const [placement] = placeCards([request], PANE, CARD_GAP, CARD_MARGIN, [MUSE, GROK_OBSTACLE])
    const box = boxOf(request, placement)

    expect(placement.degenerate).toBe(false)
    expect(overlapsAny(box, [MUSE, GROK_PERCH, GROK_CLIMBING])).toBe(false)
    // The reserved perch pushes the card off the roomier (left) side, where it
    // would otherwise sit and be crossed by the rising newcomer.
    expect(placement.side).toBe('right')

    // The defect the reservation closes: with the pre-fix obstacle list (the
    // animated rects alone — Grok has not projected one yet) the card lands on
    // the left, exactly over the perch he climbs into.
    const [animatedOnly] = placeCards([request], PANE, CARD_GAP, CARD_MARGIN, [MUSE])

    expect(animatedOnly.side).toBe('left')
    expect(boxesOverlap(boxOf(request, animatedOnly), GROK_PERCH)).toBe(true)
  })
})

describe('placeCards with the high-anchor headroom floor (VAL-ANCHOR-006)', () => {
  const PANE = { height: 1080, width: 1920 }

  const ANCHOR: PaneAnchor = {
    kind: 'hermes-browser',
    label: 'maximized',
    rect: { height: 800, width: 1920, x: 0, y: 68 }
  }

  const MUSE = { height: 1.1, id: 'muse' as const, width: 1.35 }
  const GROK = { height: 0.95, id: 'grok' as const, width: 0.7 }

  it('keeps the card and the lowered row inside the pane, overlapping neither body', () => {
    const ids: AvatarId[] = ['muse', 'grok']

    // The real cast, so the layout's headroom floor matches the registry.
    const heights: Record<AvatarId, number> = {
      claude: 1.23,
      grok: GROK.height,
      hermes: 1.08,
      muse: MUSE.height,
      opencode: 0.8
    }

    const widths: Partial<Record<AvatarId, number>> = { grok: GROK.width, muse: MUSE.width }

    const slots = computeSlotLayout({
      anchor: ANCHOR,
      dock: null,
      heights,
      ids,
      viewport: PANE,
      widths
    })

    const row = [MUSE, GROK].map(size => reservedSlotRect(slots[size.id], size, PANE))

    // The headroom floor lowered the line, so every body's top is on screen.
    for (const rect of row) {
      expect(rect.y).toBeGreaterThanOrEqual(0)
    }

    const request: CardRequest = { avatar: row[0], card: { height: 220, width: 264 }, expanded: false }
    const [placement] = placeCards([request], PANE, CARD_GAP, CARD_MARGIN, row)
    const box = boxOf(request, placement)

    expect(placement.degenerate).toBe(false)
    expect(overlapsAny(box, row)).toBe(false)
    expect(box.x).toBeGreaterThanOrEqual(CARD_MARGIN)
    expect(box.y).toBeGreaterThanOrEqual(CARD_MARGIN)
    expect(box.x + box.width).toBeLessThanOrEqual(PANE.width - CARD_MARGIN)
    expect(box.y + box.height).toBeLessThanOrEqual(PANE.height - CARD_MARGIN)
  })
})
