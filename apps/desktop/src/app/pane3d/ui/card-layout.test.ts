import { describe, expect, it } from 'vitest'

import type { ScreenRect } from '../protocol'

import { boxesOverlap, bubbleLayout, type CardBox, cardLayout, stackCards } from './card-layout'

const VIEWPORT = { height: 1000, width: 1920 }
const CARD = { height: 150, width: 264 }

function avatar(overrides: Partial<ScreenRect> = {}): ScreenRect {
  return { height: 160, width: 120, x: 800, y: 200, ...overrides }
}

describe('cardLayout — notification card placement (§8.5, VAL-NOTIFY-007)', () => {
  it('sits BESIDE the avatar on the side with more room, never over it', () => {
    const right = cardLayout(avatar({ x: 200 }), CARD, VIEWPORT)

    expect(right.side).toBe('right')
    expect(right.originX).toBe('left') // unfolds from the avatar edge
    expect(right.left).toBeGreaterThanOrEqual(200 + 120)

    const left = cardLayout(avatar({ x: 1700 }), CARD, VIEWPORT)

    expect(left.side).toBe('left')
    expect(left.originX).toBe('right')
    expect(left.left + CARD.width).toBeLessThanOrEqual(1700)
  })

  it('centers the card vertically on the avatar', () => {
    const layout = cardLayout(avatar({ height: 160, y: 200 }), CARD, VIEWPORT)

    expect(layout.top).toBe(200 + 160 / 2 - CARD.height / 2)
  })

  it('clamps the card fully inside the pane bounds', () => {
    const layout = cardLayout(avatar({ height: 120, width: 60, x: 1850, y: 980 }), CARD, VIEWPORT)

    expect(layout.left).toBeGreaterThanOrEqual(8)
    expect(layout.left + CARD.width).toBeLessThanOrEqual(VIEWPORT.width - 8)
    expect(layout.top).toBeGreaterThanOrEqual(8)
    expect(layout.top + CARD.height).toBeLessThanOrEqual(VIEWPORT.height - 8)
  })

  it('stays inside the bounds for avatars anywhere along the row', () => {
    for (const x of [0, 120, 480, 960, 1440, 1800, 1900]) {
      const layout = cardLayout(avatar({ x }), CARD, VIEWPORT)

      expect(layout.left, `x=${x}`).toBeGreaterThanOrEqual(8)
      expect(layout.left + CARD.width, `x=${x}`).toBeLessThanOrEqual(VIEWPORT.width - 8)
    }
  })
})

describe('stackCards — several open cards never cover each other', () => {
  it('leaves non-overlapping cards exactly where they were placed', () => {
    const boxes = [
      { height: 150, width: 264, x: 100, y: 200 },
      { height: 150, width: 264, x: 900, y: 200 }
    ]

    expect(stackCards(boxes, VIEWPORT)).toEqual([
      { x: 100, y: 200 },
      { x: 900, y: 200 }
    ])
  })

  it('pushes an overlapping card below the one already placed', () => {
    const boxes = [
      { height: 150, width: 264, x: 100, y: 200 },
      { height: 150, width: 264, x: 200, y: 210 }
    ]

    const [first, second] = stackCards(boxes, VIEWPORT, 8)

    expect(first).toEqual({ x: 100, y: 200 })
    expect(second.y).toBeGreaterThanOrEqual(200 + 150 + 8)
    expect(second.y + 150).toBeLessThanOrEqual(VIEWPORT.height - 8)
  })

  it('keeps a stacked column fully inside the pane', () => {
    const boxes = [
      { height: 150, width: 264, x: 100, y: 900 },
      { height: 150, width: 264, x: 100, y: 900 }
    ]

    for (const box of stackCards(boxes, VIEWPORT)) {
      expect(box.y).toBeGreaterThanOrEqual(8)
      expect(box.y + 150).toBeLessThanOrEqual(VIEWPORT.height - 8)
    }
  })
})

describe('cardLayout — a card never covers another avatar (§8.6 orchestrator note)', () => {
  const neighbour: CardBox = { height: 160, width: 120, x: 1000, y: 200 }

  it('flips to the other side when the roomier side is a neighbour', () => {
    // The avatar sits at x 800; a neighbour body occupies the right side, where
    // the "more room" rule alone would put the card.
    const layout = cardLayout(avatar({ x: 800 }), CARD, VIEWPORT, undefined, undefined, [neighbour])
    const placed = { height: CARD.height, width: CARD.width, x: layout.left, y: layout.top }

    expect(layout.side).toBe('left')
    expect(boxesOverlap(placed, neighbour)).toBe(false)
  })

  it('pushes the card clear when both sides are occupied, staying in bounds', () => {
    const left: CardBox = { height: 160, width: 120, x: 560, y: 200 }
    const right: CardBox = { height: 160, width: 120, x: 1000, y: 200 }
    const layout = cardLayout(avatar({ x: 800 }), CARD, VIEWPORT, undefined, undefined, [left, right])
    const placed = { height: CARD.height, width: CARD.width, x: layout.left, y: layout.top }

    expect(boxesOverlap(placed, left)).toBe(false)
    expect(boxesOverlap(placed, right)).toBe(false)
    expect(layout.top).toBeGreaterThanOrEqual(8)
    expect(layout.top + CARD.height).toBeLessThanOrEqual(VIEWPORT.height - 8)
  })

  it('stackCards treats other avatars as obstacles, not just other cards', () => {
    const boxes = [{ height: 150, width: 264, x: 100, y: 200 }]
    const [placed] = stackCards(boxes, VIEWPORT, 8, 8, [{ height: 160, width: 120, x: 120, y: 180 }])

    expect(placed.y).toBeGreaterThanOrEqual(180 + 160 + 8)
    expect(placed.x).toBe(100)
  })
})

describe('bubbleLayout — a speech bubble over the speaker, clear of neighbours (§8.6)', () => {
  const BUBBLE = { height: 56, width: 220 }

  it('sits above the speaker, horizontally centred, tail down', () => {
    const layout = bubbleLayout(avatar({ x: 800, y: 400 }), BUBBLE, VIEWPORT)

    expect(layout.placement).toBe('above')
    expect(layout.top + BUBBLE.height).toBeLessThanOrEqual(400)
    // Centred on the speaker's mid-line.
    expect(layout.left + BUBBLE.width / 2).toBeCloseTo(800 + 60, 0)
  })

  it('climbs above a neighbour rather than covering its head', () => {
    const neighbour: CardBox = { height: 160, width: 120, x: 960, y: 300 }
    const layout = bubbleLayout(avatar({ x: 800, y: 400 }), BUBBLE, VIEWPORT, undefined, undefined, [neighbour])
    const placed = { height: BUBBLE.height, width: BUBBLE.width, x: layout.left, y: layout.top }

    expect(layout.placement).toBe('above')
    expect(boxesOverlap(placed, neighbour)).toBe(false)
  })

  it('flips to the speaker side when there is no room above', () => {
    const layout = bubbleLayout(avatar({ x: 900, y: 20 }), BUBBLE, VIEWPORT)
    const placed = { height: BUBBLE.height, width: BUBBLE.width, x: layout.left, y: layout.top }

    expect(layout.placement).not.toBe('above')
    expect(placed.y).toBeGreaterThanOrEqual(8)
    expect(placed.y + BUBBLE.height).toBeLessThanOrEqual(VIEWPORT.height - 8)
    expect(placed.x).toBeGreaterThanOrEqual(8)
    expect(placed.x + BUBBLE.width).toBeLessThanOrEqual(VIEWPORT.width - 8)
  })
})
