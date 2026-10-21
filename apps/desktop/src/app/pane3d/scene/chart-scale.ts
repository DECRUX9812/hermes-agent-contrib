/**
 * Chart3D scale math (architecture §8.9) — pure and three-free.
 *
 * One zero-based linear scale for every bar: the axis ceiling maps to EXACTLY
 * the configured max height, and the axis is drawn with round "nice" ticks whose
 * ceiling always reaches at least the data maximum, so the tallest bar never
 * pokes above the top gridline. Labels are formatted here too, so the 3D chart
 * and its DOM layer can never disagree about a number.
 *
 * The ceiling is a separate input from the series peak ON PURPOSE: a bar must be
 * scaled against the axis it is drawn on, or the ticks lie about the bars (a
 * 1968 bar under a 2000 tick has to stop just short of the top gridline, not
 * fill the axis).
 */

/** World units: the tallest bar's height, and therefore the axis span. */
export const CHART_MAX_BAR_HEIGHT = 0.62
/** The chart shows three Y ticks (architecture §8.9). */
export const CHART_Y_TICK_COUNT = 3

/** The classic 1-2-2.5-5-10 ladder; a step is always one of these times a power of ten. */
const NICE_STEPS = [1, 2, 2.5, 5, 10]
const EPSILON = 1e-9

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
/**
 * Hover values are NOT rounded: the label states the bar's real number, so a
 * value like 1234.567 must not read "1,234.57". Tick labels stay compact via
 * `formatTickLabel`, so the axis is unaffected.
 */
const EXACT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 })
/**
 * Where `EXACT` stops being exact. It can only render 20 fraction digits, so
 * every nonzero magnitude below 1e-6 collapses to "0" (1e-21 → "0"), and beyond
 * double integer precision it prints a rounded decimal. Both are real ChartSpec
 * numbers whose bars have real height, so they keep a representation that
 * round-trips through `Number()` instead.
 */
const EXACT_MIN = 1e-6
const EXACT_MAX = 1e15

function clampTickCount(count: number): number {
  return Number.isFinite(count) ? Math.max(2, Math.floor(count)) : CHART_Y_TICK_COUNT
}

/** The smallest ladder value at or above `raw`, scaled to `raw`'s magnitude. */
function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 1
  }

  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  const step = NICE_STEPS.find(candidate => candidate >= normalized - EPSILON) ?? 10

  return step * magnitude
}

/**
 * `count` round tick values starting at zero, spaced by a nice step. The top
 * tick is always ≥ `maxValue`, so the axis ceiling can never clip a bar.
 */
export function niceTicks(maxValue: number, count = CHART_Y_TICK_COUNT): number[] {
  const ticks = clampTickCount(count)
  const peak = Number.isFinite(maxValue) ? Math.max(0, maxValue) : 0
  const step = niceStep(peak / (ticks - 1))

  return Array.from({ length: ticks }, (_, index) => index * step)
}

export interface ChartDomain {
  /** The axis ceiling (the top tick) — what the Y gridlines are drawn against. */
  max: number
  ticks: number[]
}

/** The axis for a series: its ceiling and the ticks drawn on the grid plane. */
export function chartDomain(values: readonly number[], count = CHART_Y_TICK_COUNT): ChartDomain {
  const peak = values.reduce((max, value) => (Number.isFinite(value) ? Math.max(max, value) : max), 0)
  const ticks = niceTicks(peak, count)

  return { max: ticks[ticks.length - 1], ticks }
}

/**
 * Bar heights in world units: linear and zero-based against `ceiling` (the axis
 * top, which is what the gridlines and ticks are drawn against), with the
 * ceiling at exactly `maxHeight`. Defaults to the series peak for callers that
 * have no axis. Degenerate series (all zero, negatives, empty) never produce a
 * negative or NaN bar.
 */
export function scaleBarHeights(
  values: readonly number[],
  maxHeight = CHART_MAX_BAR_HEIGHT,
  ceiling?: number
): number[] {
  const peak = values.reduce((max, value) => (Number.isFinite(value) ? Math.max(max, value) : max), 0)
  const top = ceiling === undefined ? peak : Number.isFinite(ceiling) ? Math.max(0, ceiling) : peak

  if (!(top > 0) || !(maxHeight > 0)) {
    return values.map(() => 0)
  }

  return values.map(value => (Math.max(0, value) / top) * maxHeight)
}

/** The exact hover value with its unit, grouped for reading: `1,234.567 kg`. */
export function formatHoverValue(value: number, unit?: string): string {
  const safe = Number.isFinite(value) ? value : 0
  const magnitude = Math.abs(safe)

  const text = magnitude > 0 && (magnitude < EXACT_MIN || magnitude >= EXACT_MAX) ? String(safe) : EXACT.format(safe)

  return unit ? `${text} ${unit}` : text
}

/** A compact axis tick: `0`, `250`, `1.5k`, `2M`. */
export function formatTickLabel(value: number): string {
  const safe = Number.isFinite(value) ? value : 0
  const magnitude = Math.abs(safe)
  const compact = (scaled: number, suffix: string) => `${GROUPED.format(Math.round(scaled * 10) / 10)}${suffix}`

  if (magnitude >= 1_000_000) {
    return compact(safe / 1_000_000, 'M')
  }

  if (magnitude >= 1000) {
    return compact(safe / 1000, 'k')
  }

  return GROUPED.format(safe)
}
