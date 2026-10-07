/**
 * Pure geometry shared by the DOM card layout (§8.5): box types and the
 * constants, collision scoring and free-vertical-band fitting that
 * `card-layout.ts` and `bubbleLayout` build on. No React, no DOM.
 */

export interface CardSize {
  width: number
  height: number
}

export interface CardBox {
  x: number
  y: number
  width: number
  height: number
}

export const CARD_GAP = 14
export const CARD_MARGIN = 8

/**
 * The shortest band an expanded card can be placed in and still be usable: the
 * head row, title, action and close × plus a sliver of scrollable body. A band
 * below this counts as no band at all, and the layout falls back to
 * least-overlap (§8.5).
 */
export const MIN_CARD_HEIGHT = 120

/**
 * The tallest a card may grow and still sit wholly inside the pane (§8.5,
 * VAL-NOTIFY-007): the viewport minus the top and bottom margins. An expanded
 * body is bounded by this so a long host body can never push the card (or its
 * action/close) outside the pane; the body scrolls instead.
 */
export function expandedCardMaxHeight(viewportHeight: number, margin: number = CARD_MARGIN): number {
  return Math.max(0, viewportHeight - margin * 2)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Boxes (padded by `pad`) intersect. */
export function boxesOverlap(a: CardBox, b: CardBox, pad = 0): boolean {
  return (
    a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad
  )
}

export function withinBounds(y: number, height: number, viewport: CardSize, margin: number): boolean {
  return y >= margin - 0.5 && y + height <= viewport.height - margin + 0.5
}

/**
 * Push a box vertically until it clears every obstacle, moving in `prefer`'s
 * direction. Pure and order-stable; the caller decides what to do if the
 * result leaves the pane.
 */
export function clearVertical(box: CardBox, obstacles: readonly CardBox[], gap: number, prefer: 'down' | 'up'): number {
  let y = box.y
  let moving = true
  let guard = 0

  while (moving && guard <= obstacles.length + 1) {
    moving = false
    guard += 1

    for (const other of obstacles) {
      if (!boxesOverlap({ ...box, y }, other, gap)) {
        continue
      }

      y = prefer === 'up' ? other.y - box.height - gap : other.y + other.height + gap
      moving = true
    }
  }

  return y
}

/** Intersection area of two boxes inflated by `pad`; 0 when they do not touch. */
function overlapArea(a: CardBox, b: CardBox, pad: number): number {
  const width = Math.min(a.x + a.width + pad, b.x + b.width + pad) - Math.max(a.x - pad, b.x - pad)
  const height = Math.min(a.y + a.height + pad, b.y + b.height + pad) - Math.max(a.y - pad, b.y - pad)

  return width > 0 && height > 0 ? width * height : 0
}

export function totalOverlap(box: CardBox, obstacles: readonly CardBox[], pad: number): number {
  return obstacles.reduce((sum, other) => sum + overlapArea(box, other, pad), 0)
}

/** Candidate tops are swept at this step so an unobstructed band is never missed. */
const VERTICAL_STEP = 8

/**
 * The top for `box` (whose `y` is the DESIRED position) that keeps it inside
 * the pane and as clear as possible of `obstacles`. Candidates are the desired
 * spot, both pane edges, every obstacle's clear edges and a fine sweep; the
 * winner has the least total overlap, then the smallest distance from the
 * desired spot, preferring downward.
 *
 * This is what lets a card near the bottom edge stack UPWARD instead of being
 * clamped back onto a neighbour (§8.5): a placement that overlaps nothing
 * always beats one that overlaps something, however far away it has to go.
 */
export function bestVertical(
  box: CardBox,
  obstacles: readonly CardBox[],
  viewport: CardSize,
  gap: number,
  margin: number
): number {
  const min = margin
  const max = Math.max(min, viewport.height - margin - box.height)
  const desired = clamp(box.y, min, max)
  const candidates = new Set<number>([min, max, desired])

  for (const other of obstacles) {
    candidates.add(clamp(other.y - box.height - gap, min, max))
    candidates.add(clamp(other.y + other.height + gap, min, max))
  }

  for (let y = min; y <= max; y += VERTICAL_STEP) {
    candidates.add(y)
  }

  let best = desired
  let bestOverlap = Number.POSITIVE_INFINITY
  let bestDistance = Number.POSITIVE_INFINITY

  for (const y of candidates) {
    const overlap = totalOverlap({ ...box, y }, obstacles, gap)
    const distance = Math.abs(y - desired)

    const better =
      overlap < bestOverlap - 0.5 ||
      (Math.abs(overlap - bestOverlap) <= 0.5 &&
        (distance < bestDistance - 0.5 || (Math.abs(distance - bestDistance) <= 0.5 && y > best)))

    if (better) {
      best = y
      bestOverlap = overlap
      bestDistance = distance
    }
  }

  return best
}

export interface VerticalBand {
  /** Top edge inside the pane (CSS px). */
  top: number
  /** Bottom edge inside the pane (CSS px). */
  bottom: number
}

/** True when the two horizontal spans overlap once both are inflated by `gap`. */
function horizontallyOverlaps(a: Pick<CardBox, 'width' | 'x'>, b: Pick<CardBox, 'width' | 'x'>, gap: number): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
}

/**
 * The obstacle-free vertical bands inside the pane for a card occupying the
 * horizontal span `box`. Every obstacle that horizontally overlaps that span
 * (within `gap`) removes its own vertical extent (grown by `gap`) from the
 * pane's usable interior, so what comes back is the set of clear intervals the
 * card can be placed in without covering a neighbour or another card. Bands are
 * returned top-down and never fall outside the margins.
 */
export function freeVerticalBands(
  box: Pick<CardBox, 'width' | 'x'>,
  obstacles: readonly CardBox[],
  viewport: CardSize,
  gap: number = CARD_GAP,
  margin: number = CARD_MARGIN
): VerticalBand[] {
  const top = margin
  const bottom = Math.max(top, viewport.height - margin)

  const blocked = obstacles
    .filter(obstacle => horizontallyOverlaps(box, obstacle, gap))
    .map(obstacle => ({
      bottom: Math.min(bottom, obstacle.y + obstacle.height + gap),
      top: Math.max(top, obstacle.y - gap)
    }))
    .filter(block => block.bottom > block.top)
    .sort((a, b) => a.top - b.top)

  const bands: VerticalBand[] = []
  let cursor = top

  for (const block of blocked) {
    if (block.top > cursor) {
      bands.push({ bottom: block.top, top: cursor })
    }

    cursor = Math.max(cursor, block.bottom)
  }

  if (cursor < bottom) {
    bands.push({ bottom, top: cursor })
  }

  return bands
}

/** One way a card can sit in one side's column: a clear band, or the degenerate fallback. */
export interface CardFit {
  /** True when no clear band reached the minimum and the least-overlap fallback was used. */
  degenerate: boolean
  /**
   * True when this fit also clears the SECONDARY obstacles (a presented chart).
   * A chart-clearing fit beats one that only clears the avatars, but never at
   * the cost of a primary overlap (VAL-CHART-005).
   */
  clearsAvoid: boolean
  /** The chosen clear band's height (0 when degenerate). Collapsed and expanded share it. */
  bandHeight: number
  /** Rendered height: min(naturalHeight, bandHeight), or the pane cap when degenerate. */
  height: number
  /** Height cap for the scrollable body (the band, or the pane cap when degenerate). */
  maxHeight: number
  /** Total obstacle overlap; 0 unless degenerate. */
  overlap: number
  /** Distance of `top` from the avatar-centred desired top. */
  distance: number
  top: number
}

/** Fit `naturalHeight` into one clear band, centred as close to `desiredTop` as the band allows. */
function fitInBand(band: VerticalBand, naturalHeight: number, desiredTop: number, clearsAvoid: boolean): CardFit {
  const bandHeight = band.bottom - band.top
  const height = Math.min(naturalHeight, bandHeight)
  const top = clamp(desiredTop, band.top, Math.max(band.top, band.bottom - height))

  return {
    bandHeight,
    clearsAvoid,
    degenerate: false,
    distance: Math.abs(top - desiredTop),
    height,
    maxHeight: bandHeight,
    overlap: 0,
    top
  }
}

/**
 * Ordering between two fits of the same card: `a` beats `b`. A usable clear band
 * always beats the degenerate overlap fallback; between two bands, clearing the
 * secondary obstacles (a presented chart) beats only clearing the avatars, then
 * showing the whole card beats forcing a scroll, then the taller band wins, then
 * the one nearest the avatar's mid-line (the "originally preferred side" tie is
 * broken by the caller, which tries the roomier side first).
 */
export function betterCardFit(a: CardFit, b: CardFit, naturalHeight: number): boolean {
  if (a.degenerate !== b.degenerate) {
    return !a.degenerate
  }

  if (a.degenerate) {
    if (Math.abs(a.overlap - b.overlap) > 0.5) {
      return a.overlap < b.overlap
    }

    return a.distance < b.distance - 0.5
  }

  if (a.clearsAvoid !== b.clearsAvoid) {
    return a.clearsAvoid
  }

  const aFull = a.bandHeight >= naturalHeight
  const bFull = b.bandHeight >= naturalHeight

  if (aFull !== bFull) {
    return aFull
  }

  if (Math.abs(a.bandHeight - b.bandHeight) > 0.5) {
    return a.bandHeight > b.bandHeight
  }

  return a.distance < b.distance - 0.5
}

/**
 * Fit a card into one side's column — the single placement primitive behind
 * every card, collapsed or expanded (§8.5). The column's obstacle-free bands
 * are the pane interior minus every avatar and every already-placed card that
 * horizontally overlaps the column (within `gap`), so a fit chosen from a band
 * never covers an obstacle.
 *
 * `expandable` is true for an expanded card: it needs a band at least
 * MIN_CARD_HEIGHT tall and its scrollable body is capped to whatever it gets.
 * A collapsed card has no scroll box, so it needs a band at least as tall as the
 * card itself. When neither side offers such a band, the caller gets the
 * degenerate fallback: the least-overlap position inside the pane, with the pane
 * height as the cap (expanded) or the card's own height (collapsed).
 *
 * `avoid` is the SECONDARY obstacle list (a presented chart, VAL-CHART-005): a
 * band clear of it wins, but when none exists the card falls back to a band
 * clear of the primary obstacles only — avatars and the pane bounds take
 * precedence over the chart.
 */
export function fitCardInColumn(
  x: number,
  width: number,
  naturalHeight: number,
  desiredTop: number,
  obstacles: readonly CardBox[],
  viewport: CardSize,
  gap: number,
  margin: number,
  expandable: boolean,
  avoid: readonly CardBox[] = []
): CardFit {
  const minBand = expandable ? MIN_CARD_HEIGHT : naturalHeight
  const box = { width, x }
  const primaryBands = freeVerticalBands(box, obstacles, viewport, gap, margin)

  const clearBands =
    avoid.length > 0 ? freeVerticalBands(box, [...obstacles, ...avoid], viewport, gap, margin) : primaryBands

  const usable = (bands: VerticalBand[]) => bands.filter(band => band.bottom - band.top >= minBand - 0.5)

  const bestIn = (bands: VerticalBand[], clearsAvoid: boolean): CardFit => {
    let chosen = fitInBand(bands[0], naturalHeight, desiredTop, clearsAvoid)

    for (const band of bands.slice(1)) {
      const fit = fitInBand(band, naturalHeight, desiredTop, clearsAvoid)

      if (betterCardFit(fit, chosen, naturalHeight)) {
        chosen = fit
      }
    }

    return chosen
  }

  const clear = usable(clearBands)

  if (clear.length > 0) {
    return bestIn(clear, true)
  }

  if (avoid.length > 0) {
    const primary = usable(primaryBands)

    if (primary.length > 0) {
      return bestIn(primary, false)
    }
  }

  const maxHeight = expandable ? expandedCardMaxHeight(viewport.height, margin) : naturalHeight
  const height = Math.min(naturalHeight, maxHeight)
  const desired = clamp(desiredTop, margin, Math.max(margin, viewport.height - margin - height))
  const top = bestVertical({ height, width, x, y: desired }, obstacles, viewport, gap, margin)

  return {
    bandHeight: 0,
    clearsAvoid: false,
    degenerate: true,
    distance: Math.abs(top - desiredTop),
    height,
    maxHeight,
    overlap: totalOverlap({ height, width, x, y: top }, obstacles, gap),
    top
  }
}
