import { describe, expect, it } from 'vitest'

import {
  arrowHeadPoints,
  beginStroke,
  extendStroke,
  fitInside,
  normalizeRegionDrag,
  REGION_MIN_EDGE
} from './region-capture'

describe('normalizeRegionDrag', () => {
  it('normalizes any drag direction into a top-left rect', () => {
    expect(normalizeRegionDrag(100, 80, 40, 20, 500, 400)).toEqual({ height: 60, width: 60, x: 40, y: 20 })
    expect(normalizeRegionDrag(40, 20, 100, 80, 500, 400)).toEqual({ height: 60, width: 60, x: 40, y: 20 })
  })

  it('clamps to the frame and rejects sub-threshold drags', () => {
    expect(normalizeRegionDrag(-10, -10, 600, 500, 500, 400)).toEqual({ height: 400, width: 500, x: 0, y: 0 })
    expect(normalizeRegionDrag(10, 10, 10 + REGION_MIN_EDGE - 1, 90, 500, 400)).toBeNull()
    expect(normalizeRegionDrag(10, 10, 90, 10 + REGION_MIN_EDGE - 1, 500, 400)).toBeNull()
  })
})

describe('fitInside', () => {
  it('scales to the limiting dimension and keeps aspect', () => {
    expect(fitInside(200, 100, 100, 100)).toEqual({ height: 50, scale: 0.5, width: 100 })
    expect(fitInside(100, 200, 100, 100)).toEqual({ height: 100, scale: 0.5, width: 50 })
    expect(fitInside(50, 50, 100, 100)).toEqual({ height: 100, scale: 2, width: 100 })
  })

  it('returns zeroes for degenerate inputs', () => {
    expect(fitInside(0, 100, 100, 100).scale).toBe(0)
    expect(fitInside(100, 100, 0, 100).scale).toBe(0)
  })
})

describe('strokes', () => {
  const region = { height: 100, width: 100, x: 0, y: 0 }

  it('pen accumulates points and drops sub-pixel moves', () => {
    let stroke = beginStroke('pen', [0, 0], '#fff')
    stroke = extendStroke(stroke, [0.5, 0.5], region)
    expect(stroke.type === 'pen' && stroke.points.length).toBe(1)

    stroke = extendStroke(stroke, [20, 20], region)
    expect(stroke.type === 'pen' && stroke.points.length).toBe(2)
  })

  it('rect tracks the drag inside region bounds', () => {
    let stroke = beginStroke('rect', [10, 10], '#fff')
    stroke = extendStroke(stroke, [200, 50], region)

    expect(stroke.type === 'rect' && stroke.rect).toEqual({ height: 40, width: 90, x: 10, y: 10 })
  })

  it('arrow records endpoints clamped to the region', () => {
    let stroke = beginStroke('arrow', [10, 10], '#fff')
    stroke = extendStroke(stroke, [150, 150], region)

    expect(stroke.type === 'arrow' && stroke.to).toEqual([100, 100])
  })
})

describe('arrowHeadPoints', () => {
  it('returns tip + two wings for a drawable arrow', () => {
    const head = arrowHeadPoints([0, 0], [100, 0], 12)

    expect(head).not.toBeNull()
    expect(head![0]).toEqual([100, 0])
    // Wings sit behind the tip on the shaft axis.
    expect(head![1][0]).toBeLessThan(100)
    expect(head![2][0]).toBeLessThan(100)
    // Mirrored across the shaft.
    expect(head![1][1]).toBeCloseTo(-head![2][1])
  })

  it('returns null when the shaft is shorter than the head', () => {
    expect(arrowHeadPoints([0, 0], [5, 0], 12)).toBeNull()
  })
})
