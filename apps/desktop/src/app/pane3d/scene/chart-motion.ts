/**
 * Chart3D motion (architecture §8.9) — pure functions of elapsed ms.
 *
 * Same rule as `scene/choreography.ts`: nothing here is damped toward a moving
 * target, so a 5 fps software-GL frame can never stretch the 60 ms stagger or
 * the rise, and the pose is already at its endpoint whenever a frame lands.
 *
 * The turn is a SINE, not a spin: its peak angular rate equals
 * `CHART_YAW_RATE_DEG_PER_S`, and it reverses at ±20° — a chart that keeps
 * rotating one way would read as a gimmick (§8.3 taste bar).
 */

/** Delay between two neighbouring bars' rise. */
export const CHART_STAGGER_MS = 60
/** How long one bar takes to settle after its delay. */
export const CHART_RISE_MS = 520
/** The board and plinth fade in over this long. */
export const CHART_REVEAL_MS = 320
/** How far a hovered bar lifts, world units. */
export const CHART_HOVER_LIFT = 0.04
export const CHART_YAW_MAX_DEG = 20
/** The sine's PEAK angular rate, °/s (the turn eases at both extremes). */
export const CHART_YAW_RATE_DEG_PER_S = 6
/** Time constant of the rise spring: a critically-damped-ish step with ~4.5% overshoot. */
export const CHART_SPRING_SETTLE_MS = 600

const TAU = Math.PI * 2
const DAMPING = 0.7
const STIFFNESS = 12

/** The period that makes the sine's peak rate exactly `CHART_YAW_RATE_DEG_PER_S`. */
export const CHART_YAW_PERIOD_MS = ((TAU * CHART_YAW_MAX_DEG) / CHART_YAW_RATE_DEG_PER_S) * 1000

/**
 * The turntable angle at `elapsedMs`: a slow ±20° oscillation that starts at 0
 * (facing the viewer) and never spins continuously.
 */
export function chartYawDeg(elapsedMs: number, reducedMotion = false): number {
  if (reducedMotion) {
    return 0
  }

  return CHART_YAW_MAX_DEG * Math.sin((TAU * Math.max(0, elapsedMs)) / CHART_YAW_PERIOD_MS)
}

/**
 * A unit step response of an underdamped spring (ζ 0.7, ω 12 rad/s), settled
 * after `CHART_SPRING_SETTLE_MS`. Used for the bar rise: 0 → ~1.045 → 1.
 */
function springStep(ms: number): number {
  if (!(ms > 0)) {
    return 0
  }

  const t = ms / 1000
  const damped = STIFFNESS * Math.sqrt(1 - DAMPING * DAMPING)

  return (
    1 -
    Math.exp(-DAMPING * STIFFNESS * t) *
      (Math.cos(damped * t) + ((DAMPING * STIFFNESS) / damped) * Math.sin(damped * t))
  )
}

export interface BarRiseOptions {
  staggerMs?: number
  riseMs?: number
  reducedMotion?: boolean
}

/**
 * One bar's rise progress (0..~1.05) at `elapsedMs`, `index * staggerMs` behind
 * the first bar. Reduced motion puts every bar straight at its height.
 */
export function barRise(elapsedMs: number, index: number, options: BarRiseOptions = {}): number {
  const { reducedMotion = false, riseMs = CHART_RISE_MS, staggerMs = CHART_STAGGER_MS } = options

  if (reducedMotion) {
    return 1
  }

  const local = elapsedMs - Math.max(0, index) * staggerMs

  if (!(local > 0) || !(riseMs > 0)) {
    return 0
  }

  return Math.max(0, springStep((local / riseMs) * CHART_SPRING_SETTLE_MS))
}

/** The board/plinth/label reveal, 0..1, ease-out. */
export function chartReveal(elapsedMs: number, reducedMotion = false): number {
  if (reducedMotion) {
    return 1
  }

  const progress = Math.min(1, Math.max(0, elapsedMs / CHART_REVEAL_MS))

  return 1 - (1 - progress) ** 3
}
