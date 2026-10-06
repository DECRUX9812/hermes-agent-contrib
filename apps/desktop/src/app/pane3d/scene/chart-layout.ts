/**
 * Chart3D geometry and placement (architecture §8.9) — pure and three-free.
 *
 * The chart is a board: a row of bars standing on a plinth with a grid plane
 * behind them. This module owns its world-unit size, the column positions, the
 * pane-side choice for presenting it BESIDE the avatar row, and the two fits
 * that keep the whole panel inside the pane — the vertical fit for a high
 * anchor edge, and the horizontal fit that squeezes the board when the pane is
 * too narrow to hold the full panel (Y-label gutter included) beside the row.
 *
 * A horizontal floor grid would be invisible: the pane's camera looks straight
 * down -z (scene/camera.tsx), so the grid plane is VERTICAL, behind the bars —
 * the same read as a graph backdrop, and the bars' depth shows as the chart
 * oscillates.
 */

import type { AvatarId, ScreenRect } from '../protocol'

import { CHART_MAX_BAR_HEIGHT } from './chart-scale'
import {
  PX_PER_UNIT,
  reservedSlotRect,
  screenToWorld,
  type SlotTarget,
  unionScreenRects,
  type Viewport,
  worldToScreen
} from './projection'

/** Bar silhouette and spacing, world units. */
export const CHART_BAR_WIDTH = 0.2
export const CHART_BAR_DEPTH = 0.2
export const CHART_BAR_RADIUS = 0.025
export const CHART_COLUMN_PITCH = 0.3
/** The board runs this far past the outermost bar on each side. */
export const CHART_BOARD_MARGIN = 0.3
export const CHART_BOARD_DEPTH = 0.05
/** The board sits behind the bars; far enough that the ±20° turn never crosses it. */
export const CHART_BOARD_Z = -0.5
/** The plinth under the bars, in world units. */
export const CHART_PLINTH_HEIGHT = 0.05
export const CHART_PLINTH_DEPTH = 0.8
export const CHART_PLINTH_Z = -0.15
/**
 * Board height at full size. This IS the axis span: the gridlines, the ticks and
 * the bars are all drawn against it, so a bar at the top tick reaches the top
 * gridline. Sizing the board taller than the bar area would leave the bars
 * floating under their own axis and make the tick labels lie.
 */
export const CHART_BOARD_HEIGHT = CHART_MAX_BAR_HEIGHT
/** The chart rests just above the perch line, so its plinth is never clipped. */
export const CHART_LIFT = 0.06

/** Layout in pane CSS px: what the DOM label layer needs around the board. */
export const CHART_TOP_MARGIN_PX = 8
export const CHART_TITLE_GUTTER_PX = 30
/**
 * The X-label strip sits under the plinth, so the gutter is exactly the plinth
 * + the gap + the strip. Anything less and the strip's top edge grazes the
 * plinth's underside (measured live at fit 0.62 and at fit 1).
 */
export const CHART_X_LABEL_GAP_PX = 2
export const CHART_X_LABEL_STRIP_PX = 14
export const CHART_X_LABEL_GUTTER_PX = CHART_X_LABEL_GAP_PX + CHART_X_LABEL_STRIP_PX + CHART_PLINTH_HEIGHT * PX_PER_UNIT
/** The fixed width of one X-label box — wide enough for a week label, centred on its bar. */
export const CHART_X_LABEL_BOX_PX = 40
/** Room left of the board for the Y tick labels. */
export const CHART_LABEL_GUTTER_PX = 40
/** Gap between the avatar row and the board. */
export const CHART_GAP_PX = 60
export const CHART_VIEW_MARGIN_PX = 16
/** The smallest the board may shrink to before it is allowed to clip. */
export const CHART_MIN_FIT = 0.62
/**
 * The smallest the board may shrink HORIZONTALLY when the pane is too narrow to
 * fit the full panel beside the row. Shrinking is the last resort after
 * flipping sides; below this the chart stops reading as a chart, so the panel
 * stays inside the pane and accepts the overlap instead.
 */
export const CHART_MIN_FIT_X = 0.5
/** How far the presenting avatar turns toward the chart (architecture §8.9). */
export const CHART_PRESENT_YAW_DEG = 32

/** Centre of bar `index` along the board's x axis, chart-local world units. */
export function barColumnX(index: number, count: number): number {
  return (index - (count - 1) / 2) * CHART_COLUMN_PITCH
}

/** The width of the bar row itself (outer edges, not centres). */
export function chartBarSpan(count: number): number {
  return Math.max(0, count - 1) * CHART_COLUMN_PITCH + CHART_BAR_WIDTH
}

export function chartBoardWidth(count: number): number {
  return chartBarSpan(count) + 2 * CHART_BOARD_MARGIN
}

export interface ChartXLabelBox {
  /** Panel-local centre — the bar column the label belongs to. */
  center: number
  /** Panel-local edges of the fixed-width box. */
  left: number
  right: number
}

/**
 * The X-label boxes in panel-local CSS px, one per bar, for `chart-labels.tsx`.
 *
 * The offset MUST carry the same `fitX` as the board geometry: `Chart3D` squeezes
 * the whole board — columns included — when the pane is too narrow for the full
 * panel beside the avatar row, so an unscaled offset leaves every label drifting
 * off its bar and pushes the outermost box past the pane edge even though the
 * panel's own box is clamped inside. Each centre lands on
 * `barColumnX(index, count) * PX_PER_UNIT * fitX` from the board centre, which is
 * exactly where the 3D bars and their hover strips stand.
 */
export function chartXLabelBoxes(input: { count: number; fitX: number }): ChartXLabelBox[] {
  const { count, fitX } = input
  const boardWpx = chartBoardWidth(count) * PX_PER_UNIT * fitX
  const boardCenterPx = CHART_LABEL_GUTTER_PX + boardWpx / 2

  return Array.from({ length: count }, (_, index) => {
    const center = boardCenterPx + barColumnX(index, count) * PX_PER_UNIT * fitX

    return { center, left: center - CHART_X_LABEL_BOX_PX / 2, right: center + CHART_X_LABEL_BOX_PX / 2 }
  })
}

export interface ChartPlacementInput {
  /** Pane CSS px box of every visible avatar — the row the chart must not cover. */
  row: ScreenRect
  viewport: Viewport
  boardWidthPx: number
}

export interface ChartPlacement {
  side: 'left' | 'right'
  /** Board centre in pane CSS px. */
  centerX: number
  /** Horizontal fit for the board, `CHART_MIN_FIT_X`..1. */
  fitX: number
}

/** The board centre on `side`, clamped so the WHOLE label panel stays in the pane. */
function boardCenterX(side: 'left' | 'right', row: ScreenRect, viewport: Viewport, half: number): number {
  const margin = CHART_VIEW_MARGIN_PX
  const unclamped = side === 'left' ? row.x - CHART_GAP_PX - half : row.x + row.width + CHART_GAP_PX + half
  // The Y gutter sits to the LEFT of the board, so the left edge needs it too:
  // clamping the bare board here would push the ticks off the pane (round-1 bug).
  const min = margin + CHART_LABEL_GUTTER_PX + half
  const max = viewport.width - margin - half

  // A board wider than the viewport has no valid side: centre it rather than
  // hanging it off one edge.
  return max < min ? viewport.width / 2 : Math.min(Math.max(unclamped, min), max)
}

/** The label panel's x span in pane CSS px — the Y gutter on the board's left. */
function panelSpan(centerX: number, half: number): { left: number; right: number } {
  return { left: centerX - half - CHART_LABEL_GUTTER_PX, right: centerX + half }
}

/** The panel overlaps the row when their x spans intersect — both sit on the perch line. */
function overlapsRow(centerX: number, half: number, row: ScreenRect): boolean {
  const panel = panelSpan(centerX, half)

  return panel.left < row.x + row.width && row.x < panel.right
}

/**
 * Place the board beyond the avatar row, on the side of the pane with more
 * room. Measuring against the whole ROW (not just the presenting avatar) is
 * what guarantees the chart never covers a body: with two or more avatars the
 * side beside the presenting one may be another avatar.
 *
 * The clamp keeps the COMPLETE label panel — the 40 px Y gutter included —
 * inside the pane. On a narrow pane that clamp can push the panel back over the
 * row, so the row is re-checked afterwards: the placement flips to the other
 * side, and if neither side fits, the board shrinks horizontally (down to
 * `CHART_MIN_FIT_X`) until the panel clears the row. Only a pane too narrow for
 * even that keeps the panel inside the pane and accepts the overlap.
 */
export function chartPlacement(input: ChartPlacementInput): ChartPlacement {
  const { boardWidthPx, row, viewport } = input
  const margin = CHART_VIEW_MARGIN_PX
  const half = boardWidthPx / 2
  const leftRoom = row.x - margin
  const rightRoom = viewport.width - (row.x + row.width) - margin
  const preferred: 'left' | 'right' = rightRoom > leftRoom ? 'right' : 'left'
  const other: 'left' | 'right' = preferred === 'left' ? 'right' : 'left'

  const fits = (side: 'left' | 'right', fitHalf: number) => {
    const centerX = boardCenterX(side, row, viewport, fitHalf)
    const panel = panelSpan(centerX, fitHalf)

    return panel.left >= 0 && panel.right <= viewport.width && !overlapsRow(centerX, fitHalf, row)
  }

  if (fits(preferred, half)) {
    return { centerX: boardCenterX(preferred, row, viewport, half), fitX: 1, side: preferred }
  }

  if (fits(other, half)) {
    return { centerX: boardCenterX(other, row, viewport, half), fitX: 1, side: other }
  }

  const room = preferred === 'left' ? leftRoom : rightRoom
  const fitX = Math.min(1, Math.max(CHART_MIN_FIT_X, (room - CHART_GAP_PX - CHART_LABEL_GUTTER_PX) / boardWidthPx))
  const shrunkHalf = (boardWidthPx * fitX) / 2

  if (fits(preferred, shrunkHalf)) {
    return { centerX: boardCenterX(preferred, row, viewport, shrunkHalf), fitX, side: preferred }
  }

  if (fits(other, shrunkHalf)) {
    return { centerX: boardCenterX(other, row, viewport, shrunkHalf), fitX, side: other }
  }

  // Nothing clears the row: keep the whole panel inside the pane on the side
  // with more room and accept the overlap (the row fills the pane).
  return { centerX: boardCenterX(preferred, row, viewport, shrunkHalf), fitX, side: preferred }
}

/**
 * The vertical fit (0.62..1) for the perch line's distance from the pane top.
 * A high anchor edge (a browser page near the top of the screen) would push the
 * title off the pane, so the board — not the 11 px labels — shrinks to fit.
 */
export function chartFit(perchY: number): number {
  const fixed = CHART_TOP_MARGIN_PX + CHART_LIFT * PX_PER_UNIT + CHART_TITLE_GUTTER_PX + CHART_X_LABEL_GUTTER_PX
  const available = perchY - fixed
  const full = CHART_BOARD_HEIGHT * PX_PER_UNIT

  return Math.min(1, Math.max(CHART_MIN_FIT, available / full))
}

/** A registered avatar's silhouette, as the slot layout declares it. */
export interface ChartAvatarSilhouette {
  id: AvatarId
  height: number
  width?: number
}

export interface ChartViewInput {
  /** The director's rows — only visible avatars get a slot. */
  avatars: Partial<Record<AvatarId, { visible: boolean }>>
  /** The presentation, reduced to what placement needs; null when no chart. */
  chart: { avatar: AvatarId; series: number } | null
  definitions: readonly ChartAvatarSilhouette[]
  slots: Partial<Record<AvatarId, SlotTarget>>
  viewport: Viewport
}

export interface ChartView {
  fit: number
  /** Horizontal board fit, `CHART_MIN_FIT_X`..1 — see `chartPlacement`. */
  fitX: number
  /**
   * The whole DOM label panel's pane-CSS-px box (the `[data-pane-chart]`
   * element) — the board plus the title strip, the Y-label gutter and the
   * X-label strip. Cards and bubbles avoid it (VAL-CHART-005).
   */
  panel: ScreenRect
  /** Board centre in world units (its base sits CHART_LIFT above the perch line). */
  position: { x: number; y: number }
  side: 'left' | 'right'
}

export interface ChartPanelInput {
  /** Board centre in world units, as `chartViewFor` places it. */
  position: { x: number; y: number }
  /** Vertical board fit, `CHART_MIN_FIT`..1 — see `chartFit`. */
  fit: number
  /** Horizontal board fit, `CHART_MIN_FIT_X`..1 — see `chartPlacement`. */
  fitX: number
  /** Bar count; the board's width follows from it. */
  series: number
  viewport: Viewport
}

/**
 * The DOM label panel's pane-CSS-px box (VAL-CHART-005), computed from the SAME
 * numbers `Stage` places the board with — never measured from the DOM, so card
 * and bubble placement is deterministic and unit-testable.
 *
 * The label layer is anchored above the board's top edge on the board's centre
 * axis (`chart-labels.tsx`), and it spans the board width plus the Y-label
 * gutter, so this is the box the panel actually renders.
 */
export function chartPanelRect(input: ChartPanelInput): ScreenRect {
  const { fit, fitX, position, series, viewport } = input
  const boardHeight = CHART_BOARD_HEIGHT * fit
  const boardHpx = boardHeight * PX_PER_UNIT
  const boardWpx = chartBoardWidth(series) * PX_PER_UNIT * fitX

  const anchor = worldToScreen(
    { x: position.x, y: position.y + boardHeight + CHART_TITLE_GUTTER_PX / PX_PER_UNIT },
    viewport
  )

  return {
    height: CHART_TITLE_GUTTER_PX + boardHpx + CHART_X_LABEL_GUTTER_PX,
    width: boardWpx + CHART_LABEL_GUTTER_PX,
    x: anchor.x - (boardWpx / 2 + CHART_LABEL_GUTTER_PX),
    y: anchor.y
  }
}

/**
 * The whole placement decision: which side of the avatar ROW the board goes on,
 * where its centre lands in world units, and how far it must shrink to keep the
 * title and X labels inside the pane. Null when the chart cannot be placed (its
 * avatar left the stage, or nothing is visible).
 */
export function chartViewFor(input: ChartViewInput): ChartView | null {
  const { avatars, chart, definitions, slots, viewport } = input

  if (!chart) {
    return null
  }

  const presenting = slots[chart.avatar]

  if (!presenting || !avatars[chart.avatar]?.visible) {
    return null
  }

  const rowRects: ScreenRect[] = []

  definitions.forEach(definition => {
    const slot = slots[definition.id]

    if (slot && avatars[definition.id]?.visible) {
      rowRects.push(reservedSlotRect(slot, definition, viewport))
    }
  })

  if (rowRects.length === 0) {
    return null
  }

  const placement = chartPlacement({
    boardWidthPx: chartBoardWidth(chart.series) * PX_PER_UNIT,
    row: rowRects.reduce(unionScreenRects),
    viewport
  })

  const fit = chartFit(worldToScreen({ x: 0, y: presenting.perchY }, viewport).y)

  const position = {
    x: screenToWorld({ x: placement.centerX, y: 0 }, viewport).x,
    y: presenting.perchY + CHART_LIFT
  }

  return {
    fit,
    fitX: placement.fitX,
    panel: chartPanelRect({ fit, fitX: placement.fitX, position, series: chart.series, viewport }),
    position,
    side: placement.side
  }
}
