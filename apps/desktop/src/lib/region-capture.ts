/**
 * Region capture geometry + markup model (roadmap #34): pure math shared by
 * the overlay's two stages — drag-select a region on the captured frame, then
 * draw strokes (pen / rect / arrow) on the crop. Coordinates everywhere are
 * IMAGE pixels: the overlay converts pointer CSS-px via its fit scale and
 * compositeRegionCapture renders at native resolution.
 */

export interface RegionRect {
  height: number
  width: number
  x: number
  y: number
}

export type Point = readonly [number, number]

export type MarkupStroke =
  | { color: string; points: Point[]; type: 'pen' }
  | { color: string; rect: RegionRect; type: 'rect' }
  | { color: string; from: Point; to: Point; type: 'arrow' }

/** Smaller drags are a misclick, not a region. */
export const REGION_MIN_EDGE = 8

export const MARKUP_COLORS = ['#e5484d', '#f5b524', '#3d9df2'] as const
export const MARKUP_STROKE_WIDTH = 3

/** Two corners → a clamped rect inside a `width`×`height` frame; null below
 *  the minimum edge. */
export function normalizeRegionDrag(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  frameWidth: number,
  frameHeight: number
): RegionRect | null {
  const x1 = Math.max(0, Math.min(ax, bx))
  const y1 = Math.max(0, Math.min(ay, by))
  const x2 = Math.min(frameWidth, Math.max(ax, bx))
  const y2 = Math.min(frameHeight, Math.max(ay, by))
  const width = x2 - x1
  const height = y2 - y1

  if (width < REGION_MIN_EDGE || height < REGION_MIN_EDGE) {
    return null
  }

  return { height, width, x: x1, y: y1 }
}

/** Same clamp against a region's own bounds (markup canvas coordinates). */
export function clampToRegion(x: number, y: number, region: RegionRect): Point {
  return [Math.max(0, Math.min(x, region.width)), Math.max(0, Math.min(y, region.height))]
}

/** Fit `content` inside `max` preserving aspect — the overlay's letterbox. */
export function fitInside(
  contentWidth: number,
  contentHeight: number,
  maxWidth: number,
  maxHeight: number
): { height: number; scale: number; width: number } {
  if (contentWidth <= 0 || contentHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return { height: 0, scale: 0, width: 0 }
  }

  const scale = Math.min(maxWidth / contentWidth, maxHeight / contentHeight)

  return { height: contentHeight * scale, scale, width: contentWidth * scale }
}

/** The arrowhead's two wing endpoints + tip for `from → to`; null when the
 *  arrow is too short to read. `size` is in the stroke's own coordinate space
 *  (image px at composite, CSS px while drawing). */
export function arrowHeadPoints(from: Point, to: Point, size: number): [Point, Point, Point] | null {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dx, dy)

  if (length < size) {
    return null
  }

  const ux = dx / length
  const uy = dy / length
  // ~30° wings.
  const wing = Math.tan(Math.PI / 6) * size
  const baseX = to[0] - ux * size
  const baseY = to[1] - uy * size

  return [to, [baseX - uy * wing, baseY + ux * wing], [baseX + uy * wing, baseY - ux * wing]]
}

/** Start a stroke from a pointer-down, or extend it on move. Shape tools keep
 *  just origin + current point; pen accumulates. */
export function beginStroke(type: MarkupStroke['type'], at: Point, color: string): MarkupStroke {
  switch (type) {
    case 'arrow':
      return { color, from: at, to: at, type }

    case 'pen':
      return { color, points: [at], type }

    case 'rect':
      return { color, rect: { height: 0, width: 0, x: at[0], y: at[1] }, type }
  }
}

export function extendStroke(stroke: MarkupStroke, to: Point, region: RegionRect): MarkupStroke {
  const point = clampToRegion(to[0], to[1], region)

  switch (stroke.type) {
    case 'arrow':
      return { ...stroke, to: point }
    case 'pen': {
      const last = stroke.points[stroke.points.length - 1]

      if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 1.5) {
        return stroke
      }

      return { ...stroke, points: [...stroke.points, point] }
    }

    case 'rect': {
      const rect = normalizeRegionDrag(stroke.rect.x, stroke.rect.y, point[0], point[1], region.width, region.height)

      return { ...stroke, rect: rect ?? { height: 0, width: 0, x: stroke.rect.x, y: stroke.rect.y } }
    }
  }
}
