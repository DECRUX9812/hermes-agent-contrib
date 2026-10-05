/**
 * Pure emergence / hide / celebrate choreography (architecture §8.4).
 *
 * Every choreographed pose is a pure function of the elapsed ms since the
 * state transition, clamped at the animation's end. The frame loop applies the
 * pose directly — nothing here is damped toward a moving target — so the
 * visible avatar is already at its endpoint whenever the completion timer
 * fires, even on the 5–7 fps software-GL pane. This is what keeps a slow first
 * frame from stretching a 250 ms fade, and what stops HIDDEN from removing a
 * body that is still above the clip plane.
 *
 * Ambient cues (breathing, gaze, lean) are NOT part of the pose: they are damped
 * loops the rig owns, and only breathing runs while idle.
 */

export type ChoreographyPhase = 'rest' | 'emerging' | 'hiding' | 'celebrating'

export interface ChoreographyInput {
  phase: ChoreographyPhase
  /** Milliseconds since the transition into `phase` (anchored to `changedAt`). */
  elapsedMs: number
  reducedMotion: boolean
  /** World y of the avatar's resting centre (feet on the perch line). */
  restY: number
  /** World y of the perch line the avatar rises out of / sinks into. */
  perchY: number
  /** Avatar height in world units. */
  height: number
}

export interface Pose {
  /** World-y offset from the resting perch centre (negative = below). */
  yOffset: number
  /** Uniform body scale (1 at rest). */
  scale: number
  /** Body opacity multiplier 0..1 — fading only happens under reduced motion. */
  fade: number
  /** Seam envelope 0..1: world width is `SEAM_WIDTH * seam`, opacity `SEAM_OPACITY * seam`. */
  seam: number
  /** Contact-shadow opacity multiplier 0..1. */
  shadow: number
  /** Body roll in radians — the single small celebrate rotation. */
  rotationZ: number
  /** Accent-glow pulse 0..1 (1 at the peak of the celebrate gesture). */
  accentPulse: number
}

export const EMERGE_MS = 700
export const HIDE_MS = 500
export const CELEBRATE_MS = 900
/** Reduced motion: 250 ms fade plus a 0.1-unit rise/sink (§8.4). */
export const REDUCED_MS = 250
/** The entrance seam blooms along the edge for roughly 450 ms (§8.4). */
export const SEAM_MS = 450
export const SEAM_WIDTH = 1.6
export const SEAM_OPACITY = 0.9
export const SHADOW_OPACITY = 0.34
export const EMERGE_START_SCALE = 0.85
export const REDUCED_RISE = 0.1
export const CELEBRATE_RISE = 0.08
/** "A few degrees", one oscillation. */
export const CELEBRATE_ROLL = (4 * Math.PI) / 180
/** Extra clearance so the crown starts strictly under the clip plane. */
export const BELOW_EDGE_MARGIN = 0.04
/**
 * Re-perch duration when the anchor (host window) moves or the slots change.
 * Short enough to land inside the ~1.5 s bound (§7) on any frame rate.
 */
export const PERCH_MS = 500

/** Critically-ish damped spring: single ~4% overshoot (§8.4). */
const SPRING_OMEGA = 11
const SPRING_ZETA = 0.72

export const REST_POSE: Pose = { accentPulse: 0, fade: 1, rotationZ: 0, scale: 1, seam: 0, shadow: 1, yOffset: 0 }

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Damped spring step with a single overshoot, clamped to 1 at the deadline. */
export function springProgress(elapsedMs: number, durationMs: number): number {
  if (elapsedMs <= 0) {
    return 0
  }

  if (elapsedMs >= durationMs) {
    return 1
  }

  const t = elapsedMs / 1000
  const damped = SPRING_OMEGA * Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA)
  const decay = Math.exp(-SPRING_ZETA * SPRING_OMEGA * t)

  return 1 - decay * (Math.cos(damped * t) + ((SPRING_ZETA * SPRING_OMEGA) / damped) * Math.sin(damped * t))
}

/** The world-y offset that puts the whole avatar (crown included) under the edge. */
export function belowEdgeOffset(perchY: number, restY: number, height: number): number {
  return perchY - height / 2 - BELOW_EDGE_MARGIN - restY
}

/**
 * A re-perch: the anchor moved (host window move/resize) or the slots changed.
 * `from` is where the avatar was, `to` where the new perch line is.
 */
export interface PerchTween {
  fromX: number
  fromY: number
  toX: number
  toY: number
  /** `performance.now()` when `to` changed. */
  startedAt: number
}

export interface PerchPose {
  x: number
  y: number
}

/**
 * Ease-out cubic: arrives without overshoot, so the re-perch stays calm (no
 * bounce). Clamped at both ends like every other choreographed value.
 */
export function perchProgress(elapsedMs: number, durationMs: number = PERCH_MS): number {
  if (elapsedMs <= 0) {
    return 0
  }

  if (elapsedMs >= durationMs) {
    return 1
  }

  const t = elapsedMs / durationMs

  return 1 - (1 - t) ** 3
}

/**
 * The perch x/y at `elapsedMs` since the tween started — a PURE function of
 * elapsed time, not a damped step. A `damp` accumulates per frame, so with `dt`
 * clamped to 0.05 s it runs at roughly half real speed on the 10–18 fps
 * software-GL pane, which is what pushed the re-perch past its 1.5 s bound
 * (VAL-ANCHOR-002). Reading the pose straight from elapsed ms fixes it to the
 * wall clock however sparsely the pane draws.
 */
export function perchPose(tween: PerchTween, elapsedMs: number): PerchPose {
  const p = perchProgress(elapsedMs)

  return {
    x: tween.fromX + (tween.toX - tween.fromX) * p,
    y: tween.fromY + (tween.toY - tween.fromY) * p
  }
}

export function choreographyPose(input: ChoreographyInput): Pose {
  const { elapsedMs, height, perchY, phase, reducedMotion, restY } = input
  const t = Math.max(0, elapsedMs)

  // Reduced motion never plays the celebrate gesture: it settles immediately.
  if (phase === 'rest' || (phase === 'celebrating' && reducedMotion)) {
    return { ...REST_POSE }
  }

  if (phase === 'emerging') {
    if (reducedMotion) {
      const p = clamp01(t / REDUCED_MS)

      return { ...REST_POSE, fade: p, shadow: p, yOffset: 0 - REDUCED_RISE * (1 - p) }
    }

    const progress = springProgress(t, EMERGE_MS)

    return {
      accentPulse: 0,
      fade: 1,
      rotationZ: 0,
      scale: EMERGE_START_SCALE + (1 - EMERGE_START_SCALE) * progress,
      seam: clamp01(1 - t / SEAM_MS),
      shadow: progress,
      yOffset: belowEdgeOffset(perchY, restY, height) * (1 - progress)
    }
  }

  if (phase === 'hiding') {
    if (reducedMotion) {
      const p = clamp01(t / REDUCED_MS)

      return { ...REST_POSE, fade: 1 - p, shadow: 1 - p, yOffset: 0 - REDUCED_RISE * p }
    }

    const raw = clamp01(t / HIDE_MS)
    const eased = raw * raw * (3 - 2 * raw)

    return {
      accentPulse: 0,
      fade: 1,
      rotationZ: 0,
      scale: 1,
      // A reverse bloom that opens and closes with the sink, so no seam is left
      // glowing when HIDDEN removes the body.
      seam: Math.sin(Math.PI * raw),
      shadow: 1 - eased,
      yOffset: belowEdgeOffset(perchY, restY, height) * eased
    }
  }

  // Celebrating: one gesture — rise 0.08, a single small spring roll, a glow pulse.
  const p = clamp01(t / CELEBRATE_MS)
  const gesture = Math.sin(Math.PI * p)

  return {
    accentPulse: gesture,
    fade: 1,
    rotationZ: CELEBRATE_ROLL * gesture,
    scale: 1,
    seam: 0,
    shadow: 1,
    yOffset: CELEBRATE_RISE * gesture
  }
}
