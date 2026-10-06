import { describe, expect, it } from 'vitest'

import type { ScreenRect } from '../protocol'

import {
  boxesOverlap,
  CARD_GAP,
  CARD_MARGIN,
  type CardBox,
  expandedCardMaxHeight,
  freeVerticalBands
} from './card-geometry'
import { bubbleLayout, cardLayout, expandedCardLayout, stackCards } from './card-layout'

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

describe('stackCards — the final placement is revalidated after clamping (§8.5, VAL-NOTIFY-005/007)', () => {
  const CARD_BOX = { height: 150, width: 264 }

  const overlapsAny = (placed: { x: number; y: number }[], obstacles: readonly CardBox[]): boolean =>
    placed.some((box, index) => {
      const mine = { ...CARD_BOX, ...box }

      return (
        placed.some((other, otherIndex) => otherIndex !== index && boxesOverlap(mine, { ...CARD_BOX, ...other })) ||
        obstacles.some(obstacle => boxesOverlap(mine, obstacle))
      )
    })

  it('stacks two near-bottom cards upward instead of clamping them onto each other', () => {
    const pane = { height: 1080, width: 1920 }

    const boxes = [
      { ...CARD_BOX, x: 100, y: 900 },
      { ...CARD_BOX, x: 150, y: 920 }
    ]

    const placed = stackCards(boxes, pane, 8, 8)

    expect(overlapsAny(placed, [])).toBe(false)

    for (const box of placed) {
      expect(box.y).toBeGreaterThanOrEqual(8)
      expect(box.y + CARD_BOX.height).toBeLessThanOrEqual(pane.height - 8)
    }
  })

  it('never overlaps a neighbour or any avatar with 3 cards and 5 avatars near the bottom edge', () => {
    const pane = { height: 1000, width: 1920 }
    const avatars: CardBox[] = [100, 400, 700, 1000, 1300].map(x => ({ height: 160, width: 120, x, y: 840 }))
    const boxes = [120, 200, 280].map(x => ({ ...CARD_BOX, x, y: 850 }))

    const placed = stackCards(boxes, pane, 14, 8, avatars)

    expect(overlapsAny(placed, avatars)).toBe(false)

    for (const box of placed) {
      expect(box.y).toBeGreaterThanOrEqual(8)
      expect(box.y + CARD_BOX.height).toBeLessThanOrEqual(pane.height - 8)
    }
  })

  it('prefers a clear spot far above over a clamped overlap', () => {
    const pane = { height: 1000, width: 1920 }
    const avatar: CardBox = { height: 160, width: 1920, x: 0, y: 800 }
    const [placed] = stackCards([{ ...CARD_BOX, x: 100, y: 900 }], pane, 14, 8, [avatar])

    expect(boxesOverlap({ ...CARD_BOX, ...placed }, avatar)).toBe(false)
    expect(placed.y + CARD_BOX.height).toBeLessThanOrEqual(800 - 14)
  })
})

describe('expandedCardMaxHeight — an expanded body stays inside the pane (§8.5, VAL-NOTIFY-007)', () => {
  it('leaves the top and bottom margins free', () => {
    expect(expandedCardMaxHeight(1000)).toBe(1000 - 8 * 2)
  })

  it('lets cardLayout place a fully expanded card wholly inside the pane', () => {
    const pane = { height: 720, width: 1280 }
    const height = expandedCardMaxHeight(pane.height)
    const layout = cardLayout(avatar({ x: 600, y: 300 }), { height, width: 264 }, pane)

    expect(layout.top).toBeGreaterThanOrEqual(8)
    expect(layout.top + height).toBeLessThanOrEqual(pane.height - 8)
  })
})

describe('freeVerticalBands — the clear vertical intervals for a card column', () => {
  const PANE = { height: 1000, width: 1920 }

  it('returns the whole interior when nothing overlaps the column', () => {
    expect(freeVerticalBands({ width: 264, x: 100 }, [{ height: 160, width: 120, x: 900, y: 800 }], PANE)).toEqual([
      { bottom: 992, top: 8 }
    ])
  })

  it('splits around an obstacle that crosses the column, less the gap', () => {
    expect(freeVerticalBands({ width: 264, x: 100 }, [{ height: 160, width: 500, x: 0, y: 400 }], PANE)).toEqual([
      { bottom: 386, top: 8 },
      { bottom: 992, top: 574 }
    ])
  })

  it('returns no band when an obstacle covers the whole interior', () => {
    expect(freeVerticalBands({ width: 264, x: 100 }, [{ height: 2000, width: 500, x: 0, y: 0 }], PANE)).toEqual([])
  })
})

describe('expandedCardLayout — a long expanded card fits a clear band (§8.5, VAL-NOTIFY-007)', () => {
  const PANE = { height: 1000, width: 1920 }
  const WIDTH = 264
  // Three avatars on a bottom perch, the case the scrutiny review reproduced:
  // the middle avatar's card overlaps a neighbour horizontally on BOTH sides, so
  // no full-height placement is clear of them.
  const ROW = [650, 800, 950].map(x => ({ height: 160, width: 120, x, y: 840 }))
  const MIDDLE = ROW[1]
  const NEIGHBOURS = [ROW[0], ROW[2]]
  // The clear band above the neighbour row: pane margin .. neighbour top − gap.
  const BAND_ABOVE = ROW[0].y - CARD_GAP - CARD_MARGIN

  it('places a viewport-tall card in the clear band and caps it to that band (body scrolls)', () => {
    const natural = 984

    const layout = expandedCardLayout(
      MIDDLE,
      { height: natural, width: WIDTH },
      PANE,
      CARD_GAP,
      CARD_MARGIN,
      NEIGHBOURS
    )

    const placed = { height: Math.min(natural, layout.maxHeight), width: WIDTH, x: layout.left, y: layout.top }

    expect(layout.degenerate).toBe(false)
    expect(layout.maxHeight).toBe(BAND_ABOVE)
    expect(placed.height).toBeLessThan(natural)

    for (const neighbour of NEIGHBOURS) {
      expect(boxesOverlap(placed, neighbour), `overlaps x=${neighbour.x}`).toBe(false)
    }

    expect(placed.y).toBeGreaterThanOrEqual(CARD_MARGIN)
    expect(placed.y + placed.height).toBeLessThanOrEqual(PANE.height - CARD_MARGIN)
  })

  it('keeps a short expanded body beside its avatar, clear of the neighbours', () => {
    const layout = expandedCardLayout(MIDDLE, { height: 220, width: WIDTH }, PANE, CARD_GAP, CARD_MARGIN, NEIGHBOURS)
    const placed = { height: 220, width: WIDTH, x: layout.left, y: layout.top }

    expect(layout.degenerate).toBe(false)

    for (const neighbour of NEIGHBOURS) {
      expect(boxesOverlap(placed, neighbour), `overlaps x=${neighbour.x}`).toBe(false)
    }

    expect(placed.y + placed.height).toBeLessThanOrEqual(ROW[0].y - CARD_GAP)
  })

  it('falls back to least-overlap placement when no clear band reaches the minimum', () => {
    // A wall of obstacles crossing the whole pane, leaving only sub-minimum gaps.
    const wall = [
      { height: 214, width: 1920, x: 0, y: 8 },
      { height: 214, width: 1920, x: 0, y: 292 },
      { height: 214, width: 1920, x: 0, y: 576 },
      { height: 300, width: 1920, x: 0, y: 770 }
    ]

    const natural = 984
    const layout = expandedCardLayout(MIDDLE, { height: natural, width: WIDTH }, PANE, CARD_GAP, CARD_MARGIN, wall)
    const placed = { height: Math.min(natural, layout.maxHeight), width: WIDTH, x: layout.left, y: layout.top }

    expect(layout.degenerate).toBe(true)
    expect(layout.maxHeight).toBe(expandedCardMaxHeight(PANE.height))
    expect(placed.y).toBeGreaterThanOrEqual(CARD_MARGIN)
    expect(placed.y + placed.height).toBeLessThanOrEqual(PANE.height - CARD_MARGIN)
  })
})

describe('stackCards — an expanded card re-fits around the cards already placed (§8.5, VAL-NOTIFY-005/007)', () => {
  const PANE = { height: 1000, width: 1920 }

  it('caps the expanded card to a band clear of the avatars and of the card already placed', () => {
    const avatars: CardBox[] = [650, 800, 950].map(x => ({ height: 160, width: 120, x, y: 840 }))
    const short = { height: 150, width: 264, x: 934, y: 200 }
    const expanded = { expanded: true, height: 984, naturalHeight: 984, width: 264, x: 934, y: 428 }

    const [, placedExpanded] = stackCards([short, expanded], PANE, CARD_GAP, CARD_MARGIN, avatars)
    const cap = placedExpanded.maxHeight ?? 0
    const rect = { height: Math.min(984, cap), width: 264, x: placedExpanded.x, y: placedExpanded.y }

    // The top band belongs to the short card, so the expanded card moves to the
    // band below it — still beside its avatar and clear of every obstacle.
    expect(cap).toBeLessThan(984)

    for (const obstacle of [...avatars, short]) {
      expect(boxesOverlap(rect, obstacle), `overlaps x=${obstacle.x} y=${obstacle.y}`).toBe(false)
    }

    expect(placedExpanded.y).toBeGreaterThanOrEqual(CARD_MARGIN)
    expect(placedExpanded.y + rect.height).toBeLessThanOrEqual(PANE.height - CARD_MARGIN)
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
