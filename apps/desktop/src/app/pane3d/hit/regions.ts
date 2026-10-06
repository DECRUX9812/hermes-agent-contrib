/**
 * Pure hit-region math (architecture §6).
 *
 * The pane publishes rectangles — in pane-local CSS px — for everything the
 * user can interact with: the projected boxes of each avatar's hit parts, its
 * emergence edge (seam + contact shadow), and every DOM target carrying
 * `data-pane-hit` / `data-pane-chart`. Main converts them to DIP and applies
 * them as the window's input shape on Linux; on darwin/win32 they only feed
 * the renderer's exact per-pixel test.
 *
 * Everything here is pure (no three, no Electron) so padding, merging, the
 * 24-rect cap and change detection are provable without a window.
 */

import type { ScreenRect } from '../protocol'

/** Room around an avatar part for its glow (architecture §6). */
export const AVATAR_PAD = 6
/** Room around a DOM target for its shadow. */
export const DOM_PAD = 8
/** Rects closer than this merge into one. */
export const MERGE_GAP = 4
/** `setShape` gets at most this many rects; the closest pairs merge past it. */
export const REGION_CAP = 24
/** Rects equal within this many px in every field are the same region. */
export const EQUAL_TOLERANCE = 1

export function padRect(rect: ScreenRect, pad: number): ScreenRect {
  return { height: rect.height + pad * 2, width: rect.width + pad * 2, x: rect.x - pad, y: rect.y - pad }
}

/**
 * Integers, rounded OUTWARD: a shape that rounds inward would clip the very
 * pixels it is meant to keep interactive (and, on X11, painted).
 */
export function roundRect(rect: ScreenRect): ScreenRect {
  const left = Math.floor(rect.x)
  const top = Math.floor(rect.y)
  const right = Math.ceil(rect.x + rect.width)
  const bottom = Math.ceil(rect.y + rect.height)

  return { height: Math.max(1, bottom - top), width: Math.max(1, right - left), x: left, y: top }
}

function union(a: ScreenRect, b: ScreenRect): ScreenRect {
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.width, b.x + b.width)
  const bottom = Math.max(a.y + a.height, b.y + b.height)

  return { height: bottom - top, width: right - left, x: left, y: top }
}

/** Gap between two rects on each axis (0 when they overlap or touch). */
function axisGap(aStart: number, aSize: number, bStart: number, bSize: number): number {
  return Math.max(0, Math.max(aStart, bStart) - Math.min(aStart + aSize, bStart + bSize))
}

function gapBetween(a: ScreenRect, b: ScreenRect): number {
  const dx = axisGap(a.x, a.width, b.x, b.width)
  const dy = axisGap(a.y, a.height, b.y, b.height)

  return Math.sqrt(dx * dx + dy * dy)
}

function withinGap(a: ScreenRect, b: ScreenRect, gap: number): boolean {
  return gapBetween(a, b) <= gap
}

/** Top-left to bottom-right, so the published list is deterministic. */
function compareRects(a: ScreenRect, b: ScreenRect): number {
  return a.y - b.y || a.x - b.x || a.height - b.height || a.width - b.width
}

/**
 * Union every overlapping-or-near rect (architecture §6). Once nothing else is
 * within `gap`, keep merging the closest remaining pair until at most `cap`
 * rects remain — a hard ceiling on how many native `setShape` entries a busy
 * scene can ever produce. Degenerate rects are dropped.
 */
export function mergeRegions(rects: ScreenRect[], gap = MERGE_GAP, cap = REGION_CAP): ScreenRect[] {
  const out = rects.filter(
    rect => rect.width >= 1 && rect.height >= 1 && Number.isFinite(rect.x) && Number.isFinite(rect.y)
  )

  // Merge any pair within the gap, repeatedly — a merge can bring a new pair
  // into range, and a naive single pass would leave a near pair standing.
  let merged = true

  while (merged) {
    merged = false

    for (let i = 0; i < out.length && !merged; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        if (withinGap(out[i], out[j], gap)) {
          out[i] = union(out[i], out[j])
          out.splice(j, 1)
          merged = true

          break
        }
      }
    }
  }

  while (out.length > cap) {
    let bestI = 0
    let bestJ = 1
    let bestGap = Infinity

    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const distance = gapBetween(out[i], out[j])

        if (distance < bestGap) {
          bestGap = distance
          bestI = i
          bestJ = j
        }
      }
    }

    out[bestI] = union(out[bestI], out[bestJ])
    out.splice(bestJ, 1)
  }

  return out.sort(compareRects).map(roundRect)
}

/**
 * Whether two region lists describe the same shape. Order-insensitive: the
 * publisher's list is rebuilt from scratch every frame, and a reordering is
 * not a change worth waking the main process for.
 */
export function regionsEqual(a: ScreenRect[], b: ScreenRect[], tolerance = EQUAL_TOLERANCE): boolean {
  if (a.length !== b.length) {
    return false
  }

  const matched = new Array<boolean>(b.length).fill(false)

  for (const ra of a) {
    let found = false

    for (let j = 0; j < b.length; j += 1) {
      if (matched[j]) {
        continue
      }

      const rb = b[j]

      if (
        Math.abs(ra.x - rb.x) <= tolerance &&
        Math.abs(ra.y - rb.y) <= tolerance &&
        Math.abs(ra.width - rb.width) <= tolerance &&
        Math.abs(ra.height - rb.height) <= tolerance
      ) {
        matched[j] = true
        found = true

        break
      }
    }

    if (!found) {
      return false
    }
  }

  return true
}

export interface HitRegionSources {
  /** Projected avatar part + edge boxes, pane CSS px, unpadded. */
  avatars?: ScreenRect[]
  /** Projected Chart3D geometry boxes while a chart is presented (§8.9). */
  chart?: ScreenRect[]
  /** DOM rects (`data-pane-hit`, `data-pane-chart`), pane CSS px, unpadded. */
  dom?: ScreenRect[]
}

export interface BuildHitRegionOptions {
  avatarPad?: number
  chartPad?: number
  domPad?: number
  gap?: number
  cap?: number
}

/** Pad each source by its own rule, then merge into the published list. */
export function buildHitRegions(sources: HitRegionSources, options: BuildHitRegionOptions = {}): ScreenRect[] {
  const { avatarPad = AVATAR_PAD, cap = REGION_CAP, chartPad = AVATAR_PAD, domPad = DOM_PAD, gap = MERGE_GAP } = options

  const padded = [
    ...(sources.avatars ?? []).map(rect => padRect(rect, avatarPad)),
    // Chart geometry is real geometry, so it takes the glow padding the
    // avatars' parts take, not the DOM shadow padding.
    ...(sources.chart ?? []).map(rect => padRect(rect, chartPad)),
    ...(sources.dom ?? []).map(rect => padRect(rect, domPad))
  ]

  return mergeRegions(padded, gap, cap)
}

/** Anything with a client rect — a DOM element, or a stand-in in a test. */
export interface MeasurableElement {
  getBoundingClientRect(): { x: number; y: number; width: number; height: number }
}

/**
 * The client rects of every measurable target, UNPADDED — `buildHitRegions`
 * owns the padding so it is applied exactly once. Zero-sized elements are
 * skipped: a `display:none` node (or the avatar handle before the projector has
 * sized it) reports an all-zero rect, and a rect that small is nothing to
 * click. `ArrayLike` keeps `querySelectorAll`'s NodeList usable without
 * iterating it.
 */
export function domHitRects(elements: ArrayLike<MeasurableElement>): ScreenRect[] {
  const out: ScreenRect[] = []

  for (let index = 0; index < elements.length; index += 1) {
    const rect = elements[index].getBoundingClientRect()

    if (rect.width < 1 || rect.height < 1) {
      continue
    }

    out.push({ height: rect.height, width: rect.width, x: rect.x, y: rect.y })
  }

  return out
}
