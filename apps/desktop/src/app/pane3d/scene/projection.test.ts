import { describe, expect, it } from 'vitest'

import type { AvatarId, PaneAnchor } from '../protocol'

import {
  AVATAR_WIDTH_RATIO,
  avatarFrames,
  boundingScreenRect,
  cameraDistance,
  collectHitParts,
  computeSlotLayout,
  DOCK_MARGIN,
  dockRect,
  effectivePerchPx,
  type HitPartNode,
  PERCH_HEADROOM_CLEARANCE_PX,
  PERCH_HEADROOM_MARGIN_PX,
  PERCH_INSET,
  perchHeadroomFloor,
  PX_PER_UNIT,
  reservedSlotRect,
  resetAvatarFrame,
  screenToWorld,
  SLOT_WIDTH_MARGIN,
  unionScreenRects,
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

  it('rests a real-anchor avatar on the anchor top edge when there is headroom', () => {
    const roomy: PaneAnchor = { ...browserAnchor, rect: { ...browserAnchor.rect, y: 400 } }

    const slots = computeSlotLayout({
      anchor: roomy,
      dock: null,
      heights: { muse: 1.1 } as never,
      ids: ['muse'],
      viewport: VIEWPORT
    })

    const perchPx = worldToScreen({ x: 0, y: slots.muse.perchY }, VIEWPORT).y

    expect(perchPx).toBeCloseTo(roomy.rect.y, 6)
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
    // The budgeted width includes the perspective margin the layout applies.
    const widthPx = 1.1 * AVATAR_WIDTH_RATIO * SLOT_WIDTH_MARGIN * PX_PER_UNIT

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

/** Real cast sizes (avatar definitions) — the layout must hold for these. */
const CAST_HEIGHTS: Record<AvatarId, number> = { claude: 1.23, grok: 0.95, hermes: 1.08, muse: 1.1, opencode: 0.8 }
const CAST_WIDTHS: Record<AvatarId, number> = { claude: 0.74, grok: 0.7, hermes: 1.22, muse: 1.35, opencode: 0.8 }
const CAST_IDS: AvatarId[] = ['muse', 'hermes', 'grok', 'opencode', 'claude']

/** Pane-px horizontal spans of a laid-out row, right-to-left as listed. */
function rowSpans(ids: AvatarId[], slots: ReturnType<typeof computeSlotLayout>) {
  return ids.map(id => {
    const center = worldToScreen({ x: slots[id].x, y: 0 }, VIEWPORT).x
    const width = CAST_WIDTHS[id] * SLOT_WIDTH_MARGIN * PX_PER_UNIT

    return { center, left: center - width / 2, right: center + width / 2 }
  })
}

describe('perch row layout (VAL-ROOM-003)', () => {
  for (const count of [2, 3, 5]) {
    it(`keeps ${count} avatars non-overlapping on the perch line`, () => {
      const ids = CAST_IDS.slice(0, count)

      const slots = computeSlotLayout({
        anchor: browserAnchor,
        dock: null,
        heights: CAST_HEIGHTS,
        ids,
        viewport: VIEWPORT,
        widths: CAST_WIDTHS
      })

      const spans = rowSpans(ids, slots)

      for (let index = 1; index < spans.length; index += 1) {
        expect(spans[index - 1].left, `${count} avatars: slot ${index - 1}/${index} gap`).toBeGreaterThan(
          spans[index].right
        )
      }

      // Every slot rests on the effective perch line (one shared line; a high
      // anchor is lowered by the headroom floor — VAL-ANCHOR-006).
      const perch = ids.map(id => worldToScreen({ x: 0, y: slots[id].perchY }, VIEWPORT).y)
      const tallestPx = Math.max(...ids.map(id => CAST_HEIGHTS[id])) * PX_PER_UNIT

      expect(new Set(perch).size).toBe(1)
      expect(perch[0]).toBeCloseTo(effectivePerchPx(browserAnchor.rect.y, tallestPx), 6)
    })

    it(`keeps ${count} avatars non-overlapping on the desktop row`, () => {
      const ids = CAST_IDS.slice(0, count)
      const dock = dockRect(count, VIEWPORT)

      const slots = computeSlotLayout({
        anchor: desktopAnchor,
        dock,
        heights: CAST_HEIGHTS,
        ids,
        viewport: VIEWPORT,
        widths: CAST_WIDTHS
      })

      const spans = rowSpans(ids, slots)

      for (let index = 1; index < spans.length; index += 1) {
        expect(spans[index - 1].left, `desktop ${count} avatars: slot ${index - 1}/${index} gap`).toBeGreaterThan(
          spans[index].right
        )
      }

      // Inside the work area and above the dock.
      expect(Math.min(...spans.map(span => span.left))).toBeGreaterThanOrEqual(0)
      expect(Math.max(...spans.map(span => span.right))).toBeLessThanOrEqual(VIEWPORT.width)

      for (const id of ids) {
        const feet = worldToScreen({ x: slots[id].x, y: slots[id].perchY }, VIEWPORT).y

        expect(feet).toBeLessThan(dock.y)
      }
    })
  }

  it('still never overlaps when the row is wider than a narrow anchor', () => {
    const narrow: PaneAnchor = {
      kind: 'hermes-browser',
      label: 'narrow',
      rect: { height: 500, width: 320, x: 100, y: 200 }
    }

    const ids = CAST_IDS

    const slots = computeSlotLayout({
      anchor: narrow,
      dock: null,
      heights: CAST_HEIGHTS,
      ids,
      viewport: VIEWPORT,
      widths: CAST_WIDTHS
    })

    const spans = rowSpans(ids, slots)

    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index - 1].left).toBeGreaterThan(spans[index].right)
    }

    // The row as a whole is shifted to stay inside the work area.
    expect(Math.min(...spans.map(span => span.left))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...spans.map(span => span.right))).toBeLessThanOrEqual(VIEWPORT.width)
  })
})

describe('perch headroom floor (VAL-ANCHOR-006)', () => {
  const highAnchor: PaneAnchor = {
    kind: 'hermes-browser',
    label: 'maximized',
    rect: { height: 700, width: 1600, x: 160, y: 68 }
  }

  it('is the tallest body plus the card/bubble clearance and the small margin', () => {
    expect(perchHeadroomFloor(CAST_HEIGHTS.claude * PX_PER_UNIT)).toBeCloseTo(
      CAST_HEIGHTS.claude * PX_PER_UNIT + PERCH_HEADROOM_CLEARANCE_PX + PERCH_HEADROOM_MARGIN_PX,
      6
    )
    expect(perchHeadroomFloor(0)).toBe(PERCH_HEADROOM_CLEARANCE_PX + PERCH_HEADROOM_MARGIN_PX)
  })

  it('returns the anchor top unchanged when there is ample headroom', () => {
    expect(effectivePerchPx(400, CAST_HEIGHTS.muse * PX_PER_UNIT)).toBe(400)
  })

  it('lowers a 68 px anchor top so the tallest visible body plus clearance stays inside the pane', () => {
    const perch = effectivePerchPx(highAnchor.rect.y, CAST_HEIGHTS.claude * PX_PER_UNIT)

    expect(perch).toBeGreaterThan(highAnchor.rect.y)
    // The crown of the tallest body sits below the pane top with the margin to spare.
    expect(perch - CAST_HEIGHTS.claude * PX_PER_UNIT).toBeGreaterThanOrEqual(PERCH_HEADROOM_MARGIN_PX)
  })

  it('keeps the whole visible cast on one lowered line, crowns on screen', () => {
    const ids: AvatarId[] = ['muse', 'grok', 'claude']

    const slots = computeSlotLayout({
      anchor: highAnchor,
      dock: null,
      heights: CAST_HEIGHTS,
      ids,
      viewport: VIEWPORT,
      widths: CAST_WIDTHS
    })

    const perch = ids.map(id => worldToScreen({ x: 0, y: slots[id].perchY }, VIEWPORT).y)

    expect(new Set(perch).size).toBe(1)
    expect(perch[0]).toBeCloseTo(effectivePerchPx(highAnchor.rect.y, CAST_HEIGHTS.claude * PX_PER_UNIT), 6)

    for (const id of ids) {
      // Every rendered body's top edge is inside the pane (screenRect.top >= 0).
      expect(perch[0] - CAST_HEIGHTS[id] * PX_PER_UNIT, `${id} crown`).toBeGreaterThanOrEqual(0)
    }
  })

  it('uses the tallest VISIBLE body, so a shorter cast perches no lower than it must', () => {
    const slots = computeSlotLayout({
      anchor: highAnchor,
      dock: null,
      heights: CAST_HEIGHTS,
      ids: ['grok'],
      viewport: VIEWPORT,
      widths: CAST_WIDTHS
    })

    const perch = worldToScreen({ x: 0, y: slots.grok.perchY }, VIEWPORT).y

    expect(perch).toBeCloseTo(effectivePerchPx(highAnchor.rect.y, CAST_HEIGHTS.grok * PX_PER_UNIT), 6)
    expect(perch).toBeLessThan(effectivePerchPx(highAnchor.rect.y, CAST_HEIGHTS.claude * PX_PER_UNIT))
  })

  it('leaves the desktop anchor floating above the dock', () => {
    const dock = dockRect(1, VIEWPORT)

    const slots = computeSlotLayout({
      anchor: desktopAnchor,
      dock,
      heights: { muse: CAST_HEIGHTS.muse } as never,
      ids: ['muse'],
      viewport: VIEWPORT
    })

    expect(worldToScreen({ x: 0, y: slots.muse.perchY }, VIEWPORT).y).toBeCloseTo(dock.y - PERCH_INSET, 6)
  })
})

describe('collectHitParts', () => {
  const node = (hitPart = false, children: HitPartNode[] = []): HitPartNode => ({
    children,
    userData: hitPart ? { hitPart: true } : {}
  })

  it('collects the outermost flagged objects and stops descending', () => {
    const group = node(true, [node(true), node(true)])
    const root = node(false, [node(false, [node(true)]), group, node(false, [node(true, [node(true)])])])
    const parts = collectHitParts(root)

    // One leaf above the group, the group itself, and one leaf below it: the
    // flagging group covers its subtree without counting its children.
    expect(parts).toHaveLength(3)
    expect(parts).toContain(group)
  })

  it('returns nothing when no part is flagged', () => {
    expect(collectHitParts(node(false, [node(false)]))).toEqual([])
  })
})

describe('avatar frame', () => {
  it('resets to no projected hit rects, so a hidden avatar claims no region', () => {
    avatarFrames.muse.hitRects = [{ height: 10, width: 10, x: 0, y: 0 }]
    resetAvatarFrame('muse')

    expect(avatarFrames.muse.hitRects).toEqual([])
    expect(avatarFrames.muse.screenRect).toBeNull()
  })
})

describe('reservedSlotRect — the space the row reserves for an avatar at rest (VAL-NOTIFY-007)', () => {
  const slots = computeSlotLayout({
    anchor: browserAnchor,
    dock: null,
    heights: { muse: 1.1 } as never,
    ids: ['muse'],
    viewport: VIEWPORT
  })

  it('rests the rect on the perch line, centred on the slot, sized to the budgeted silhouette', () => {
    const rect = reservedSlotRect(slots.muse, { height: 1.1, width: 1.35 }, VIEWPORT)
    const perch = worldToScreen({ x: 0, y: slots.muse.perchY }, VIEWPORT).y
    const center = worldToScreen({ x: slots.muse.x, y: 0 }, VIEWPORT).x

    expect(rect.y + rect.height).toBeCloseTo(perch, 6)
    expect(rect.x + rect.width / 2).toBeCloseTo(center, 6)
    expect(rect.height).toBeCloseTo(1.1 * PX_PER_UNIT, 6)
    expect(rect.width).toBeCloseTo(1.35 * SLOT_WIDTH_MARGIN * PX_PER_UNIT, 6)
  })

  it('falls back to the body ratio when the definition declares no width', () => {
    const rect = reservedSlotRect(slots.muse, { height: 1.1 }, VIEWPORT)

    expect(rect.width).toBeCloseTo(1.1 * AVATAR_WIDTH_RATIO * SLOT_WIDTH_MARGIN * PX_PER_UNIT, 6)
  })
})

describe('unionScreenRects — the space an emerging avatar occupies now and next', () => {
  it('is the bounding box of two rects', () => {
    expect(unionScreenRects({ height: 10, width: 10, x: 0, y: 0 }, { height: 10, width: 10, x: 20, y: 30 })).toEqual({
      height: 40,
      width: 30,
      x: 0,
      y: 0
    })
  })

  it('is the identity when one rect already contains the other', () => {
    const perch = { height: 100, width: 100, x: 0, y: 0 }

    expect(unionScreenRects(perch, { height: 10, width: 10, x: 10, y: 10 })).toEqual(perch)
    expect(unionScreenRects({ height: 10, width: 10, x: 10, y: 10 }, perch)).toEqual(perch)
  })
})
