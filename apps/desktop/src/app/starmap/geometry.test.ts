import { describe, expect, it } from 'vitest'

import { TILT } from './constants'
import { centerOn, fitViewport } from './geometry'

// render.ts projects a world point as screen = world · k + vp, with the disk
// squashed by TILT. Fly-to is only correct if it inverts that exactly, so the
// test asserts the inverse rather than a hand-copied constant.
const project = (world: { x: number; y: number }, vp: { k: number; x: number; y: number }) => ({
  x: world.x * vp.k + vp.x,
  y: world.y * vp.k * TILT + vp.y
})

describe('centerOn', () => {
  it('puts the world point at the visual centre of the canvas', () => {
    const size = { h: 800, w: 1200 }
    const world = { x: 140, y: -60 }
    const vp = centerOn(world.x, world.y, size, 2)
    const screen = project(world, vp)

    expect(screen.x).toBeCloseTo(size.w / 2)
    // fitViewport biases the centre down by 5% so the timeline has room; the
    // fly-to keeps the same bias, so the node lands there and not under it.
    expect(screen.y).toBeCloseTo(size.h / 2 + size.h * 0.05)
  })

  it('round-trips through the projection for any zoom', () => {
    const size = { h: 600, w: 900 }

    for (const k of [0.25, 1, 1.5, 4]) {
      const vp = centerOn(-320, 410, size, k)
      const screen = project({ x: -320, y: 410 }, vp)

      expect(screen.x).toBeCloseTo(size.w / 2)
      expect(screen.y).toBeCloseTo(size.h / 2 + size.h * 0.05)
      expect(vp.k).toBe(k)
    }
  })

  it('falls back to a usable viewport when the size or zoom is not real yet', () => {
    // First paint: the wrapper has not been measured, and a resize can report 0.
    const unmeasured = centerOn(10, 10, { h: 0, w: 0 }, 1)
    expect(Number.isFinite(unmeasured.x)).toBe(true)
    expect(Number.isFinite(unmeasured.y)).toBe(true)

    const badZoom = centerOn(0, 0, { h: 100, w: 100 }, Number.NaN)
    expect(badZoom.k).toBe(1)

    const zeroZoom = centerOn(0, 0, { h: 100, w: 100 }, 0)
    expect(zeroZoom.k).toBe(1)
  })

  it('leaves fitViewport untouched (no regression to the resting view)', () => {
    const fitted = fitViewport(1200, 800, 300)

    expect(fitted.x).toBe(600)
    expect(fitted.y).toBe(800 / 2 + 800 * 0.05)
    expect(fitted.k).toBeGreaterThan(0)
  })
})
