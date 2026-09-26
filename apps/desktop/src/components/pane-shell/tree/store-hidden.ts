import { atom } from 'nanostores'

import { translateNow } from '@/i18n'
import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { modeLayout } from '@/store/interface-mode'
import { notify } from '@/store/notifications'

import { findGroupOfPane, setActivePane as setActivePaneOp } from './model'
import { $layoutTree, commit, paneSetCodec, toggledSet } from './store-core'

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
