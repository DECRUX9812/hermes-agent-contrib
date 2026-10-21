import { atom } from 'nanostores'

export const paneClosers: Record<string, () => void> = {}
export const paneOpeners: Record<string, () => void> = {}

/** Pane ids whose Close an app store owns. True for the main workspace, whose
 *  pane can't leave the tree but whose TAB can still be emptied — the close
 *  GESTURE (⌘-click / middle-click) keys off this rather than `uncloseable`.
 *  An atom, not a lookup: a closer registered by a wiring EFFECT lands after
 *  the strip's first paint, and a plain read would leave that tab gestureless
 *  until something else happened to re-render it. */
export const $panesWithCloser = atom<ReadonlySet<string>>(new Set())

/** Route a pane's Close through the app store that owns its visibility.
 *  Passing no closer unregisters (a wiring effect's cleanup). */
export function registerPaneCloser(paneId: string, close?: () => void) {
  if (close) {
    paneClosers[paneId] = close
  } else {
    delete paneClosers[paneId]
  }

  $panesWithCloser.set(new Set(Object.keys(paneClosers)))
}

/**
 * Route a pane's "show it" intent through the app store that owns its
 * visibility — the mirror of `registerPaneCloser`, so a preset can reveal a
 * toggle-gated pane (e.g. the terminal, whose visibility ⌃`/`$terminalTakeover`
 * owns) while the toggle stays truthful. Applying a preset opens every pane it
 * places, except the ones it places resting.
 */
export function registerPaneOpener(paneId: string, open: () => void) {
  paneOpeners[paneId] = open
}

// TOOL PANELS (terminal, logs, …): their toggle COLLAPSES the zone to a rail
// (tab stays) instead of hiding it, and the tab's ✕ REMOVES it (vs a session
// tile, whose ✕ closes the session). Membership tells the renderer which
// semantics a tab gets. See bindPaneCollapse in the controller.
const collapsePanes = new Set<string>()

export function markCollapsePane(paneId: string) {
  collapsePanes.add(paneId)
}

export function isCollapsePane(paneId: string): boolean {
  return collapsePanes.has(paneId)
}

export const resetHandlers = new Set<() => void>()

/** Run during a layout reset, BEFORE generic adoption — lets an owner
 *  pre-place its panes into the fresh default tree (session tiles collapse
 *  into main as tabs) so adoption sees them already placed and never scatters
 *  them to their old edges. */
export function registerLayoutResetHandler(fn: () => void): () => void {
  resetHandlers.add(fn)

  return () => {
    resetHandlers.delete(fn)
  }
}
