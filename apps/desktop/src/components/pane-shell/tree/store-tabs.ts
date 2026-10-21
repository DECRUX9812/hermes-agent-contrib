import { atom } from 'nanostores'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { registry } from '@/contrib/registry'

import { findGroup, findGroupOfPane, type GroupNode, type TabStripMode } from './model'
import { tabStripVisibleForZone } from './renderer/strip-visibility'
import { paneChrome } from './renderer/track-model'
import { $layoutTree, setTreeGroupTabStrip } from './store-core'
import { tabTargetGroup } from './store-groups'
import { $hiddenTreePanes } from './store-hidden'
import { isCollapsePane } from './store-lifecycle'
import { activateTreePane, closeToolPane, closeTreePane } from './store-panes'
import { isHideOnlyPane, isMainStripPane, isSessionStripPane, isUncloseablePane } from './store-predicates'

/** The zone the session-tab verbs (⌘T / ⌘⇧T / the strip's "+") act on: the
 *  first of hovered / focused / workspace that hosts a chat strip. Same ladder
 *  ⌘1…⌘9 indexes, so the number keys and the tab verbs can't disagree about
 *  which strip is "the" strip. A target parked in the sidebar / terminal /
 *  files must NOT retarget them — those zones fall through to main rather
 *  than letting ⌘T dock a session into the file tree. */
function focusedSessionGroup(): GroupNode | null {
  return tabTargetGroup(group => group.panes.some(isSessionStripPane))
}

/** The pane a NEW session tab should dock beside (⌘T): the focused chat zone's
 *  active session pane, else its first. Null when no zone hosts a chat strip —
 *  the caller falls back to the workspace. */
export function focusedSessionTabAnchor(): null | string {
  const group = focusedSessionGroup()

  if (!group) {
    return null
  }

  const active = group.active

  return active && isSessionStripPane(active) ? active : (group.panes.find(isSessionStripPane) ?? null)
}

/** ⌘W: close the FOCUSED tile zone's active tab, unless it's the uncloseable
 *  workspace itself. Any main-strip zone qualifies — a session stack, a lone
 *  Browser/page tile — while side chrome (files / terminal) in a zone of its
 *  own falls through to its own rung. Keying eligibility on the chat strip
 *  made ⌘W over a lone preview zone fall all the way through and empty the
 *  MAIN chat instead. Returns false when there's nothing to close, so ⌘W
 *  stays a no-op — it never closes the window. */
export function closeFocusedSessionTab(): boolean {
  const active = tabTargetGroup(group => group.panes.some(isMainStripPane))?.active

  if (!active || isUncloseablePane(active)) {
    return false
  }

  closeTreePane(active)

  return true
}

/** ⌘W over a TOOL PANEL zone (terminal / logs): close its active tab, the same
 *  as any other tab. These zones host no chat strip, so `focusedSessionGroup`
 *  skips them — without this rung ⌘W was a dead key over the terminal and the
 *  logs pane, the only tabs in the app you couldn't close from the keyboard. */
export function closeFocusedToolTab(): boolean {
  const group = tabTargetGroup(g => g.panes.some(isCollapsePane))
  const active = group?.active

  if (!active || !isCollapsePane(active)) {
    return false
  }

  closeToolPane(active)

  return true
}

/** Closeable siblings of `paneId` within its group, split by position — powers
 *  the tab menu's Close-others / Close-to-the-right verbs (and their enablement). */
function closeableTreeSiblings(paneId: string): { others: string[]; right: string[] } {
  const tree = $layoutTree.get()
  const panes = (tree ? findGroupOfPane(tree, paneId) : null)?.panes ?? []
  const idx = panes.indexOf(paneId)

  return {
    others: panes.filter(id => id !== paneId && !isUncloseablePane(id) && !isHideOnlyPane(id)),
    right: panes.filter((id, i) => i > idx && !isUncloseablePane(id) && !isHideOnlyPane(id))
  }
}

/** Closeable-tab counts for a tab's menu enablement (`all` includes self). */
export function treeTabCloseTargets(paneId: string): { all: number; others: number; right: number } {
  const { others, right } = closeableTreeSiblings(paneId)

  return {
    all: others.length + (isUncloseablePane(paneId) || isHideOnlyPane(paneId) ? 0 : 1),
    others: others.length,
    right: right.length
  }
}

/**
 * RELOAD — a pane's remount counter, the tab menu's Reload (browser parity:
 * right-click a tab, reload what's in it). The zone renderer keys a pane's
 * body layer on its epoch, so bumping it unmounts the contribution and mounts
 * it fresh — data effects re-run, measurements are retaken — while the layout
 * tree, the tab's position, and every other tab stay exactly as they were.
 * Absent until a pane is first reloaded (no key churn on a normal boot).
 */
export const $treePaneEpochs = atom<Readonly<Record<string, number>>>({})

export function reloadTreePane(paneId: string): void {
  const epochs = $treePaneEpochs.get()

  $treePaneEpochs.set({ ...epochs, [paneId]: (epochs[paneId] ?? 0) + 1 })
}

/** Close a tab the way its kind expects: a tool panel leaves the strip (and
 *  syncs its toggle), everything else routes through its owning Close. */
export function closeTabPane(paneId: string) {
  if (isCollapsePane(paneId)) {
    closeToolPane(paneId)
  } else {
    closeTreePane(paneId)
  }
}

export function closeOtherTreeTabs(paneId: string): void {
  closeableTreeSiblings(paneId).others.forEach(closeTabPane)
}

export function closeTreeTabsToRight(paneId: string): void {
  closeableTreeSiblings(paneId).right.forEach(closeTabPane)
}

/** Close every closeable tab in `paneId`'s group (the uncloseable workspace stays). */
export function closeAllTreeTabs(paneId: string): void {
  const tree = $layoutTree.get()
  const panes = (tree ? findGroupOfPane(tree, paneId) : null)?.panes ?? []

  panes.filter(id => !isUncloseablePane(id) && !isHideOnlyPane(id)).forEach(closeTabPane)
}

/** Hide-only chrome tabs in `groupId` (sessions / Bots), with live hidden
 *  state — the zone menu's Show/Hide rows. Resolved when the menu OPENS (same
 *  contract as the close-verb counts), never subscribed from a zone render. */
export function hideOnlyZoneTabs(groupId: string): { hidden: boolean; id: string; title: string }[] {
  const tree = $layoutTree.get()
  const group = tree ? findGroup(tree, groupId) : null

  if (!group) {
    return []
  }

  const panes = registry.getArea('panes')
  const hidden = $hiddenTreePanes.get()

  return group.panes.flatMap(id => {
    const pane = panes.find(p => p.id === id)
    const chrome = paneChrome(pane)

    if (!chrome.hideOnly) {
      return []
    }

    // Menu-open time, so a locale-following label (`tabTitleText`) resolves
    // against the LOADED locale rather than the register-time `title`.
    return [{ hidden: hidden.has(id), id, title: chrome.tabTitleText?.() ?? String(pane?.title ?? id) }]
  })
}

/** The main tab strip's "+": open a new session as its own tab (reusing an
 *  already-open unused tab when one exists, so repeated clicks don't pile up
 *  empty sessions). The app wiring registers the concrete action so this
 *  generic renderer stays session-agnostic; null until wired (the "+" hides).
 *  An atom so the strip re-renders when the action becomes available. */
export const $newSessionTabAction = atom<((options?: NewSessionTabOptions) => void) | null>(null)

/** A new tab's folder: `cwd` pins the session there (a bot topic started in a
 *  project); absent, the project scope / configured default decides. */
export interface NewSessionTabOptions {
  cwd?: string
}

/**
 * Keyboard slots (⌘1…⌘9, ⌃Tab) must index the SAME tabs the strip paints —
 * chrome-hidden panes (files in Focus layout), unregistered ones, and
 * narrow-collapsed collapsibles stay in `group.panes` but aren't chips. Walking
 * the raw array made ⌘2 land on what the strip called tab 1 after a hidden
 * pane sat earlier in the list (classic after-⌘W-shift offset).
 */
export function shownPanesInGroup(group: { panes: readonly string[] }): string[] {
  const hidden = $hiddenTreePanes.get()
  const registered = registry.getArea('panes')
  const paneFor = (id: string) => registered.find(c => c.id === id)

  return group.panes.filter(id => {
    const pane = paneFor(id)

    if (!pane) {
      return false
    }

    if (hidden.has(id)) {
      return false
    }

    // Match TreeGroup's paneShown for the narrow breakpoint — collapsible
    // panes drop out of the strip when the viewport collapses them.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.(SIDEBAR_COLLAPSE_MEDIA_QUERY).matches &&
      Boolean(paneChrome(pane).collapsible)
    ) {
      return false
    }

    return true
  })
}

/** Is this zone showing a tab strip right now? The store's adapter over the
 *  shared resolver — TreeGroup answers the same question from its own render
 *  inputs, so the toggle command and the strip on screen cannot disagree about
 *  which way "toggle" points. */
export function tabStripVisibleForGroup(group: GroupNode): boolean {
  const registered = registry.getArea('panes')
  const shown = shownPanesInGroup(group)

  return tabStripVisibleForZone({
    active: group.active,
    isCollapsePane,
    mode: group.tabStrip,
    paneFor: (id: string) => registered.find(c => c.id === id),
    shown
  })
}

/** Shared target for tab-number hints and shortcut dispatch. */
export function treeTabSlotTarget(): GroupNode | null {
  return tabTargetGroup(candidate => shownPanesInGroup(candidate).length >= 2)
}

/** ⌘1…⌘9: activate the Nth *visible* tab of the target zone — the first of
 *  hovered / focused / workspace that is a real tab strip (≥2 shown panes).
 *  Pointing at the sidebar (or nothing) therefore still switches main's tabs
 *  instead of dead-ending. Returns the activated pane id — the caller needs to
 *  know when the slot landed on the workspace tab (a full page covering it
 *  must also route back to the chat) — or null so it falls back to its
 *  default (profile switch) when no zone qualifies. */
export function activateTreeTabSlot(slot: number): null | string {
  const group = treeTabSlotTarget()
  const panes = group ? shownPanesInGroup(group) : []

  if (!group || slot < 1 || slot > panes.length) {
    return null
  }

  activateTreePane(group.id, panes[slot - 1])

  return panes[slot - 1]
}

/** ⌃Tab / ⌃⇧Tab: cycle the target zone's *visible* tabs (wrapping) — the first
 *  of hovered / focused / workspace that is a tile strip with ≥2 shown tabs
 *  (any main-placement tenant: sessions, pages, previews). Returns the
 *  activated pane id (see `activateTreeTabSlot` — landing on the workspace
 *  under a full page must route back to the chat), or null so the caller
 *  falls back to the recent-session switcher when no zone qualifies. */
export function cycleTreeTabInFocusedZone(direction: 1 | -1): null | string {
  const group = tabTargetGroup(candidate => {
    const shown = shownPanesInGroup(candidate)

    return shown.length >= 2 && shown.some(isMainStripPane)
  })

  if (!group) {
    return null
  }

  const panes = shownPanesInGroup(group)

  // Active may itself be hidden (Files collapsed mid-cycle) — treat it as
  // missing so the step starts from a real chip rather than landing on a ghost.
  const current = Math.max(0, panes.indexOf(group.active ?? ''))
  const idx = panes.includes(group.active ?? '') ? current : 0
  const nextId = panes[(idx + direction + panes.length) % panes.length]
  activateTreePane(group.id, nextId)

  // No strip repair here: cycling needs two shown tabs, which is exactly when
  // auto shows a strip anyway. The old force-show existed because a stray
  // double-tap could leave a multi-tab zone headerless; that gesture is gone,
  // and a zone the user deliberately set to `never` must not be argued with by
  // a keystroke that was only asked to change tabs.
  return nextId
}

/**
 * The zone `view.toggleTabStrip` and its ⌘K row act on: the first of hovered /
 * focused / workspace that renders panes at all. Deliberately the widest
 * eligibility of any tab verb — the whole point of the command is to reach a
 * zone showing no chrome, so it must not require the chrome it restores.
 */
const tabStripTargetGroup = () => tabTargetGroup(candidate => shownPanesInGroup(candidate).length > 0)

/** Is the toggle's target zone currently showing a strip? Null when no zone
 *  qualifies — the ⌘K row reads this to describe what pressing it will do. */
export function targetZoneTabStripVisible(): boolean | null {
  const group = tabStripTargetGroup()

  return group ? tabStripVisibleForGroup(group) : null
}

/** Flip the target zone's strip. Returns the mode written, or null when there
 *  was no zone to act on. */
export function toggleTargetZoneTabStrip(): TabStripMode | null {
  const group = tabStripTargetGroup()

  if (!group) {
    return null
  }

  // Toggle against what is ON SCREEN, not against the stored mode: a zone on
  // auto has no stored mode, and "toggle" means "do the other thing to what I
  // am looking at". Both outcomes are explicit, so the zone leaves auto either
  // way rather than drifting with its tab count afterwards.
  const next: TabStripMode = tabStripVisibleForGroup(group) ? 'never' : 'always'
  setTreeGroupTabStrip(group.id, next)

  return next
}
