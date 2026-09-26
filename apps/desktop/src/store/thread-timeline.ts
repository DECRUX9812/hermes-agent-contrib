import { atom } from 'nanostores'

import { persistBoolean, storedBoolean } from '@/lib/storage'

const HIDE_THREAD_TIMELINE_STORAGE_KEY = 'hermes.desktop.hideThreadTimeline'

/** Desktop-local appearance preference, shared by all threads in this window. */
export const $hideThreadTimeline = atom(storedBoolean(HIDE_THREAD_TIMELINE_STORAGE_KEY, false))

$hideThreadTimeline.subscribe(value => persistBoolean(HIDE_THREAD_TIMELINE_STORAGE_KEY, value))

export function setHideThreadTimeline(value: boolean) {
  $hideThreadTimeline.set(value)
}

// --- Scrubber (density minimap) -------------------------------------------
// Pure fraction math for the transcript minimap: the strip maps a marker's
// document position to a fraction of scrollHeight, and a pointer's strip
// fraction back to a scrollTop of the scrollable range. Tested in
// thread-timeline.test.ts.

export type ScrubberMarkerKind = 'approval' | 'tool' | 'user'

export interface ScrubberMarker {
  kind: ScrubberMarkerKind
  /** 0 = top of the scrolled document, 1 = bottom. */
  fraction: number
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** An element's document offset → its minimap strip fraction. */
export function scrubberMarkerFraction(offsetTop: number, scrollHeight: number): number {
  if (!Number.isFinite(offsetTop) || !Number.isFinite(scrollHeight) || scrollHeight <= 0) {
    return 0
  }

  return clamp01(offsetTop / scrollHeight)
}

/** A pointer's strip fraction → the scrollTop that puts that document position
 *  at the top of the viewport (clamped to the scrollable range). */
export function scrubberFractionToScrollTop(fraction: number, scrollHeight: number, clientHeight: number): number {
  const range = Math.max(0, scrollHeight - clientHeight)

  return clamp01(fraction) * range
}

/** scrollTop → the viewport-window band on the strip ({top, height} as 0..1
 *  fractions). A document no taller than its viewport fills the strip. */
export function scrubberViewportWindow(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): { height: number; top: number } {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) {
    return { height: 1, top: 0 }
  }

  return {
    height: clamp01(clientHeight / scrollHeight),
    top: clamp01(scrollTop / scrollHeight)
  }
}
