/**
 * The generic rotating accent's angular advance (architecture §8.4).
 *
 * The accent (Muse's halo, Claude's spark) turns ONLY while the avatar is
 * thinking. The rig used to damp a spin speed toward zero, so residual speed
 * kept advancing the angle through celebrating and idle — a visible state-cue
 * leak and a violation of the taste rule ("no spinning for no reason", §8.3).
 *
 * Gating the INTEGRATION on `thinking` keeps the angle constant outside it: the
 * speed may ramp up softly inside the state, but it never advances the angle
 * once the state has moved on. Pure, so the behaviour is provable without a
 * running pane.
 */

import { approach } from '../avatars/accent'

/** The accent's design speed while thinking (§8.4): 0.3 revolutions/second. */
export const ACCENT_SPIN_REV_PER_S = 0.3
/** Time constant for the spin's ramp-up, seconds (§8.4). */
export const ACCENT_SPIN_SMOOTH_S = 0.4

const TAU = Math.PI * 2

export interface AccentSpinState {
  /** Accumulated rotation, radians. */
  spin: number
  /** Current angular speed, revolutions/second; 0 at rest. */
  speed: number
}

export function restAccentSpin(): AccentSpinState {
  return { speed: 0, spin: 0 }
}

/**
 * One frame of the accent's rotation. Not thinking returns the angle unchanged
 * (and the same object once already at rest), so a residual speed can never
 * keep the accent spinning in celebrating or idle.
 */
export function stepAccentSpin(current: AccentSpinState, thinking: boolean, dt: number): AccentSpinState {
  if (!thinking) {
    return current.speed === 0 ? current : { speed: 0, spin: current.spin }
  }

  const speed = approach(current.speed, ACCENT_SPIN_REV_PER_S, dt, ACCENT_SPIN_SMOOTH_S)

  return { speed, spin: current.spin + speed * TAU * dt }
}
