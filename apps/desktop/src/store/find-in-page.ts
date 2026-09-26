import { atom } from 'nanostores'

import { TIMELINE_REVEAL_EVENT, type TimelineRevealRequest } from '@/components/assistant-ui/thread/timeline-data'
import {
  activateHitWithinRow,
  captureFindScope,
  currentFindScope,
  performScopedFind,
  releaseFindScope,
  transcriptViewportForScope
} from '@/lib/find-in-page-scope'
import {
  loadTranscriptFindCorpus,
  searchTranscriptRows,
  type TranscriptFindMatch,
  transcriptFindTarget
} from '@/store/transcript-find'

export interface FindInPageState {
  active: boolean
  query: string
  matchOrdinal: number
  matchCount: number
  /** True when the match count hit the history cap — the label renders "n/500+". */
  matchCapped: boolean
  /** Transcript-scoped mode: matches come from the session's stored messages,
   *  and stepping materializes out-of-window rows via the reveal machinery
   *  instead of walking the DOM. */
  history: boolean
  /** Bumped when openFindBar() is called while the bar is already visible, so
   *  FindBar can refocus without treating the chord as a fresh open. */
  focusRequest: number
}

const EMPTY: FindInPageState = {
  active: false,
  query: '',
  matchOrdinal: 0,
  matchCount: 0,
  matchCapped: false,
  history: false,
  focusRequest: 0
}

// ── History-mode state (module-level, like the scope observer in
// lib/find-in-page-scope.ts): the current match list, a token fencing stale
// async work, and the in-flight reveal so a newer query cancels it.
let historyMatches: TranscriptFindMatch[] = []
let historySearchToken = 0
let historyAbort: AbortController | null = null

function resetHistoryFind(): void {
  historyMatches = []
  historySearchToken += 1
  historyAbort?.abort()
  historyAbort = null
}

export const $findInPage = atom<FindInPageState>({ ...EMPTY })

/**
 * Open the find bar and capture the CURRENT VIEW as the search scope.
 *
 * Capturing once at open time (rather than re-resolving on every keystroke)
 * means a mid-search route change can't silently re-home the highlights onto
 * a different session — the FindBar's `useLocation` cleanup closes the bar
 * before the route flips, so the scope the user actually sees in the input
 * is the only one ever searched. See apps/desktop/src/components/find-bar.tsx
 * for the route-change close logic; see lib/find-in-page-scope.ts for the
 * "current view" predicate (#81726).
 */
export function openFindBar(): void {
  const prev = $findInPage.get()

  if (prev.active) {
    // Already visible: keep the typed query and the captured scope. A fresh
    // EMPTY write would clear the query, and captureFindScope() would tear
    // down the highlight observer.
    $findInPage.set({ ...prev, focusRequest: prev.focusRequest + 1 })

    return
  }

  $findInPage.set({ ...EMPTY, active: true })
  captureFindScope()
}

export function closeFindBar(): void {
  // Already closed: don't re-issue clear. Escape is a shared gesture (the
  // switcher and dialogs claim it too), so a stray second close must not
  // re-strip highlights from a bar that has already been torn down.
  if (!$findInPage.get().active) {
    return
  }

  resetHistoryFind()
  $findInPage.set({ ...EMPTY })
  // Strip highlights and the scope marker from the DOM we previously wrapped.
  releaseFindScope()
}

/** Toggle transcript-scoped "search all history" mode; the current query is
 *  re-run against whichever engine the mode selects. */
export function setFindHistoryMode(history: boolean): void {
  const prev = $findInPage.get()

  if (!prev.active || prev.history === history) {
    return
  }

  resetHistoryFind()
  $findInPage.set({ ...prev, history })
  void setFindQuery(prev.query)
}

export async function setFindQuery(query: string): Promise<void> {
  const prev = $findInPage.get()

  // Never search for a closed bar. The component clears its debounce on
  // close, but a timer that already fired (or any late caller) must not
  // re-wrap matches after the user pressed Escape.
  if (!prev.active) {
    return
  }

  if (prev.history) {
    await runHistoryFind(query)

    return
  }

  if (!query) {
    $findInPage.set({ ...prev, query: '', matchOrdinal: 0, matchCount: 0, matchCapped: false })
    const scope = currentFindScope()

    if (scope) {
      // Re-run the scoped walker with an empty query — same code path,
      // strips highlights + zeroes the counter without special-casing.
      performScopedFind(scope, '', { forward: true, findNext: false })
    }

    return
  }

  const scope = currentFindScope()

  if (!scope) {
    // No chat surface to search (e.g. settings page, command center). The
    // bar still accepts a query for parity with the bridge-driven path, but
    // matches will be zero — there's nothing on screen that IS a "view".
    $findInPage.set({ ...prev, query, matchOrdinal: 0, matchCount: 0, matchCapped: false })

    return
  }

  const result = performScopedFind(scope, query, { forward: true, findNext: false })

  $findInPage.set({ ...prev, query, matchOrdinal: result.activeOrdinal, matchCount: result.count, matchCapped: false })
}

export function findNext(): void {
  step(true)
}

export function findPrevious(): void {
  step(false)
}

function step(forward: boolean): void {
  const { query, history, matchOrdinal } = $findInPage.get()

  if (!query) {
    return
  }

  if (history) {
    stepHistoryMatch(forward ? 1 : -1)

    return
  }

  const scope = currentFindScope()

  if (!scope) {
    return
  }

  const result = performScopedFind(scope, query, { forward, findNext: true })

  $findInPage.set({ ...$findInPage.get(), matchOrdinal: result.activeOrdinal, matchCount: result.count })
}

// ── Transcript-scoped search ────────────────────────────────────────────────
// History mode searches the session's STORED messages (paged REST reads,
// cached for a TTL) instead of the rendered DOM. Matches navigate by rowId
// through the same reveal machinery the timeline rail uses — the render
// budget and use-stick-to-bottom keep sole ownership of the transcript, and
// an out-of-window row is materialized by `revealRow`, never scrolled to
// directly. When the surface has no stored history (a draft, a pane that isn't
// a chat, a backend too old to answer) the mode degrades to the DOM walker
// for whatever is rendered.

async function runHistoryFind(query: string): Promise<void> {
  const token = ++historySearchToken

  historyAbort?.abort()
  historyAbort = null

  if (!query) {
    historyMatches = []
    $findInPage.set({ ...$findInPage.get(), query: '', matchOrdinal: 0, matchCount: 0, matchCapped: false })
    const scope = currentFindScope()

    if (scope) {
      performScopedFind(scope, '', { forward: true, findNext: false })
    }

    return
  }

  const scope = currentFindScope()

  if (!scope) {
    $findInPage.set({ ...$findInPage.get(), query, matchOrdinal: 0, matchCount: 0, matchCapped: false })

    return
  }

  const target = transcriptFindTarget(scope)

  if (!target) {
    runHistoryDomFallback(scope, query)

    return
  }

  const controller = new AbortController()
  historyAbort = controller

  const corpus = await loadTranscriptFindCorpus(target, controller.signal).catch(() => null)

  if (token !== historySearchToken || controller.signal.aborted || !$findInPage.get().active) {
    return
  }

  if (!corpus) {
    runHistoryDomFallback(scope, query)

    return
  }

  const { matches, capped } = searchTranscriptRows(corpus.rows, query)

  historyMatches = matches
  $findInPage.set({
    ...$findInPage.get(),
    query,
    matchOrdinal: matches.length > 0 ? 1 : 0,
    matchCount: matches.length,
    matchCapped: capped
  })

  if (matches.length > 0) {
    await revealHistoryMatch(scope, query, 0, token)
  }
}

/** History-unavailable path: whatever the DOM walker can see still counts. */
function runHistoryDomFallback(scope: HTMLElement, query: string): void {
  historyMatches = []
  const result = performScopedFind(scope, query, { forward: true, findNext: false })

  $findInPage.set({
    ...$findInPage.get(),
    query,
    matchOrdinal: result.activeOrdinal,
    matchCount: result.count,
    matchCapped: false
  })
}

function stepHistoryMatch(direction: 1 | -1): void {
  const count = historyMatches.length

  if (!count) {
    return
  }

  const state = $findInPage.get()
  const current = Math.min(Math.max(state.matchOrdinal - 1, 0), count - 1)
  const next = (current + direction + count) % count

  $findInPage.set({ ...state, matchOrdinal: next + 1 })

  const scope = currentFindScope()

  if (scope) {
    void revealHistoryMatch(scope, state.query, next, historySearchToken)
  }
}

/**
 * Materialize the row a history match lives in and highlight the specific
 * occurrence inside it. The jump goes through TIMELINE_REVEAL_EVENT — the
 * transcript's own reveal path — so `use-stick-to-bottom` remains the only
 * scroll owner and the render budget decides what materializes.
 */
async function revealHistoryMatch(
  scope: HTMLElement,
  query: string,
  index: number,
  token: number
): Promise<void> {
  const match = historyMatches[index]
  const viewport = match && transcriptViewportForScope(scope)

  if (!match || !viewport) {
    return
  }

  const controller = new AbortController()
  historyAbort = controller

  const revealedId = await new Promise<false | string>(resolve => {
    let settled = false

    const finish = (value: false | string) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(value)
    }

    const timeout = window.setTimeout(() => finish(false), 15_000)

    const detail: TimelineRevealRequest = {
      id: `history:${match.rowId}`,
      rowId: match.rowId,
      signal: controller.signal,
      complete: finish
    }

    controller.signal.addEventListener('abort', () => finish(false), { once: true })
    viewport.dispatchEvent(new CustomEvent(TIMELINE_REVEAL_EVENT, { detail }))
  })

  if (token !== historySearchToken || controller.signal.aborted || revealedId === false) {
    return
  }

  const row = scope.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(revealedId)}"]`)

  if (!row) {
    return
  }

  if (activateHitWithinRow(scope, query, row, match.occurrence)) {
    return
  }

  // The row materialized but the DOM walker could not wrap the match (a hit
  // spanning element boundaries): land on the row itself, the same arithmetic
  // the timeline rail applies after a reveal — a scrollTop write, never a
  // scrollIntoView on the row.
  const destination = Math.max(
    0,
    row.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 8
  )

  viewport.scrollTop = destination
}

/** Called by the preload bridge when `found-in-page` fires on webContents.
 *  Retained for the multi-window case (a secondary session window still uses
 *  the Electron bridge — see electron/find-in-page.ts); the renderer-side
 *  walker for the primary window never fires this. */
export function updateFindResults(activeMatch: number, count: number): void {
  const prev = $findInPage.get()
  $findInPage.set({ ...prev, matchOrdinal: activeMatch, matchCount: count })
}

// The found-in-page subscription is process-wide, not per-mount: the FindBar
// lives in the global overlay set and the shell remounts it on a connection
// re-home (soft switch) while route changes keep it alive. Refcount the single
// bridge listener so a remount cannot stack duplicate subscriptions — every
// stacked listener would re-dispatch the same result and, worse, outlive its
// component.
let listenerRefs = 0
let detachListener: (() => void) | undefined

/**
 * Subscribe to `found-in-page` results. Returns a release fn; the underlying
 * bridge listener is installed on the first subscriber and removed when the
 * last one releases. Safe to call from an effect with a `[]` dep list.
 *
 * Kept for secondary-window renderers that still drive search via the
 * Electron bridge. The primary window's renderer-side walker calls
 * `updateFindResults` synchronously and never wires this listener.
 */
export function initFindInPageListener(): () => void {
  listenerRefs += 1

  if (listenerRefs === 1) {
    detachListener = window.hermesDesktop?.onFoundInPage?.(result => {
      updateFindResults(result.activeMatchOrdinal, result.count)
    })
  }

  let released = false

  return () => {
    // Guard double-release: React can invoke a cleanup once, but a caller
    // holding the fn shouldn't be able to drive the refcount negative.
    if (released) {
      return
    }

    released = true
    listenerRefs -= 1

    if (listenerRefs === 0) {
      detachListener?.()
      detachListener = undefined
    }
  }
}

/** Test seam: number of live bridge subscriptions (0 or 1 in practice). */
export function findInPageListenerCount(): number {
  return listenerRefs
}

/**
 * Test seam: force-detach the bridge listener and zero the refcount.
 * Production code never calls this — tests use it so one case's leaked
 * subscription can't bleed into the next.
 */
export function resetFindInPageListenerForTest(): void {
  detachListener?.()
  detachListener = undefined
  listenerRefs = 0
}

// Same refcount pattern as `initFindInPageListener`, but for the
// "main-process Ctrl/Cmd+F forwarded to renderer" channel. On Pop!_OS /
// GNOME-based Linux distros the GTK compositor grabs Ctrl+F before the
// renderer's keydown listener can fire — the main process intercepts the
// chord via `before-input-event` and emits this IPC, so the renderer can
// still open the FindBar (#81727).
let openFindBarRefs = 0
let detachOpenFindBar: (() => void) | undefined

export function initOpenFindBarListener(): () => void {
  openFindBarRefs += 1

  if (openFindBarRefs === 1) {
    detachOpenFindBar = window.hermesDesktop?.onOpenFindBarRequested?.(() => {
      openFindBar()
    })
  }

  let released = false

  return () => {
    if (released) {
      return
    }

    released = true
    openFindBarRefs -= 1

    if (openFindBarRefs === 0) {
      detachOpenFindBar?.()
      detachOpenFindBar = undefined
    }
  }
}

/** Test seam: number of live "open find bar" subscriptions. */
export function openFindBarListenerCount(): number {
  return openFindBarRefs
}

/** Test seam: detach the open-find-bar bridge listener and zero the refcount. */
export function resetOpenFindBarListenerForTest(): void {
  detachOpenFindBar?.()
  detachOpenFindBar = undefined
  openFindBarRefs = 0
}
