/**
 * Chart3D geometry and placement (architecture §8.9) — pure and three-free.
 *
 * The chart is a board: a row of bars standing on a plinth with a grid plane
 * behind them. This module owns its world-unit size, the column positions, the
 * pane-side choice for presenting it BESIDE the avatar row, and the vertical
 * fit that keeps the whole panel (title, board, X labels) inside the pane when
 * the anchor edge sits high on the screen.
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
export const CHART_X_LABEL_GUTTER_PX = 18
/** Room left of the board for the Y tick labels. */
export const CHART_LABEL_GUTTER_PX = 40
/** Gap between the avatar row and the board. */
export const CHART_GAP_PX = 60
export const CHART_VIEW_MARGIN_PX = 16
/** The smallest the board may shrink to before it is allowed to clip. */
export const CHART_MIN_FIT = 0.62
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
}

/**
 * Place the board beyond the avatar row, on the side of the pane with more
 * room. Measuring against the whole ROW (not just the presenting avatar) is
 * what guarantees the chart never covers a body: with two or more avatars the
 * side beside the presenting one may be another avatar.
 */
export function chartPlacement(input: ChartPlacementInput): ChartPlacement {
  const { boardWidthPx, row, viewport } = input
  const half = boardWidthPx / 2
  const margin = CHART_VIEW_MARGIN_PX
  const leftRoom = row.x - margin
  const rightRoom = viewport.width - (row.x + row.width) - margin
  const side: 'left' | 'right' = rightRoom > leftRoom ? 'right' : 'left'
  const unclamped = side === 'left' ? row.x - CHART_GAP_PX - half : row.x + row.width + CHART_GAP_PX + half
  const min = margin + half
  const max = viewport.width - margin - half

  // A board wider than the viewport has no valid side: centre it rather than
  // hanging it off one edge.
  const centerX = max < min ? viewport.width / 2 : Math.min(Math.max(unclamped, min), max)

  return { centerX, side }
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
  /** Board centre in world units (its base sits CHART_LIFT above the perch line). */
  position: { x: number; y: number }
  side: 'left' | 'right'
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

  return {
    fit: chartFit(worldToScreen({ x: 0, y: presenting.perchY }, viewport).y),
    position: {
      x: screenToWorld({ x: placement.centerX, y: 0 }, viewport).x,
      y: presenting.perchY + CHART_LIFT
    },
    side: placement.side
  }
}
