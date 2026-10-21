import { describe, expect, it } from 'vitest'

import { scrubberFractionToScrollTop, scrubberMarkerFraction, scrubberViewportWindow } from './thread-timeline'

describe('thread scrubber math', () => {
  describe('scrubberMarkerFraction', () => {
    it('maps document offsets onto the 0..1 strip', () => {
      expect(scrubberMarkerFraction(0, 1000)).toBe(0)
      expect(scrubberMarkerFraction(500, 1000)).toBe(0.5)
      expect(scrubberMarkerFraction(1000, 1000)).toBe(1)
    })

    it('clamps markers past the document edges', () => {
      expect(scrubberMarkerFraction(-40, 1000)).toBe(0)
      expect(scrubberMarkerFraction(1400, 1000)).toBe(1)
    })

    it('degenerates to 0 on an empty or unmeasured document', () => {
      expect(scrubberMarkerFraction(100, 0)).toBe(0)
      expect(scrubberMarkerFraction(100, Number.NaN)).toBe(0)
    })
  })

  describe('scrubberFractionToScrollTop', () => {
    it('maps a strip fraction onto the scrollable range', () => {
      // scrollable range = scrollHeight - clientHeight.
      expect(scrubberFractionToScrollTop(0, 1000, 200)).toBe(0)
      expect(scrubberFractionToScrollTop(0.5, 1000, 200)).toBe(400)
      expect(scrubberFractionToScrollTop(1, 1000, 200)).toBe(800)
    })

    it('clamps out-of-range fractions', () => {
      expect(scrubberFractionToScrollTop(-0.5, 1000, 200)).toBe(0)
      expect(scrubberFractionToScrollTop(2, 1000, 200)).toBe(800)
    })

    it('never scrolls when the document fits the viewport', () => {
      expect(scrubberFractionToScrollTop(0.9, 200, 500)).toBe(0)
    })
  })

  describe('scrubberViewportWindow', () => {
    it('reports the visible band as fractions of the strip', () => {
      expect(scrubberViewportWindow(0, 1000, 200)).toEqual({ height: 0.2, top: 0 })
      expect(scrubberViewportWindow(400, 1000, 200)).toEqual({ height: 0.2, top: 0.4 })
      expect(scrubberViewportWindow(800, 1000, 200)).toEqual({ height: 0.2, top: 0.8 })
    })

    it('fills the strip when the document fits the viewport', () => {
      expect(scrubberViewportWindow(0, 150, 500)).toEqual({ height: 1, top: 0 })
      expect(scrubberViewportWindow(0, 0, 500)).toEqual({ height: 1, top: 0 })
    })
  })
})
