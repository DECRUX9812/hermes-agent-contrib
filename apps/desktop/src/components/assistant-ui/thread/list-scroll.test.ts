import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  hasTranscriptTextSelection,
  resolveThreadScrollTarget,
  RUN_START_SNAP_THRESHOLD_PX,
  shouldAnchorBeforePrepend,
  shouldRePinOnTranscriptReload,
  shouldSnapOnRunStart,
  subscribeToThreadForeground
} from './list-scroll'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('subscribeToThreadForeground', () => {
  it('reanchors on focus when an active turn keeps document visibility pinned visible', () => {
    const reanchor = vi.fn()

    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)

      return 1
    })

    const unsubscribe = subscribeToThreadForeground(() => true, reanchor)

    window.dispatchEvent(new Event('focus'))

    expect(raf).toHaveBeenCalledOnce()
    expect(reanchor).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('leaves a scrolled-up reader in place when the window focuses', () => {
    const reanchor = vi.fn()
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const unsubscribe = subscribeToThreadForeground(() => false, reanchor)

    window.dispatchEvent(new Event('focus'))

    expect(raf).not.toHaveBeenCalled()
    expect(reanchor).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('drops a queued reanchor when the reader scrolls away before the frame', () => {
    const frames: FrameRequestCallback[] = []
    let following = true
    const reanchor = vi.fn()

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)

      return 7
    })

    const unsubscribe = subscribeToThreadForeground(() => following, reanchor)

    window.dispatchEvent(new Event('focus'))
    following = false
    frames[0]?.(0)

    expect(reanchor).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('cancels a queued reanchor when its thread unmounts', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const reanchor = vi.fn()

    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(9)

    const unsubscribe = subscribeToThreadForeground(() => true, reanchor)

    window.dispatchEvent(new Event('focus'))
    unsubscribe()

    expect(cancel).toHaveBeenCalledWith(9)
    expect(reanchor).not.toHaveBeenCalled()
  })

  // A macOS lock/unlock can produce neither `visibilitychange` nor `focus`:
  // the window is not occluded and never loses focus, so both listeners above
  // stay silent while rAF and ResizeObserver were frozen the whole time
  // (#92180). The main process signal is the only edge left.
  it('reanchors when the main process reports a power resume', () => {
    const reanchor = vi.fn()
    let fire: (() => void) | undefined

    vi.stubGlobal('hermesDesktop', {
      onPowerResume: (callback: () => void) => {
        fire = callback

        return () => {
          fire = undefined
        }
      }
    })

    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)

      return 1
    })

    const unsubscribe = subscribeToThreadForeground(() => true, reanchor)

    expect(fire).toBeTypeOf('function')
    fire?.()

    expect(raf).toHaveBeenCalledOnce()
    expect(reanchor).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('leaves a scrolled-up reader in place on a power resume', () => {
    const reanchor = vi.fn()
    let fire: (() => void) | undefined

    vi.stubGlobal('hermesDesktop', {
      onPowerResume: (callback: () => void) => {
        fire = callback

        return () => undefined
      }
    })
    const raf = vi.spyOn(window, 'requestAnimationFrame')

    const unsubscribe = subscribeToThreadForeground(() => false, reanchor)

    fire?.()

    expect(raf).not.toHaveBeenCalled()
    expect(reanchor).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('drops the power-resume subscription when its thread unmounts', () => {
    const off = vi.fn()

    vi.stubGlobal('hermesDesktop', { onPowerResume: () => off })

    subscribeToThreadForeground(() => true, vi.fn())()

    expect(off).toHaveBeenCalledOnce()
  })

  // powerMonitor fires on wake regardless of what the window is doing, so a
  // resume can arrive at a MINIMIZED window. Re-anchoring one is worse than
  // doing nothing: a hidden surface has no layout to measure, so the
  // virtualizer would re-record exactly the zeroed geometry this subscription
  // exists to replace, and the later visibilitychange would then find nothing
  // to correct. The visibility guard predates this edge; these two pin that
  // the new edge still routes through it, because "powerMonitor already
  // proves we are awake" is a plausible reason for someone to skip it later.
  it('does not reanchor a minimized window on a power resume', () => {
    const reanchor = vi.fn()
    let fire: (() => void) | undefined

    vi.stubGlobal('hermesDesktop', {
      onPowerResume: (callback: () => void) => {
        fire = callback

        return () => undefined
      }
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    const raf = vi.spyOn(window, 'requestAnimationFrame')
    const unsubscribe = subscribeToThreadForeground(() => true, reanchor)

    fire?.()

    expect(raf).not.toHaveBeenCalled()
    expect(reanchor).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('does not reanchor when the window is minimized between the resume and the frame', () => {
    const reanchor = vi.fn()
    let fire: (() => void) | undefined
    let visibility: DocumentVisibilityState = 'visible'

    vi.stubGlobal('hermesDesktop', {
      onPowerResume: (callback: () => void) => {
        fire = callback

        return () => undefined
      }
    })
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)

    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      // The user minimizes while the frame is queued: the entry guard passed,
      // the one inside the callback is the only thing left.
      visibility = 'hidden'
      callback(0)

      return 1
    })

    const unsubscribe = subscribeToThreadForeground(() => true, reanchor)

    fire?.()

    expect(raf).toHaveBeenCalledOnce()
    expect(reanchor).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('subscribes to nothing outside the desktop shell', () => {
    // The web build and every unit test render without a preload bridge; an
    // optional hop must stay optional rather than throwing on mount.
    const reanchor = vi.fn()

    expect(() => subscribeToThreadForeground(() => true, reanchor)()).not.toThrow()
  })
})

// Signature rows are `${index}:${id}:${role}:${weight}` (see the useAuiState
// selector in list.tsx).
describe('shouldAnchorBeforePrepend', () => {
  // Regression for #99920: the settle loop hands a bottom-pinned load back at
  // the first-paint height, BEFORE the backfill commits; skipping the anchor
  // there left the prepend re-pinned only by a ResizeObserver frames later —
  // a full-viewport lurch on every long-session switch.
  it('anchors an unsettled load that is pinned to the bottom', () => {
    expect(shouldAnchorBeforePrepend(false, { kind: 'bottom' })).toBe(true)
  })

  it('never anchors an unsettled offset restore still being applied', () => {
    expect(shouldAnchorBeforePrepend(false, { fromBottom: 3000, kind: 'offset' })).toBe(false)
    expect(shouldAnchorBeforePrepend(true, { fromBottom: 3000, kind: 'offset' })).toBe(true)
  })
})

describe('resolveThreadScrollTarget', () => {
  const context = (scrollElement: Pick<HTMLElement, 'scrollTop'>) => ({
    contentElement: document.createElement('div'),
    scrollElement: scrollElement as HTMLElement
  })

  it('settles when the browser clamps the requested bottom within half a CSS pixel', () => {
    let actualScrollTop = 0
    let writes = 0

    const scrollElement = {
      get scrollTop() {
        return actualScrollTop
      },
      set scrollTop(value: number) {
        writes += 1
        actualScrollTop = value - 0.125
      }
    }

    const target = 899

    const requested = resolveThreadScrollTarget(target, context(scrollElement))
    scrollElement.scrollTop = requested
    const settled = resolveThreadScrollTarget(target, context(scrollElement))

    expect(requested).toBe(target)
    expect(actualScrollTop).toBe(898.875)
    expect(settled).toBe(actualScrollTop)
    expect(actualScrollTop < settled).toBe(false)
    expect(writes).toBe(1)
  })

  it('keeps following while more than half a CSS pixel remains', () => {
    const scrollElement = { scrollTop: 898.25 }

    expect(resolveThreadScrollTarget(899, context(scrollElement))).toBe(899)
  })

  it('re-arms after streaming content increases the target', () => {
    const scrollElement = { scrollTop: 898.875 }

    expect(resolveThreadScrollTarget(899, context(scrollElement))).toBe(898.875)
    expect(resolveThreadScrollTarget(999, context(scrollElement))).toBe(999)
  })
})

describe('shouldSnapOnRunStart', () => {
  it('snaps when the viewport is already at the bottom', () => {
    expect(shouldSnapOnRunStart(0)).toBe(true)
  })

  it('snaps when the viewport is a line or two off the bottom', () => {
    expect(shouldSnapOnRunStart(RUN_START_SNAP_THRESHOLD_PX - 1)).toBe(true)
  })

  it('leaves a reader who has scrolled into history alone', () => {
    expect(shouldSnapOnRunStart(RUN_START_SNAP_THRESHOLD_PX)).toBe(false)
    expect(shouldSnapOnRunStart(400)).toBe(false)
  })
})

describe('shouldRePinOnTranscriptReload', () => {
  it('pins on a session switch even before the transcript has settled', () => {
    expect(shouldRePinOnTranscriptReload({ sessionSwitched: true, settledNonEmpty: false })).toBe(true)
  })

  it('pins on a session switch even when the prior session had settled', () => {
    expect(shouldRePinOnTranscriptReload({ sessionSwitched: true, settledNonEmpty: true })).toBe(true)
  })

  it('preserves the reader position on a same-session refresh after settling', () => {
    expect(shouldRePinOnTranscriptReload({ sessionSwitched: false, settledNonEmpty: true })).toBe(false)
  })

  it('pins on a cold-load arrival (same session, never settled non-empty)', () => {
    expect(shouldRePinOnTranscriptReload({ sessionSwitched: false, settledNonEmpty: false })).toBe(true)
  })
})

describe('hasTranscriptTextSelection', () => {
  let transcript: HTMLDivElement
  let outside: HTMLDivElement

  beforeEach(() => {
    transcript = document.createElement('div')
    transcript.textContent = 'streamed transcript text'
    outside = document.createElement('div')
    outside.textContent = 'composer text'
    document.body.append(transcript, outside)
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    transcript.remove()
    outside.remove()
  })

  const selectContents = (node: Node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    window.getSelection()?.addRange(range)
  }

  it('returns false with no selection', () => {
    expect(hasTranscriptTextSelection(transcript)).toBe(false)
  })

  it('returns false for a collapsed caret inside the transcript', () => {
    const range = document.createRange()
    range.setStart(transcript.firstChild!, 1)
    range.collapse(true)
    window.getSelection()?.addRange(range)

    expect(window.getSelection()!.isCollapsed).toBe(true)
    expect(hasTranscriptTextSelection(transcript)).toBe(false)
  })

  it('returns true for a non-collapsed selection inside the transcript', () => {
    selectContents(transcript)

    expect(window.getSelection()!.isCollapsed).toBe(false)
    expect(hasTranscriptTextSelection(transcript)).toBe(true)
  })

  it('returns false when the selection is outside the transcript', () => {
    selectContents(outside)

    expect(window.getSelection()!.isCollapsed).toBe(false)
    expect(hasTranscriptTextSelection(transcript)).toBe(false)
  })
})

describe('resolveThreadScrollTarget while selecting', () => {
  let scrollElement: HTMLDivElement

  beforeEach(() => {
    scrollElement = document.createElement('div')
    scrollElement.textContent = 'streamed transcript text'
    document.body.append(scrollElement)
    // No layout in the test DOM: pin a scroll offset as an own property.
    Object.defineProperty(scrollElement, 'scrollTop', { configurable: true, value: 100 })
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    scrollElement.remove()
  })

  const contextFor = () => ({
    contentElement: document.createElement('div'),
    scrollElement
  })

  it('holds position instead of following while a selection lives in the transcript', () => {
    const range = document.createRange()
    range.selectNodeContents(scrollElement)
    window.getSelection()?.addRange(range)

    expect(resolveThreadScrollTarget(999, contextFor())).toBe(100)
  })

  it('resumes following once the selection collapses', () => {
    const range = document.createRange()
    range.selectNodeContents(scrollElement)
    window.getSelection()?.addRange(range)
    expect(resolveThreadScrollTarget(999, contextFor())).toBe(100)

    window.getSelection()?.removeAllRanges()

    expect(resolveThreadScrollTarget(999, contextFor())).toBe(999)
  })
})

// Regression guard for #90473 / #96606 / #96875: after "Show earlier" has paged
// a session to its very top, the opening user message must still be rendered
// and head the visible set — it must never be swallowed by the hidden-slice
// cut. The store window keeps at least TRANSCRIPT_WINDOW_MIN_MESSAGES (30) and
// the DOM budget only hides a contiguous prefix, so for a light transcript that
// fits the budget the first user message is the first visible group.
describe('first user message is never swallowed (Show-earlier paging)', () => {
  it('keeps the opening user greeting visible when the render budget covers the whole transcript', () => {
    const groups = buildGroups(
      signature([
        ['u1', 'user', 1],
        ['a1', 'assistant', 4],
        ['a2', 'assistant', 2],
        ['u2', 'user', 1],
        ['a3', 'assistant', 3]
      ])
    )

    // A render budget at or above the total weight hides nothing — the state
    // after "Show earlier" has paged to the top of a light session.
    const totalWeight = groups.reduce((sum, g) => sum + g.weight, 0)
    const hidden = firstVisibleGroupIndex(groups, totalWeight)

    expect(hidden).toBe(0)
    // The first user message is the head of the visible set, not dropped.
    expect(groups[0]?.id).toBe('u1')
  })

  it('a leading assistant message (tool-only opening turn) does not hide the first user message', () => {
    const groups = buildGroups(
      signature([
        ['a0', 'assistant', 2],
        ['u1', 'user', 1],
        ['a1', 'assistant', 4],
        ['u2', 'user', 1],
        ['a2', 'assistant', 3]
      ])
    )

    const totalWeight = groups.reduce((sum, g) => sum + g.weight, 0)
    const hidden = firstVisibleGroupIndex(groups, totalWeight)

    expect(hidden).toBe(0)
    // The first user message survives as a distinct visible group.
    expect(groups.some(g => g.id === 'u1')).toBe(true)
  })
})
