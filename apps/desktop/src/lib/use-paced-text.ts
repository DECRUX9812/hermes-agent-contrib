import { useEffect, useRef, useState } from 'react'

import { initialPacing, type PacingState, stepPacing } from './stream-pacing'

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
