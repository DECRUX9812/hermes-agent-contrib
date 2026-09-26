// CLOSE VERBS + VISIBILITY BINDINGS
// Every way a pane goes away — tab clicks, keyboard, chrome toggles — plus
// the per-pane bind*() wiring chrome hands to the titlebar.

import { atom } from 'nanostores'

import { setPluginEnabled } from '@/contrib/plugins-store'
import { registry } from '@/contrib/registry'
import { translateNow } from '@/i18n'
import { modeLayout } from '@/store/interface-mode'
import { notify } from '@/store/notifications'

import {
  allPaneIds,
  findGroup,
  findGroupOfPane,
  removePane
} from './model'
import { paneChrome } from './renderer/track-model'
import { $layoutTree, commit, paneGroup } from './store-core'
import { tabTargetGroup } from './store-focus'
import { restoreTreePane, revealTreePane, setPaneCollapsed } from './store-lifecycle'
import { activateTreePane, setTreeGroupMinimized } from './store-moves'
import { rememberPaneShare } from './store-shares'
import { $hiddenTreePanes, chatZoneHandoff, isCollapsePane, isHideOnlyPane, isMainStripPane, isPaneVisible, isUncloseablePane, markCollapsePane, paneClosers, registerPaneCloser, registerPaneOpener, setDismissed, setTreePaneHidden } from './store-visibility'

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

/** ⌘W / zone-menu Close over a TOOL PANEL (terminal / logs): take the tab OUT
 *  of the strip like any other tab, and sync the owning store so its toggle
 *  (⌃` / the ⌘K row) stays truthful and can bring the pane back.
 *
 *  A tool panel's closer is its visibility STORE, so routing Close through
 *  `closeTreePane` only collapsed the zone to a rail — the tab stayed put and
 *  Close read as a no-op. Dismiss first so the store listener's collapse lands
 *  on an absent pane instead of minimizing a shared zone's surviving sibling.
 *  That listener is then a no-op, so an ACTIVE tab sharing the chat's zone
 *  hands its slot over here, by the same rule the toggle uses — otherwise
 *  removePane fronts whichever neighbour filled the gap (#79002). */
export function closeToolPane(paneId: string) {
  const group = paneGroup(paneId)
  const handoff = group?.active === paneId ? chatZoneHandoff(group, paneId) : null

  if (group && handoff) {
    activateTreePane(group.id, handoff)
  }

  dismissTreePane(paneId)
  paneClosers[paneId]?.()
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

/** Pane ids in the tree under a `${prefix}:` namespace — lets a mirror prune
 *  panes the SHARED (cross-profile) tree persisted for tiles that no longer
 *  back the current profile (a profile switch reloads with the other profile's
 *  tile panes still stacked in). */
export function treePanesWithPrefix(prefix: string): string[] {
  const tree = $layoutTree.get()

  return tree ? allPaneIds(tree).filter(id => id.startsWith(prefix)) : []
}

/** Remove a pane from the tree WITHOUT a dismissal record — for surfaces
 *  whose lifecycle an owner store drives (session tiles): the owner removes
 *  the contribution too, and a later re-open must re-adopt cleanly. */
export function removeTreePane(paneId: string) {
  const tree = $layoutTree.get()

  if (tree) {
    rememberPaneShare(tree, paneId)
    commit(removePane(tree, paneId))
  }
}

/** The closer-less Close: dismiss the pane (removed + remembered; reveal
 *  intent or a layout reset un-dismisses). */
export function dismissTreePane(paneId: string) {
  const tree = $layoutTree.get()

  if (tree) {
    setDismissed(paneId, true)
    rememberPaneShare(tree, paneId)
    commit(removePane(tree, paneId))
  }
}

export function closeTreePane(paneId: string) {
  const closer = paneClosers[paneId]

  if (closer) {
    closer()

    return
  }

  const panes = registry.getArea('panes')
  const source = panes.find(c => c.id === paneId)?.source

  if (source?.startsWith('plugin:')) {
    // A plugin may own several independent panes. Closing one of them must not
    // unload every contribution from that plugin (for example, closing Bot
    // Mode's Cronjobs pane must leave its Bots roster and composer middleware
    // alive). Dismiss just that pane; Layout reset remains the explicit way to
    // restore dismissed contributed panes.
    if (panes.filter(c => c.source === source).length > 1) {
      dismissTreePane(paneId)

      return
    }

    // A single-pane plugin keeps the existing symmetric behavior: Close uses
    // the same switch as Capabilities → Plugins. Its contribution unregisters but
    // the pane id stays in the tree, so re-enabling restores its exact place.
    const pluginId = source.slice('plugin:'.length)
    void setPluginEnabled(pluginId, false)
    notify({
      kind: 'info',
      title: translateNow('zones.pluginDisabled', pluginId),
      message: translateNow('zones.pluginDisabledBody')
    })

    return
  }

  dismissTreePane(paneId)
}

/**
 * HIDE-STYLE PANES (files, review, preview): bind a pane's visibility STORE to
 * the tree so its toggle HIDES the pane — its zone collapses while the content
 * stays mounted — as opposed to the tool panels, which collapse to a rail and
 * keep their tab.
 *
 * `close` and `open` are a PAIR, and passing only one is the bug this exists to
 * prevent. The closer keeps the toggle truthful when the pane is closed from
 * the tab menu; the opener is its mirror, so anything that shows the pane
 * through the tree — a reveal, a preset, the toggle's own un-hide path — writes
 * the store too. With a closer and no opener the boolean goes stale the moment
 * something other than the toggle reveals the pane, and the next press spends
 * itself re-asserting a value it already held.
 */
export function bindPaneVisibility(
  paneId: string,
  $open: { get(): boolean; listen(fn: (open: boolean) => void): void },
  close?: () => void,
  open?: () => void
) {
  setTreePaneHidden(paneId, !$open.get())
  $open.listen(isOpen => setTreePaneHidden(paneId, !isOpen))

  if (close) {
    registerPaneCloser(paneId, close)
  }

  if (open) {
    registerPaneOpener(paneId, open)
  }
}

/**
 * TOOL PANELS (terminal, logs): bind a pane's visibility STORE to the tree so
 * its toggle COLLAPSES the zone to a persistent rail (the tab stays) instead of
 * hiding it — the IntelliJ/VS-Code tool-window model. Restore routes back
 * through `open` (rail click / chevron) so ⌃` and the statusbar button stay
 * truthful; Close removes the tab.
 *
 * OPEN goes through `revealTreePane`, not `setPaneCollapsed`: Close DISMISSES
 * the pane, and `setPaneCollapsed` is a no-op on a pane that has left the tree,
 * so the toggle would flip its store with nothing coming back. `revealTreePane`
 * un-dismisses and re-adopts.
 *
 * BOOT ONLY COLLAPSES — it must never reveal. `setPaneCollapsed(id, false)`
 * fronts the pane in its stack, so binding two tool panels that are both "open"
 * let the second one steal the active tab from the persisted tree. With
 * terminal+logs stacked (what you get by dragging the terminal to the bottom),
 * logs bound last and won the slot; ⌃` then asked to collapse a terminal that
 * wasn't the active tab, the shared-zone branch declined, and the key read as
 * dead until the stack was broken up. The persisted tree already records which
 * tab was active — leave it alone.
 *
 * `$rail` says whether a CLOSED pane keeps its rail on screen. Off, the pane
 * hides instead (Simple has no terminal) — same store, same toggle, only the
 * resting shape differs. Omitted means always.
 */
export function bindToolPaneCollapse(
  paneId: string,
  $open: { get(): boolean; listen(fn: (open: boolean) => void): void },
  close: () => void,
  open: () => void,
  $rail?: { get(): boolean; listen(fn: (rail: boolean) => void): void }
) {
  markCollapsePane(paneId)

  if (!$open.get()) {
    setPaneCollapsed(paneId, true)
  }

  $open.listen(isOpen => {
    if (!modeLayout.restoring) {
      isOpen ? revealTreePane(paneId) : setPaneCollapsed(paneId, true)
    }
  })
  registerPaneCloser(paneId, close)
  registerPaneOpener(paneId, open)

  if ($rail) {
    const sync = () => setTreePaneHidden(paneId, !$open.get() && !$rail.get())

    sync()
    $open.listen(sync)
    $rail.listen(sync)
  }
}

/**
 * EVERY pane toggle: ⌃`, ⌘G, the statusbar button, the ⌘K rows. ONE resolver
 * for "flip this pane", derived from what is on screen rather than from the
 * toggle's own boolean.
 *
 * A free-floating `!$open.get()` diverges from the tree the moment anything
 * else moves the pane — stacked behind a sibling tab, minimized from the zone
 * menu, closed with ⌘W — and then the toggle spends its press re-asserting a
 * value the store already held, which reads as a dead key. Asking the tree
 * instead means the first press always does the visible thing.
 *
 * This is not a tool-panel quirk. The hide-style panes (files, review) had it
 * too: `setTreePaneHidden(id, false)` deliberately does NOT front or
 * un-minimize, because reactive unhides (a cwd arriving) must not clobber what
 * the user is looking at. Correct for a reactive change, useless for a
 * keypress — so user intent routes here and reactive bindings keep the quiet
 * path.
 *
 * Close goes through `closeTreePane` so each pane keeps its own semantics: a
 * tool panel collapses to its rail, files/review close through their store,
 * anything else is dismissed.
 */
export function togglePaneVisible(paneId: string) {
  if (isPaneVisible(paneId)) {
    closeTreePane(paneId)
  } else {
    restoreTreePane(paneId)
  }
}

/** Collapse a tool pane through its store closer (truthful), else minimize the
 *  zone directly. Gated on isCollapsePane so a non-tool pane's closer (a tile's
 *  REMOVES it) is never mistaken for a collapse. */
export function collapseTreePane(paneId: string) {
  const close = paneClosers[paneId]

  if (isCollapsePane(paneId) && close) {
    close()

    return
  }

  const group = paneGroup(paneId)

  if (group) {
    setTreeGroupMinimized(group.id, true)
  }
}
