/**
 * Stream pacing — reveal streamed text at a steady cadence instead of in the
 * bursts the network delivers it in. Adapted from Codex's TUI commit-tick
 * policy (codex-rs/tui/src/streaming/chunking.rs): two gears with hysteresis.
 *
 * - Smooth: reveal a fraction of the backlog each frame (an exponential ease
 *   with a ~SMOOTH_TIME_CONSTANT_MS time constant), so a 400-char burst flows
 *   in over a few frames rather than landing at once.
 * - Catch-up: when the backlog is deep or its oldest text has waited too long,
 *   reveal everything — the display must never fall behind the model.
 *
 * Catch-up exits only after pressure stays low for EXIT_HOLD_MS, and does not
 * re-enter for REENTER_HOLD_MS after exiting unless the backlog is severe, so
 * the two gears don't flap near the thresholds (Codex's hysteresis, same
 * shape). Pure: the hook feeds it time and lengths; it never touches the DOM.
 */

export type PacingMode = 'catch-up' | 'smooth'

export interface PacingState {
  belowExitSince: null | number
  lastExitAt: null | number
  mode: PacingMode
  /** Characters currently revealed. */
  shown: number
}

export interface PacingInput {
  /** Frame time delta in ms. */
  dt: number
  now: number
  /** How long the oldest unrevealed character has been waiting, in ms. */
  oldestAgeMs: number
  /** Characters received so far. */
  target: number
}

const SMOOTH_TIME_CONSTANT_MS = 90
const ENTER_BACKLOG_CHARS = 1200
const ENTER_AGE_MS = 350
const EXIT_BACKLOG_CHARS = 80
const EXIT_AGE_MS = 60
const EXIT_HOLD_MS = 250
const REENTER_HOLD_MS = 250
const SEVERE_BACKLOG_CHARS = 6000
const SEVERE_AGE_MS = 900

export const initialPacing = (shown = 0): PacingState => ({
  belowExitSince: null,
  lastExitAt: null,
  mode: 'smooth',
  shown
})

export function stepPacing(state: PacingState, { dt, now, oldestAgeMs, target }: PacingInput): PacingState {
  const backlog = target - state.shown

  if (backlog <= 0) {
    return {
      ...state,
      belowExitSince: null,
      lastExitAt: state.mode === 'catch-up' ? now : state.lastExitAt,
      mode: 'smooth',
      shown: target
    }
  }

  let { belowExitSince, lastExitAt, mode } = state

  if (mode === 'smooth') {
    const pressured = backlog >= ENTER_BACKLOG_CHARS || oldestAgeMs >= ENTER_AGE_MS
    const severe = backlog >= SEVERE_BACKLOG_CHARS || oldestAgeMs >= SEVERE_AGE_MS
    const holding = lastExitAt !== null && now - lastExitAt < REENTER_HOLD_MS

    if (pressured && (!holding || severe)) {
      mode = 'catch-up'
      belowExitSince = null
      lastExitAt = null
    }
  } else if (backlog <= EXIT_BACKLOG_CHARS && oldestAgeMs <= EXIT_AGE_MS) {
    if (belowExitSince === null) {
      belowExitSince = now
    } else if (now - belowExitSince >= EXIT_HOLD_MS) {
      mode = 'smooth'
      belowExitSince = null
      lastExitAt = now
    }
  } else {
    belowExitSince = null
  }

  const step =
    mode === 'catch-up'
      ? backlog
      : Math.max(1, Math.ceil(backlog * (1 - Math.exp(-Math.max(0, dt) / SMOOTH_TIME_CONSTANT_MS))))

  return { belowExitSince, lastExitAt, mode, shown: Math.min(target, state.shown + step) }
}
