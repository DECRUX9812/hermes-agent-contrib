import { describe, expect, it } from 'vitest'

import type { ScreenRect } from '../protocol'

import { cardLayout, stackCards } from './card-layout'

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
