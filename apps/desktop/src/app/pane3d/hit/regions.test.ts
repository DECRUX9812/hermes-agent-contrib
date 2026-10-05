/**
 * Contract tests for the pure hit-region math (architecture §6, VAL-HIT-005).
 *
 * These pin the relationships the click-through pipeline depends on: padding
 * is applied per source, outward rounding never shrinks a rect, near rects
 * union, the list is capped at 24 by merging the closest pairs, and change
 * detection is tolerance-based and order-insensitive.
 */

import { describe, expect, it } from 'vitest'

import type { ScreenRect } from '../protocol'

import {
  AVATAR_PAD,
  buildHitRegions,
  DOM_PAD,
  domHitRects,
  EQUAL_TOLERANCE,
  mergeRegions,
  padRect,
  regionsEqual,
  roundRect
} from './regions'

const rect = (x: number, y: number, width: number, height: number): ScreenRect => ({ height, width, x, y })

describe('padRect', () => {
  it('grows every side by the pad', () => {
    expect(padRect(rect(10, 20, 100, 50), 6)).toEqual(rect(4, 14, 112, 62))
  })

  it('accepts a negative pad (shrink) without swapping the rect', () => {
    expect(padRect(rect(10, 20, 100, 50), -2)).toEqual(rect(12, 22, 96, 46))
  })
})

describe('roundRect', () => {
  it('rounds outward so a shape never clips the pixels it guards', () => {
    // 10.5..99.45 -> 10..100 (width 90), 20.2..63.45 -> 20..64 (height 44).
    expect(roundRect(rect(10.5, 20.2, 88.95, 43.25))).toEqual(rect(10, 20, 90, 44))
  })

  it('never collapses to a zero-size rect', () => {
    expect(roundRect(rect(5.5, 5.5, 0.1, 0.1))).toEqual(rect(5, 5, 1, 1))
  })
})

describe('mergeRegions', () => {
  it('unions overlapping rects', () => {
    expect(mergeRegions([rect(0, 0, 10, 10), rect(5, 5, 10, 10)])).toEqual([rect(0, 0, 15, 15)])
  })

  it('unions rects separated by less than the gap', () => {
    expect(mergeRegions([rect(0, 0, 10, 10), rect(13, 0, 10, 10)], 4)).toEqual([rect(0, 0, 23, 10)])
  })

  it('leaves rects further apart than the gap alone', () => {
    expect(mergeRegions([rect(0, 0, 10, 10), rect(20, 0, 10, 10)], 4)).toEqual([
      rect(0, 0, 10, 10),
      rect(20, 0, 10, 10)
    ])
  })

  it('merges a chain of near rects into one', () => {
    // Each neighbour is within the gap, so all three collapse — a single pass
    // would have left the first and third standing.
    expect(mergeRegions([rect(0, 0, 10, 10), rect(12, 0, 10, 10), rect(24, 0, 10, 10)], 4)).toEqual([
      rect(0, 0, 34, 10)
    ])
  })

  it('caps the list at 24 by merging the closest pairs', () => {
    // 6 close pairs (10 px gaps, too far to union at gap 4) plus 18 isolated
    // rects: the cap must spend its six merges on the pairs, not the singles.
    const closePairs = Array.from({ length: 6 }, (_, index) => [
      rect(index * 1000, 0, 10, 10),
      rect(index * 1000 + 20, 0, 10, 10)
    ]).flat()

    const singles = Array.from({ length: 18 }, (_, index) => rect(index * 1000 + 400, 0, 10, 10))
    const merged = mergeRegions([...closePairs, ...singles])

    expect(merged).toHaveLength(24)
    const widths = merged.map(item => item.width)

    expect(widths.filter(width => width === 30)).toHaveLength(6)
    expect(widths.filter(width => width === 10)).toHaveLength(18)
  })

  it('drops degenerate rects and returns integers in a stable order', () => {
    const merged = mergeRegions([rect(0, 0, 0, 10), rect(30.4, 10.6, 10.2, 10.2), rect(0, 0, 10, 10)])

    expect(merged.every(item => Number.isInteger(item.x) && Number.isInteger(item.y))).toBe(true)
    expect(merged).toEqual([rect(0, 0, 10, 10), rect(30, 10, 11, 11)])
  })

  it('returns nothing for an empty list', () => {
    expect(mergeRegions([])).toEqual([])
  })
})

describe('regionsEqual', () => {
  const a = [rect(0, 0, 10, 10), rect(50, 50, 20, 20)]

  it('is order-insensitive', () => {
    expect(regionsEqual(a, [a[1], a[0]])).toBe(true)
  })

  it('tolerates sub-pixel drift but detects real movement', () => {
    expect(regionsEqual(a, [a[0], rect(51, 50, 20, 20)])).toBe(true)
    expect(regionsEqual(a, [a[0], rect(53, 50, 20, 20)])).toBe(false)
    expect(EQUAL_TOLERANCE).toBe(1)
  })

  it('detects a different region count', () => {
    expect(regionsEqual(a, [a[0]])).toBe(false)
  })

  it('matches duplicates one-for-one instead of reusing a single partner', () => {
    expect(regionsEqual([a[0], a[0]], [a[0], rect(a[0].x, a[0].y, a[0].width, a[0].height)])).toBe(true)
    expect(regionsEqual([a[0], a[0]], [a[0], rect(900, 900, 40, 40)])).toBe(false)
  })
})

describe('buildHitRegions', () => {
  it('pads avatar parts by 6 and DOM targets by 8', () => {
    const regions = buildHitRegions({ avatars: [rect(100, 100, 40, 40)], dom: [rect(0, 0, 10, 10)] })

    // Far apart, so they stay separate and each keeps its own padding.
    expect(regions).toEqual([rect(-8, -8, 26, 26), rect(94, 94, 52, 52)])
    expect(AVATAR_PAD).toBe(6)
    expect(DOM_PAD).toBe(8)
  })

  it('merges a padded avatar with an overlapping padded DOM rect', () => {
    expect(buildHitRegions({ avatars: [rect(100, 100, 20, 20)], dom: [rect(105, 105, 10, 10)] })).toEqual([
      rect(94, 94, 32, 32)
    ])
  })

  it('grows a measured DOM rect by exactly one pad per side', () => {
    // Regression: `domHitRects` already measured the element, so padding it
    // again here would double every region (16 px, not 8).
    const dom = domHitRects([{ getBoundingClientRect: () => ({ height: 32, width: 72, x: 2044, y: 1150 }) }])

    expect(dom).toEqual([rect(2044, 1150, 72, 32)])
    expect(buildHitRegions({ dom })).toEqual([rect(2036, 1142, 88, 48)])
  })
})

describe('domHitRects', () => {
  const element = (x: number, y: number, width: number, height: number) => ({
    getBoundingClientRect: () => ({ height, width, x, y })
  })

  it('returns each measurable target raw — padding belongs to buildHitRegions', () => {
    expect(domHitRects([element(10, 10, 20, 20)])).toEqual([rect(10, 10, 20, 20)])
  })

  it('skips zero-sized elements (display:none, or an unsized handle)', () => {
    expect(domHitRects([element(0, 0, 0, 0), element(10, 10, 20, 20)])).toEqual([rect(10, 10, 20, 20)])
  })

  it('accepts an ArrayLike (a NodeList) without iterating it', () => {
    expect(domHitRects({ 0: element(1, 2, 3, 4), length: 1 })).toEqual([rect(1, 2, 3, 4)])
  })
})
