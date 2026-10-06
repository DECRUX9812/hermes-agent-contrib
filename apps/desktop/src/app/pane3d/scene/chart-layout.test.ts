/**
 * Contract tests for the Chart3D geometry and placement (architecture §8.9).
 *
 * The chart is presented BESIDE the avatar row, on the side of the pane with
 * more room, and it must fit inside the pane whatever the anchor edge does:
 * these tests pin the bar spread, the board size, the side choice, the vertical
 * fit, and the whole placement the stage renders from.
 */

import { describe, expect, it } from 'vitest'

import type { AvatarId, PaneAnchor } from '../protocol'

import {
  barColumnX,
  CHART_BAR_WIDTH,
  CHART_BOARD_HEIGHT,
  CHART_COLUMN_PITCH,
  CHART_GAP_PX,
  CHART_LABEL_GUTTER_PX,
  CHART_LIFT,
  CHART_MIN_FIT,
  CHART_MIN_FIT_X,
  CHART_PLINTH_HEIGHT,
  CHART_TITLE_GUTTER_PX,
  CHART_TOP_MARGIN_PX,
  CHART_X_LABEL_BOX_PX,
  CHART_X_LABEL_GAP_PX,
  CHART_X_LABEL_GUTTER_PX,
  CHART_X_LABEL_STRIP_PX,
  chartBarSpan,
  chartBoardWidth,
  chartFit,
  chartPanelRect,
  chartPlacement,
  chartViewFor,
  chartXLabelBoxes
} from './chart-layout'
import { CHART_MAX_BAR_HEIGHT } from './chart-scale'
import {
  computeSlotLayout,
  PX_PER_UNIT,
  reservedSlotRect,
  screenToWorld,
  unionScreenRects,
  worldToScreen
} from './projection'

const VIEWPORT = { height: 1080, width: 1920 }

/** The real registered silhouettes, in `AVATAR_IDS` order. */
const SILHOUETTES = [
  { height: 1.1, id: 'muse' as const, width: 1.35 },
  { height: 1.08, id: 'hermes' as const, width: 1.22 },
  { height: 0.95, id: 'grok' as const, width: 0.7 },
  { height: 0.8, id: 'opencode' as const, width: 0.8 },
  { height: 1.23, id: 'claude' as const, width: 0.74 }
] as const

/** The visible cast's real perch row, exactly as `Stage` derives it for a desktop anchor. */
function castLayout(ids: AvatarId[], viewport: { height: number; width: number }) {
  const heights = Object.fromEntries(SILHOUETTES.map(size => [size.id, size.height])) as Record<AvatarId, number>
  const widths = Object.fromEntries(SILHOUETTES.map(size => [size.id, size.width])) as Partial<Record<AvatarId, number>>

  const slots = computeSlotLayout({
    anchor: { kind: 'desktop', label: '', rect: { height: viewport.height, width: viewport.width, x: 0, y: 0 } },
    dock: null,
    heights,
    ids,
    viewport,
    widths
  })

  const avatars = Object.fromEntries(ids.map(id => [id, { visible: true }]))

  const row = ids
    .map(id => reservedSlotRect(slots[id], { height: heights[id], width: widths[id] }, viewport))
    .reduce(unionScreenRects)

  return { avatars, definitions: SILHOUETTES, row, slots, viewport }
}

/** The chart panel's pane-CSS-px box, from the same numbers the stage renders from. */
function panelBox(centerX: number, fitX: number) {
  const half = (chartBoardWidth(8) * PX_PER_UNIT * fitX) / 2

  return { left: centerX - half - CHART_LABEL_GUTTER_PX, right: centerX + half }
}

describe('X-label gutter', () => {
  it('is exactly the plinth + gap + strip, so the strip clears the plinth', () => {
    // The strip's top edge sits at board base + plinth + gap; the gutter is the
    // panel's room below the board. If the two disagree the strip grazes the
    // plinth (measured live) or overflows the panel's hit box.
    expect(CHART_X_LABEL_GUTTER_PX).toBe(
      CHART_PLINTH_HEIGHT * PX_PER_UNIT + CHART_X_LABEL_GAP_PX + CHART_X_LABEL_STRIP_PX
    )
    expect(CHART_X_LABEL_GAP_PX).toBeGreaterThan(0)
    expect(CHART_X_LABEL_STRIP_PX).toBeGreaterThanOrEqual(12)
  })
})

describe('bar columns', () => {
  it('spreads the bars symmetrically about the board centre', () => {
    expect(barColumnX(0, 8)).toBeCloseTo(-1.05)
    expect(barColumnX(7, 8)).toBeCloseTo(1.05)
    expect(barColumnX(3, 8) + barColumnX(4, 8)).toBeCloseTo(0)
  })

  it('centres a single bar', () => {
    expect(barColumnX(0, 1)).toBe(0)
  })

  it('sizes the board wider than the bar span', () => {
    expect(chartBarSpan(8)).toBeCloseTo(2.3)
    expect(chartBoardWidth(8)).toBeCloseTo(2.9)
    expect(chartBoardWidth(8)).toBeGreaterThan(chartBarSpan(8))
  })

  it('makes the board the axis span, so a bar at the top tick reaches the top gridline', () => {
    // The gridlines and the Y ticks are drawn against the board; if the board
    // were taller than the bar area the bars would float under their own axis.
    expect(CHART_BOARD_HEIGHT).toBe(CHART_MAX_BAR_HEIGHT)
  })

  it('gives every bar its own hover strip, tiled across the row', () => {
    // One strip per column, exactly one pitch wide: neighbouring strips meet at
    // their edges (no dead gap between bars) and each strip covers its bar.
    expect(CHART_COLUMN_PITCH).toBeGreaterThan(CHART_BAR_WIDTH)
    expect(barColumnX(1, 8) - barColumnX(0, 8)).toBeCloseTo(CHART_COLUMN_PITCH)
    expect(barColumnX(7, 8) + CHART_COLUMN_PITCH / 2).toBeGreaterThanOrEqual(chartBarSpan(8) / 2)
  })
})

describe('chartPlacement', () => {
  it('places the chart on the side of the row with more room', () => {
    // The row hugs the right of the pane, so the room is on its left.
    const placement = chartPlacement({
      boardWidthPx: 348,
      row: { height: 130, width: 400, x: 860, y: 0 },
      viewport: VIEWPORT
    })

    expect(placement.side).toBe('left')
    expect(placement.centerX).toBeCloseTo(860 - 60 - 174)
  })

  it('flips to the right when the row sits on the left', () => {
    const placement = chartPlacement({
      boardWidthPx: 348,
      row: { height: 130, width: 400, x: 200, y: 0 },
      viewport: VIEWPORT
    })

    expect(placement.side).toBe('right')
    expect(placement.centerX).toBeCloseTo(600 + 60 + 174)
  })

  it('keeps the whole panel inside the pane when the row fills it', () => {
    const placement = chartPlacement({
      boardWidthPx: 348,
      row: { height: 130, width: 1900, x: 0, y: 0 },
      viewport: VIEWPORT
    })

    const panel = panelBox(placement.centerX, placement.fitX)

    expect(panel.left).toBeGreaterThanOrEqual(0)
    expect(panel.right).toBeLessThanOrEqual(VIEWPORT.width)
  })

  it('centres a board wider than the viewport instead of hanging it off an edge', () => {
    const placement = chartPlacement({
      boardWidthPx: 500,
      row: { height: 130, width: 100, x: 0, y: 0 },
      viewport: { height: 1080, width: 300 }
    })

    expect(placement.centerX).toBe(150)
  })
})

describe('chartPlacement on realistic narrow panes', () => {
  it('clamps the complete label panel inside the pane, gutter included', () => {
    // 1366 px with three avatars: the unclamped centre (175.55) is below the
    // panel's own floor (16 + 40 + 174 = 230), so the clamp decides. It must
    // account for the Y gutter, or the ticks start at x = -24 (the round-1 bug).
    const layout = castLayout(['muse', 'hermes', 'grok'], { height: 800, width: 1366 })

    const view = chartViewFor({
      avatars: layout.avatars,
      chart: { avatar: 'muse', series: 8 },
      definitions: layout.definitions,
      slots: layout.slots,
      viewport: layout.viewport
    })

    expect(view).not.toBeNull()
    expect(
      panelBox(worldToScreen({ x: view!.position.x, y: 0 }, layout.viewport).x, view!.fitX).left
    ).toBeGreaterThanOrEqual(0)
  })

  it('keeps the whole panel inside the pane and off the row at laptop widths with three avatars', () => {
    for (const width of [1280, 1366, 1440, 1536, 1600]) {
      const layout = castLayout(['muse', 'hermes', 'grok'], { height: 800, width })

      const view = chartViewFor({
        avatars: layout.avatars,
        chart: { avatar: 'muse', series: 8 },
        definitions: layout.definitions,
        slots: layout.slots,
        viewport: layout.viewport
      })

      expect(view).not.toBeNull()
      expect(view!.fitX).toBeGreaterThanOrEqual(CHART_MIN_FIT_X)
      expect(view!.fitX).toBeLessThanOrEqual(1)

      const panel = panelBox(worldToScreen({ x: view!.position.x, y: 0 }, layout.viewport).x, view!.fitX)

      expect(panel.left).toBeGreaterThanOrEqual(0)
      expect(panel.right).toBeLessThanOrEqual(width)
      // The panel clears the row on one side: no intersection at all.
      expect(panel.right <= layout.row.x || panel.left >= layout.row.x + layout.row.width).toBe(true)
    }
  })

  it('keeps the whole panel inside the pane and off the row with four avatars at 1422', () => {
    const layout = castLayout(['muse', 'hermes', 'grok', 'opencode'], { height: 800, width: 1422 })

    const view = chartViewFor({
      avatars: layout.avatars,
      chart: { avatar: 'muse', series: 8 },
      definitions: layout.definitions,
      slots: layout.slots,
      viewport: layout.viewport
    })

    expect(view).not.toBeNull()

    const panel = panelBox(worldToScreen({ x: view!.position.x, y: 0 }, layout.viewport).x, view!.fitX)

    expect(panel.left).toBeGreaterThanOrEqual(0)
    expect(panel.right).toBeLessThanOrEqual(1422)
    expect(panel.right <= layout.row.x || panel.left >= layout.row.x + layout.row.width).toBe(true)
  })

  it('leaves the two-avatar launch-demo layout at 1920x1080 unchanged', () => {
    const viewport = { height: 1080, width: 1920 }
    const layout = castLayout(['muse', 'grok'], viewport)

    const view = chartViewFor({
      avatars: layout.avatars,
      chart: { avatar: 'muse', series: 8 },
      definitions: layout.definitions,
      slots: layout.slots,
      viewport
    })

    expect(view).not.toBeNull()
    // Full size, same side, same centre as before the clamp learned the gutter.
    expect(view!.fitX).toBe(1)
    expect(view!.side).toBe('left')
    expect(worldToScreen({ x: view!.position.x, y: 0 }, viewport).x).toBeCloseTo(
      layout.row.x - CHART_GAP_PX - (chartBoardWidth(8) * PX_PER_UNIT) / 2
    )
  })

  it('does not shrink the board when the pane has room', () => {
    const layout = castLayout(['muse', 'hermes', 'grok'], { height: 800, width: 1600 })

    const view = chartViewFor({
      avatars: layout.avatars,
      chart: { avatar: 'muse', series: 8 },
      definitions: layout.definitions,
      slots: layout.slots,
      viewport: layout.viewport
    })

    expect(view!.fitX).toBe(1)
  })
})

describe('chartFit', () => {
  it('is full size when the perch line has room above it', () => {
    expect(chartFit(600)).toBe(1)
  })

  it('shrinks the board so the whole panel clears the pane top', () => {
    const perchY = 130
    const fit = chartFit(perchY)

    expect(fit).toBeLessThan(1)
    expect(fit).toBeGreaterThanOrEqual(CHART_MIN_FIT)

    const used =
      CHART_TOP_MARGIN_PX +
      CHART_LIFT * PX_PER_UNIT +
      CHART_TITLE_GUTTER_PX +
      CHART_X_LABEL_GUTTER_PX +
      CHART_BOARD_HEIGHT * PX_PER_UNIT * fit

    expect(used).toBeLessThanOrEqual(perchY + 0.001)
  })

  it('never shrinks below the floor', () => {
    expect(chartFit(20)).toBe(CHART_MIN_FIT)
  })
})

describe('chartViewFor', () => {
  // The validation host's layout: the in-app browser's top edge at y 176.
  const PERCH_Y = screenToWorld({ x: 0, y: 176 }, VIEWPORT).y
  const MUSE = { height: 1.1, id: 'muse' as const, width: 1.35 }
  const SLOTS = { muse: { perchY: PERCH_Y, x: 1.5, y: PERCH_Y + 0.55 } }

  it('places the board beside the row, on the roomier side, sitting on the perch line', () => {
    const view = chartViewFor({
      avatars: { muse: { visible: true } },
      chart: { avatar: 'muse', series: 8 },
      definitions: [MUSE],
      slots: SLOTS,
      viewport: VIEWPORT
    })

    expect(view).not.toBeNull()
    expect(view?.side).toBe('left')
    expect(view?.position.y).toBeCloseTo(PERCH_Y + CHART_LIFT)
    // 1038.75 (reserved left edge) - 60 (gap) - 174 (half a 2.9-unit board).
    expect(view?.position.x).toBeCloseTo((1038.75 - 60 - 174 - 960) / PX_PER_UNIT)
  })

  it('keeps the whole panel inside the pane at the validation host perch line', () => {
    const view = chartViewFor({
      avatars: { muse: { visible: true } },
      chart: { avatar: 'muse', series: 8 },
      definitions: [MUSE],
      slots: SLOTS,
      viewport: VIEWPORT
    })

    // The panel's top edge (title above the board) must not leave the pane.
    const panelTopPx = view!.position.y * -1 + VIEWPORT.height / 2 - CHART_LIFT * PX_PER_UNIT - CHART_TITLE_GUTTER_PX

    expect(view?.fit).toBeLessThanOrEqual(1)
    expect(view?.fit).toBeGreaterThanOrEqual(CHART_MIN_FIT)
    expect(panelTopPx).toBeGreaterThanOrEqual(0)
  })

  it('keeps the whole panel inside the pane when the anchor is high (VAL-ANCHOR-006)', () => {
    // A maximized main window docks the browser page ~68 px below the pane top.
    const high: PaneAnchor = {
      kind: 'hermes-browser',
      label: 'maximized',
      rect: { height: 800, width: 1920, x: 0, y: 68 }
    }

    const heights = Object.fromEntries(SILHOUETTES.map(size => [size.id, size.height])) as Record<AvatarId, number>

    const widths = Object.fromEntries(SILHOUETTES.map(size => [size.id, size.width])) as Partial<
      Record<AvatarId, number>
    >

    const ids: AvatarId[] = ['muse', 'grok']
    const slots = computeSlotLayout({ anchor: high, dock: null, heights, ids, viewport: VIEWPORT, widths })

    const view = chartViewFor({
      avatars: { muse: { visible: true }, grok: { visible: true } },
      chart: { avatar: 'muse', series: 8 },
      definitions: SILHOUETTES,
      slots,
      viewport: VIEWPORT
    })

    expect(view).not.toBeNull()
    // The headroom floor lowered the perch line, so the FULL-size board and its
    // title clear the pane top instead of clipping (the round-1 blocker).
    expect(view!.fit).toBe(1)
    const perchPx = worldToScreen({ x: 0, y: slots.muse.perchY }, VIEWPORT).y

    const panelTopPx =
      perchPx - CHART_LIFT * PX_PER_UNIT - CHART_TITLE_GUTTER_PX - CHART_BOARD_HEIGHT * PX_PER_UNIT * view!.fit

    expect(panelTopPx).toBeGreaterThanOrEqual(0)
    const panel = panelBox(worldToScreen({ x: view!.position.x, y: 0 }, VIEWPORT).x, view!.fitX)

    expect(panel.left).toBeGreaterThanOrEqual(0)
    expect(panel.right).toBeLessThanOrEqual(VIEWPORT.width)
  })

  it('returns null when nothing is presented, or the presenting avatar left the stage', () => {
    const base = { avatars: { muse: { visible: true } }, definitions: [MUSE], slots: SLOTS, viewport: VIEWPORT }

    expect(chartViewFor({ ...base, chart: null })).toBeNull()
    expect(
      chartViewFor({ ...base, chart: { avatar: 'muse', series: 8 }, avatars: { muse: { visible: false } } })
    ).toBeNull()
    expect(chartViewFor({ ...base, chart: { avatar: 'grok', series: 8 } })).toBeNull()
  })
})

describe('chartPanelRect — the DOM label panel box (VAL-CHART-005)', () => {
  // The live pane at 1920x1080 (main-window zoom 0.9): 2132x1198 CSS px.
  const PANE = { height: 1198, width: 2132 }

  const HIGH_ANCHOR: PaneAnchor = {
    kind: 'hermes-browser',
    label: 'maximized',
    rect: { height: 800, width: PANE.width, x: 0, y: 68 }
  }

  function highAnchorView() {
    const heights = Object.fromEntries(SILHOUETTES.map(size => [size.id, size.height])) as Record<AvatarId, number>

    const widths = Object.fromEntries(SILHOUETTES.map(size => [size.id, size.width])) as Partial<
      Record<AvatarId, number>
    >

    const ids: AvatarId[] = ['muse', 'grok']
    const slots = computeSlotLayout({ anchor: HIGH_ANCHOR, dock: null, heights, ids, viewport: PANE, widths })

    return chartViewFor({
      avatars: { grok: { visible: true }, muse: { visible: true } },
      chart: { avatar: 'grok', series: 8 },
      definitions: SILHOUETTES,
      slots,
      viewport: PANE
    })
  }

  it('is the board plus the title strip, the Y gutter and the X-label strip', () => {
    const position = { x: -0.026, y: 3.685 }
    const panel = chartPanelRect({ fit: 1, fitX: 1, position, series: 8, viewport: VIEWPORT })
    const boardWpx = chartBoardWidth(8) * PX_PER_UNIT
    const boardHpx = CHART_BOARD_HEIGHT * PX_PER_UNIT
    const centerX = worldToScreen(position, VIEWPORT).x
    const boardTopPx = worldToScreen({ x: 0, y: position.y + boardHpx / PX_PER_UNIT }, VIEWPORT).y

    expect(panel.width).toBeCloseTo(boardWpx + CHART_LABEL_GUTTER_PX)
    expect(panel.height).toBeCloseTo(CHART_TITLE_GUTTER_PX + boardHpx + CHART_X_LABEL_GUTTER_PX)
    expect(panel.x).toBeCloseTo(centerX - boardWpx / 2 - CHART_LABEL_GUTTER_PX)
    // The title strip sits a title gutter above the board's top edge.
    expect(panel.y).toBeCloseTo(boardTopPx - CHART_TITLE_GUTTER_PX)
  })

  it('is the same box chartViewFor reports, from the numbers that place the board', () => {
    const view = highAnchorView()

    expect(view).not.toBeNull()
    expect(view!.panel).toEqual(
      chartPanelRect({ fit: view!.fit, fitX: view!.fitX, position: view!.position, series: 8, viewport: PANE })
    )
    // The panel measured live at the maximized perch: 388 wide, ~126 tall at y ~52.
    expect(view!.panel.width).toBeCloseTo(388)
    expect(view!.panel.height).toBeCloseTo(126.4)
    expect(view!.panel.y).toBeCloseTo(52.4, 0)
    expect(view!.panel.y).toBeGreaterThanOrEqual(0)
    expect(view!.panel.y + view!.panel.height).toBeLessThanOrEqual(PANE.height)
  })
})

describe('chartXLabelBoxes — the X labels on a compressed board (round-2 fix)', () => {
  /**
   * The real four-avatar narrow pane: `Chart3D` squeezes the whole board (bars
   * included) by `fitX`, so the label offset must carry the SAME factor. With an
   * unscaled offset every label drifts off its column and the outermost box
   * lands past the pane edge, even though the panel's own box is clamped inside.
   */
  it('centres every label on its compressed bar, inside the 1422 px pane', () => {
    const layout = castLayout(['muse', 'hermes', 'grok', 'opencode'], { height: 800, width: 1422 })

    const view = chartViewFor({
      avatars: layout.avatars,
      chart: { avatar: 'muse', series: 8 },
      definitions: layout.definitions,
      slots: layout.slots,
      viewport: layout.viewport
    })!

    expect(view).not.toBeNull()
    expect(view.fitX).toBeCloseTo(CHART_MIN_FIT_X, 6)

    const boardWpx = chartBoardWidth(8) * PX_PER_UNIT * view.fitX
    const centerX = worldToScreen({ x: view.position.x, y: 0 }, layout.viewport).x
    const panelLeft = centerX - boardWpx / 2 - CHART_LABEL_GUTTER_PX
    const boxes = chartXLabelBoxes({ count: 8, fitX: view.fitX })

    expect(boxes).toHaveLength(8)

    boxes.forEach((box, index) => {
      // The bar's pane x is the placement centre plus its column offset — the
      // same offset `ChartBoard`'s hover strips stand on, scaled by fitX.
      const barCenterX = centerX + barColumnX(index, 8) * PX_PER_UNIT * view.fitX

      expect(Math.abs(panelLeft + box.center - barCenterX)).toBeLessThanOrEqual(2)
      expect(box.right - box.left).toBeCloseTo(CHART_X_LABEL_BOX_PX, 6)
      expect(panelLeft + box.left).toBeGreaterThanOrEqual(0)
      expect(panelLeft + box.right).toBeLessThanOrEqual(1422)
    })
  })

  it('is unchanged when the board is not compressed', () => {
    const boxes = chartXLabelBoxes({ count: 8, fitX: 1 })
    const boardWpx = chartBoardWidth(8) * PX_PER_UNIT

    boxes.forEach((box, index) => {
      expect(box.center).toBeCloseTo(CHART_LABEL_GUTTER_PX + boardWpx / 2 + barColumnX(index, 8) * PX_PER_UNIT, 6)
    })
  })
})
