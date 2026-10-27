import { useEffect, useRef, useState } from 'react'

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

/** Reveal commits are capped near the stream flusher's own ~30fps budget, so
 *  pacing smooths the cadence without adding markdown renders. */
const COMMIT_INTERVAL_MS = 33

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The part of a streaming `text` to show right now (see lib/stream-pacing.ts).
 * Only ever grows while the text grows by appending; anything else — the
 * stream settling, text replaced or shortened, reduced motion — shows the
 * full text immediately. State lives in refs keyed to nothing but the text
 * itself, so a new part object with the same text never restarts the reveal
 * (the flash that ruled out assistant-ui's `smooth`).
 */
export function usePacedText(text: string, running: boolean): string {
  // Whatever exists at mount is already "delivered" — opening a chat
  // mid-stream must not re-type its history; only later appends are paced.
  const pacing = useRef<PacingState>(initialPacing(text.length))
  const previous = useRef(text)
  /** Arrival time of each growth step: [length reached, at]. */
  const arrivals = useRef<[number, number][]>([])
  const [, setTick] = useState(0)
  const bypass = !running || prefersReducedMotion()

  if (text !== previous.current) {
    const appended = text.startsWith(previous.current)

    if (appended && !bypass) {
      arrivals.current.push([text.length, performance.now()])
    } else {
      pacing.current = initialPacing(text.length)
      arrivals.current = []
    }

    previous.current = text
  }

  if (bypass && pacing.current.shown !== text.length) {
    pacing.current = initialPacing(text.length)
    arrivals.current = []
  }

  const behind = pacing.current.shown < text.length

  // The rAF reveal loop advances refs it owns; nothing here mirrors an atom.
  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (bypass || !behind) {
      return
    }

    let frame = 0
    let last = performance.now()
    let lastCommit = 0

    const tick = (now: number) => {
      const target = previous.current.length
      const shown = pacing.current.shown
      const waiting = arrivals.current.find(([length]) => length > shown)
      const oldestAgeMs = waiting ? now - waiting[1] : 0
      pacing.current = stepPacing(pacing.current, { dt: now - last, now, oldestAgeMs, target })
      last = now
      arrivals.current = arrivals.current.filter(([length]) => length > pacing.current.shown)

      if (now - lastCommit >= COMMIT_INTERVAL_MS || pacing.current.shown >= target) {
        lastCommit = now
        setTick(n => n + 1)
      }

      if (pacing.current.shown < target) {
        frame = requestAnimationFrame(tick)
      }
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [behind, bypass, text])

  return bypass ? text : text.slice(0, pacing.current.shown)
}
