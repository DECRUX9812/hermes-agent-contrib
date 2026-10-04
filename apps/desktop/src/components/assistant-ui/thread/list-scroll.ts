import type { GetTargetScrollTop } from 'use-stick-to-bottom'

import type { ThreadScrollState } from '@/store/thread-scroll'

// Transcript scroll/reanchor helpers: selection pinning, snap thresholds,
// foreground re-anchoring. Pure — the list component owns the scroller itself.

// Whether a backfill step may record its distance-from-bottom anchor. A
// settled load has a position the user chose. An UNSETTLED load only has one
// when it is pinned to the bottom: the settle loop rewrites scrollTop to the
// bottom every frame, so the measured distance is the truth and the restore
// effect re-pins in the same commit the taller tree lands in. An unsettled
// OFFSET load is still being applied — recording it would clobber the
// remembered offset with a way-point (#99920 regressed exactly this way).
export const shouldAnchorBeforePrepend = (settled: boolean, target: ThreadScrollState): boolean =>
  settled || target.kind === 'bottom'

// Browsers may quantize a requested scrollTop to a nearby device-pixel
// boundary. use-stick-to-bottom otherwise compares the lower actual value to
// the integer target forever, re-requesting the same instant scroll every
// frame. Treat a subpixel remainder as achieved; larger gaps still follow new
// streamed content normally.
const SCROLL_TARGET_EPSILON_PX = 0.5

// True while the user holds a non-collapsed text selection inside the
// transcript. use-stick-to-bottom only pauses for a selection while the mouse
// button is still down — a selection that persists after mouse-up must also
// pin the viewport, or streaming growth yanks it out from under the user
// (#115464). A collapsed caret (or a selection outside the transcript, e.g.
// in the composer) never pins.
export function hasTranscriptTextSelection(scrollElement?: Element | null): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  const selection = document.getSelection()

  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false
  }

  if (!scrollElement) {
    return true
  }

  const { anchorNode, focusNode } = selection

  return Boolean((anchorNode && scrollElement.contains(anchorNode)) || (focusNode && scrollElement.contains(focusNode)))
}

export const resolveThreadScrollTarget: GetTargetScrollTop = (targetScrollTop, { scrollElement }) => {
  if (hasTranscriptTextSelection(scrollElement)) {
    return scrollElement.scrollTop
  }

  const currentScrollTop = scrollElement.scrollTop
  const remaining = targetScrollTop - currentScrollTop

  return remaining >= 0 && remaining <= SCROLL_TARGET_EPSILON_PX ? currentScrollTop : targetScrollTop
}

/** Near-bottom slack for a run-start snap. Wider than the subpixel epsilon
 *  use-stick-to-bottom uses for resize follow — a follow-up sent a line or two
 *  off the bottom should still track, but a reader in history must not yank. */
export const RUN_START_SNAP_THRESHOLD_PX = 64

export function shouldSnapOnRunStart(remainingPx: number, thresholdPx = RUN_START_SNAP_THRESHOLD_PX): boolean {
  return remainingPx < thresholdPx
}

// True when the pin-to-bottom settle should re-arm. A same-session refresh
// (transcript briefly emptied and repopulated under the same key) must keep
// the reader's position; only a session switch or a cold-load arrival re-pins.
export function shouldRePinOnTranscriptReload(opts: { sessionSwitched: boolean; settledNonEmpty: boolean }): boolean {
  return opts.sessionSwitched || !opts.settledNonEmpty
}

export function subscribeToThreadForeground(shouldReanchor: () => boolean, onReanchor: () => void): () => void {
  let frameId: number | null = null
  let framePending = false

  const onForeground = () => {
    if (framePending || document.visibilityState !== 'visible' || !shouldReanchor()) {
      return
    }

    framePending = true

    const scheduledId = requestAnimationFrame(() => {
      frameId = null
      framePending = false

      if (document.visibilityState === 'visible' && shouldReanchor()) {
        onReanchor()
      }
    })

    // Browser callbacks are asynchronous; the guard also keeps synchronous
    // requestAnimationFrame test doubles from leaving a completed frame pending.
    if (framePending) {
      frameId = scheduledId
    }
  }

  document.addEventListener('visibilitychange', onForeground)
  window.addEventListener('focus', onForeground)
  // Third edge, because the two above can BOTH miss a wake. A macOS screen
  // lock or display sleep freezes rAF and ResizeObserver, but an Electron
  // window that is never occluded and never loses focus stays
  // `visibilityState: 'visible'` and fires no `focus`, so nothing re-anchors
  // and the transcript is left holding measurements taken before the freeze
  // (#92180). The main process already publishes the signal that does fire:
  // powerMonitor `resume` / `unlock-screen` -> `hermes:power-resume`.
  // use-gateway-boot subscribes to it as a peer of focus/visibility for
  // exactly this reason; this view documents the same need and was listening
  // to only two of the three.
  const offPowerResume = window.hermesDesktop?.onPowerResume?.(onForeground)

  return () => {
    document.removeEventListener('visibilitychange', onForeground)
    window.removeEventListener('focus', onForeground)
    offPowerResume?.()

    if (frameId !== null) {
      cancelAnimationFrame(frameId)
    }

    frameId = null
    framePending = false
  }
}
