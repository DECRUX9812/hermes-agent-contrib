import { describe, expect, it } from 'vitest'

import type { PaneAnchor } from '../protocol'

import {
  AVATAR_WIDTH_RATIO,
  boundingScreenRect,
  cameraDistance,
  computeSlotLayout,
  DOCK_MARGIN,
  dockRect,
  PX_PER_UNIT,
  screenToWorld,
  worldToScreen
} from './projection'

const VIEWPORT = { height: 1200, width: 2000 }

const desktopAnchor: PaneAnchor = { kind: 'desktop', label: '', rect: { height: 1200, width: 2000, x: 0, y: 0 } }

const browserAnchor: PaneAnchor = {
  kind: 'hermes-browser',
  label: 'Ada on X',
  rect: { height: 700, width: 1000, x: 400, y: 120 }
}

describe('pane geometry', () => {
  it('maps the viewport centre to the world origin and 1 unit to 120 px', () => {
    expect(screenToWorld({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 }, VIEWPORT)).toEqual({ x: 0, y: 0 })
    expect(screenToWorld({ x: VIEWPORT.width / 2 + PX_PER_UNIT, y: VIEWPORT.height / 2 }, VIEWPORT)).toEqual({
      x: 1,
      y: 0
    })
    // Screen y grows downward, world y grows up.
    expect(screenToWorld({ x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 - PX_PER_UNIT }, VIEWPORT)).toEqual({
      x: 0,
      y: 1
    })
    const point = { x: 1234, y: 987 }

    expect(worldToScreen(screenToWorld(point, VIEWPORT), VIEWPORT)).toEqual(point)
  })

  it('places the perspective camera so one world unit is 120 px at the perch line', () => {
    const distance = cameraDistance(VIEWPORT.height)
    const pixelsPerUnit = VIEWPORT.height / (2 * distance * Math.tan((30 * Math.PI) / 360))

    expect(pixelsPerUnit).toBeCloseTo(PX_PER_UNIT, 6)
    expect(cameraDistance(600)).toBeLessThan(distance)
  })

  it('floats a desktop avatar in the bottom-right, above the dock', () => {
    const dock = dockRect(1, VIEWPORT)

    const slots = computeSlotLayout({
      anchor: desktopAnchor,
      dock,
      heights: { muse: 1.1 } as never,
      ids: ['muse'],
      viewport: VIEWPORT
    })

    const slot = slots.muse
    const screen = worldToScreen({ x: slot.x, y: slot.y }, VIEWPORT)

    expect(screen.x).toBeGreaterThan(VIEWPORT.width * 0.6)
    expect(screen.x).toBeLessThan(VIEWPORT.width * 0.95)
    // Feet rest on the perch line, just above the dock.
    expect(screen.y).toBeGreaterThan(VIEWPORT.height * 0.6)
    expect(screen.y + (1.1 * PX_PER_UNIT) / 2).toBeLessThan(dock.y)
    expect(worldToScreen({ x: 0, y: slot.perchY }, VIEWPORT).y).toBeCloseTo(dock.y - 12, 6)
  })

  it('rests a real-anchor avatar on the anchor top edge', () => {
    const slots = computeSlotLayout({
      anchor: browserAnchor,
      dock: null,
      heights: { muse: 1.1 } as never,
      ids: ['muse'],
      viewport: VIEWPORT
    })

    const perchPx = worldToScreen({ x: 0, y: slots.muse.perchY }, VIEWPORT).y

    expect(perchPx).toBeCloseTo(browserAnchor.rect.y, 6)
    // Horizontally inside the anchor, on the right 80% mark.
    const centerX = worldToScreen({ x: slots.muse.x, y: 0 }, VIEWPORT).x

    expect(centerX).toBeGreaterThan(browserAnchor.rect.x + browserAnchor.rect.width * 0.6)
    expect(centerX).toBeLessThan(browserAnchor.rect.x + browserAnchor.rect.width)
  })

  it('spaces slots 1.5 avatar widths apart, right-to-left, and never overlaps', () => {
    const heights = { muse: 1.1, grok: 1.1 } as never
    const dock = dockRect(2, VIEWPORT)
    const slots = computeSlotLayout({ anchor: desktopAnchor, dock, heights, ids: ['muse', 'grok'], viewport: VIEWPORT })
    const muse = worldToScreen({ x: slots.muse.x, y: 0 }, VIEWPORT).x
    const grok = worldToScreen({ x: slots.grok.x, y: 0 }, VIEWPORT).x
    const widthPx = 1.1 * AVATAR_WIDTH_RATIO * PX_PER_UNIT

    // First listed is rightmost; the next sits 1.5 widths to its left.
    expect(muse).toBeGreaterThan(grok)
    expect(muse - grok).toBeCloseTo(widthPx * 1.5, 4)
    expect(muse - grok).toBeGreaterThan(widthPx)
  })

  it('keeps the dock inside the work area, bottom-right', () => {
    const dock = dockRect(1, VIEWPORT)

    expect(dock.x + dock.width).toBe(VIEWPORT.width - DOCK_MARGIN)
    expect(dock.y + dock.height).toBe(VIEWPORT.height - DOCK_MARGIN)
    expect(dock.x).toBeGreaterThan(VIEWPORT.width * 0.6)
  })

  it('unions projected points into a rect', () => {
    expect(
      boundingScreenRect([
        { x: 10, y: 20 },
        { x: 30, y: 5 },
        { x: 15, y: 40 }
      ])
    ).toEqual({ height: 35, width: 20, x: 10, y: 5 })
    expect(boundingScreenRect([])).toBeNull()
  })
})
