// PANE ROLES + VISIBILITY STATE
// What a pane is (kind predicates), who can close/open it, which panes chrome
// toggles have hidden or dismissed, and the strip-tab subset of that state.

import {
  atom,
  computed,
  type ReadableAtom
} from 'nanostores'

import { registry } from '@/contrib/registry'
import { translateNow } from '@/i18n'
import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { modeLayout } from '@/store/interface-mode'
import { notify } from '@/store/notifications'

import {
  findGroupOfPane,
  setActivePane as setActivePaneOp
} from './model'
import { paneChrome } from './renderer/track-model'
import { $layoutTree, commit, paneGroup, paneSetCodec, toggledSet } from './store-core'

export const isUncloseablePane = (paneId: string): boolean =>
  Boolean(paneChrome(registry.getArea('panes').find(c => c.id === paneId)).uncloseable)

/** Hide-only chrome tabs (sessions / Bots): excluded from every close verb —
 *  Close-others / Close-all sweeping the sessions strip must not take standing
 *  chrome with it. They hide through `setStripTabHidden` instead. */
export const isHideOnlyPane = (paneId: string): boolean =>
  Boolean(paneChrome(registry.getArea('panes').find(c => c.id === paneId)).hideOnly)

/** A pane that belongs to a CHAT tab strip — the workspace or a session tile.
 *  Chat surfaces only: this gates where a session may DOCK (drops, ⌘T's "+"),
 *  not which zones the generic tab verbs serve — that's `isMainStripPane`. */
export const isSessionStripPane = (paneId: string): boolean =>
  paneId === 'workspace' || paneId.startsWith('session-tile:')

/** Any MAIN-placement tile's pane — a session, a page, a preview. The zones
 *  these stack into are real tab strips, so the generic tab verbs (⌘W, ⌃Tab)
 *  must serve them all; keying on the session prefix left ⌘W and ⌃Tab dead
 *  over a Browser/page zone while ⌘1…⌘9 worked. Standing side chrome (files /
 *  sessions / terminal) isn't 'main', so those zones still fall through. */
export const isMainStripPane = (paneId: string): boolean =>
  paneChrome(registry.getArea('panes').find(c => c.id === paneId)).placement === 'main'

/** Whether a zone may receive a SESSION drop — an existing session dragged
 *  from the sidebar, or a brand-new one dropped from a create-drag ("New
 *  session" row, project "+" buttons, "New project" +). Any zone hosting a
 *  chat strip or another main tile qualifies; standing side chrome never does.
 *  The resolvers (session-drag.ts / new-session-drag.ts) and the zone overlay
 *  (tree-group.tsx) share this one truth, so every painted zone can commit
 *  and every denied zone stays dark — the two cannot drift apart again. */
export const hostsSessionDropTarget = (paneIds: readonly string[]): boolean =>
  paneIds.some(isSessionStripPane) || paneIds.some(isMainStripPane)

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

/**
 * Panes hidden by app chrome toggles (titlebar sidebar / right-sidebar
 * buttons). The tree KEEPS the zone and its mounted content; a zone whose
 * every pane is hidden collapses to nothing until a toggle brings it back.
 * Not persisted here — each binding's store owns persistence.
 */
export const $hiddenTreePanes = atom<ReadonlySet<string>>(new Set())

export function setTreePaneHidden(paneId: string, hidden: boolean) {
  const next = toggledSet($hiddenTreePanes.get(), paneId, hidden)

  if (!next) {
    return
  }

  $hiddenTreePanes.set(next)

  // Reactive unhides (e.g. `bindPaneVisibility('files', $hasWorkspace)`) are
  // state-driven, not user intent — opening the side or fronting the tab in
  // response to an environmental flag change would clobber an explicit user
  // collapse (Cmd+J) and silently re-open the rail after every session create.
  // Callers that want user-intent semantics (open the side, front the tab)
  // must call `revealTreePane` explicitly. We still front the pane in its
  // group so it's visible the next time the column is shown.
  if (!hidden && !modeLayout.restoring) {
    frontPaneInGroup(paneId)
  }
}

/** Make `paneId` the active tab in its group without touching side collapse
 *  or zone-minimized state — the safe "make it visible next time the column
 *  is shown" primitive that reactive unhides need. */
function frontPaneInGroup(paneId: string) {
  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, paneId) : null

  if (!tree || !group || group.active === paneId) {
    return
  }

  // Don't steal the active tab from a pane the user is already viewing. In the
  // Focus layout `files` shares a group with `workspace`, so a reactive unhide
  // (cwd arrives on the first reply) would otherwise yank the active tab off
  // the new session onto files. Only take the active slot when the current
  // active pane isn't itself showable — then fronting picks a valid tab.
  if (group.active && !$hiddenTreePanes.get().has(group.active)) {
    return
  }

  const next = setActivePaneOp(tree, group.id, paneId)

  if (next !== tree) {
    commit(next)
  }
}

/**
 * CLOSE — the tab context menu's "Close". Two routes:
 *  - a registered closer (core panes whose visibility an app store owns:
 *    review/terminal/preview/sessions) closes through that store, so the
 *    titlebar/statusbar toggles stay truthful;
 *  - unbound core panes and panes from multi-pane plugins are DISMISSED:
 *    removed from the tree and remembered so adoption doesn't re-add them.
 *    Reveal intent (a preview target, ⌘G) or a layout reset un-dismisses;
 *  - closing the sole pane from a plugin disables that plugin, preserving the
 *    discoverable Capabilities → Plugins recovery path for single-pane plugins.
 */

export const $dismissedPanes = modeLayout.atom<ReadonlySet<string>>(
  LAYOUT_KEYS.dismissed,
  () => new Set(),
  paneSetCodec
)

export function setDismissed(paneId: string, dismissed: boolean) {
  const next = toggledSet($dismissedPanes.get(), paneId, dismissed)

  if (next) {
    $dismissedPanes.set(next)
  }
}

/**
 * Clear dismissal records for panes a NEW layout declares, without touching
 * the tree or anyone's active tab (`revealTreePane` fronts, which would bury
 * whatever the user is looking at).
 *
 * A dismissal outlives the layout that caused it. Switching to a layout that
 * wants a previously dismissed pane back would otherwise place it in the tree
 * and leave it invisible — the layout half-applies.
 */
export function undismissTreePanes(paneIds: Iterable<string>): void {
  const dismissed = $dismissedPanes.get()
  const next = new Set(dismissed)

  for (const paneId of paneIds) {
    next.delete(paneId)
  }

  if (next.size !== dismissed.size) {
    $dismissedPanes.set(next)
  }
}

// HIDE-ONLY STRIP TABS (`hideOnly` chrome: sessions / Bots) — standing chrome
// whose tab must never grow a ✕. Show/hide replaces Close for them: the zone
// menu's Show/Hide rows and the auto-registered ⌘K toggles both land here.
// Persisted separately from `$hiddenTreePanes` (whose persistence each side
// binding owns) so a hidden Bots tab stays hidden across launches even though
// dock enforcement re-adopts the pane into the sessions zone every boot.
export const $hiddenStripTabs = modeLayout.atom<ReadonlySet<string>>(
  LAYOUT_KEYS.hiddenTabs,
  () => new Set(),
  paneSetCodec
)

export function isStripTabHidden(paneId: string): boolean {
  return $hiddenStripTabs.get().has(paneId)
}

/** Would hiding `paneId` leave its zone with no visible tab? Hiding the last
 *  one strands an empty zone (or collapses the whole sidebar with no strip
 *  left to right-click), so the setter refuses and says why. */
function isLastShownInGroup(paneId: string): boolean {
  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, paneId) : null

  if (!group) {
    return false
  }

  const hidden = $hiddenTreePanes.get()

  return !group.panes.some(id => id !== paneId && !hidden.has(id))
}

/** Show/hide a hide-only chrome tab (the Close replacement for `hideOnly`
 *  panes). Returns false when the hide was refused — the zone must keep at
 *  least one visible tab, so the LAST shown tab can't be hidden. */
export function setStripTabHidden(paneId: string, hidden: boolean): boolean {
  if (hidden && isLastShownInGroup(paneId)) {
    notify({
      kind: 'info',
      title: translateNow('zones.lastTabKeptTitle'),
      message: translateNow('zones.lastTabKeptBody')
    })

    return false
  }

  const next = toggledSet($hiddenStripTabs.get(), paneId, hidden)

  if (next) {
    $hiddenStripTabs.set(next)
  }

  setTreePaneHidden(paneId, hidden)

  return true
}

// Boot hydration: re-apply persisted hides through the same chrome-hidden set
// the strips render from ($hiddenTreePanes starts empty every launch).
$hiddenStripTabs.subscribe((hidden, previous) => {
  for (const paneId of new Set([...hidden, ...(previous ?? [])])) {
    setTreePaneHidden(paneId, hidden.has(paneId))
  }
})

/** The main tab strip's "+": open a new session as its own tab (reusing an
 *  already-open unused tab when one exists, so repeated clicks don't pile up
 *  empty sessions). The app wiring registers the concrete action so this
 *  generic renderer stays session-agnostic; null until wired (the "+" hides).
 *  An atom so the strip re-renders when the action becomes available. */
export const $newSessionTabAction = atom<(() => void) | null>(null)

/** Who takes the active slot when `paneId` steps out of the front of a SHARED
 *  zone that also hosts the uncloseable (workspace) pane: the workspace —
 *  New Session semantics — never an arbitrary adjacent sibling.
 *  [workspace, files, review, terminal] with the terminal active must land on
 *  workspace, not on review via `panes[at - 1]`, which stranded the user on a
 *  tool pane. Null when the zone has no uncloseable pane (a pure tool
 *  zone keeps its own rule). Shared by collapse (toggle) and Close (tab ✕). */
export function chatZoneHandoff(group: { panes: string[] }, paneId: string): null | string {
  const anchor = group.panes.find(isUncloseablePane)

  if (!anchor) {
    return null
  }

  if (anchor !== paneId) {
    return anchor
  }

  // Defensive: the uncloseable pane itself (never bound to a tool toggle
  // store) — fall back to the sibling.
  const at = group.panes.indexOf(paneId)

  return group.panes[at - 1] ?? group.panes[at + 1] ?? null
}

/** Is a pane actually ON SCREEN? In the tree, not dismissed, not chrome
 *  hidden, its zone un-minimized, and holding its stack's active slot.
 *  True for every pane class — tool panels and hide-style panes alike. */
export function isPaneVisible(paneId: string): boolean {
  if ($dismissedPanes.get().has(paneId) || $hiddenTreePanes.get().has(paneId)) {
    return false
  }

  const group = paneGroup(paneId)

  return Boolean(group && !group.minimized && group.active === paneId)
}

const paneVisibleCache = new Map<string, ReadableAtom<boolean>>()

/** Reactive `isPaneVisible` for chrome that renders an on/off affordance
 *  (the statusbar's terminal button). Memoized per pane id so `useStore`
 *  subscriptions stay referentially stable across renders. */
export function $paneVisible(paneId: string): ReadableAtom<boolean> {
  let cached = paneVisibleCache.get(paneId)

  if (!cached) {
    cached = computed([$layoutTree, $dismissedPanes, $hiddenTreePanes], () => isPaneVisible(paneId))
    paneVisibleCache.set(paneId, cached)
  }

  return cached
}
