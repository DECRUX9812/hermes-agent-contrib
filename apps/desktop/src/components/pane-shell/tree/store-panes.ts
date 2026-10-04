import { computed, type ReadableAtom } from 'nanostores'

import { setPluginEnabled } from '@/contrib/plugins-store'
import { registry } from '@/contrib/registry'
import { translateNow } from '@/i18n'
import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { writeKey } from '@/lib/storage'
import { modeLayout } from '@/store/interface-mode'
import { notify } from '@/store/notifications'
import { clearAllPaneSizeOverrides } from '@/store/panes'

import {
  allPaneIds,
  type DropPosition,
  findGroup,
  findGroupOfPane,
  groupLeafIds,
  insertAtGroup,
  type LayoutNode,
  movePane as movePaneOp,
  removePane,
  setActivePane as setActivePaneOp,
  setGroupMinimized,
  type SplitNode
} from './model'
import { isTreePaneParked } from './parked-panes'
import { FLOATING_PLACEMENT } from './renderer/floating-rect'
import { paneChrome, type PaneContribution } from './renderer/track-model'
import {
  $layoutTree,
  $userPlacedPanes,
  adoptMissingPanes,
  commit,
  defaultTrees,
  markActivePreset,
  moveTreePane,
  persist,
  setTreeGroupMinimized,
  toggledSet
} from './store-core'
import {
  $dismissedPanes,
  $hiddenStripTabs,
  $hiddenTreePanes,
  setDismissed,
  setStripTabHidden,
  setTreePaneHidden
} from './store-hidden'
import {
  isCollapsePane,
  markCollapsePane,
  paneClosers,
  paneOpeners,
  registerPaneCloser,
  registerPaneOpener,
  resetHandlers
} from './store-lifecycle'
import { isUncloseablePane } from './store-predicates'
import { beginLayoutHydration, endLayoutHydration, recalledEdgeWeights, rememberPaneShare } from './store-shares'

// The retired one-time dock-heal ledger (`heal: '<token>'` hints). Its guards
// (token burned even when the heal was skipped; $userPlacedPanes exempt) left
// exactly the users who had fought the old stacked layout stuck with it —
// enforced docks (`enforce: true`) replaced it. Drop the stale key.
writeKey('hermes.desktop.paneDockHeals.v1', null)

// Panes already enforced THIS boot: the invariant re-asserts at boot, not
// against a live user — a mid-session drag out of the anchor strip sticks
// until the next launch, so there is never a tug-of-war.
const enforcedDocksThisBoot = new Set<string>()

/**
 * Reopen the enforcement window. The ledger protects a user's mid-session
 * drags, but a wholesale tree replacement has no drags left to protect — and
 * a pass that ran against a DIFFERENT tree burned the entry for nothing. That
 * is how the guided onboarding shipped Bots as a tab over the chat: the boot
 * pass fired while the solo tree had no sessions column to anchor to, so the
 * assembled layout's pass was skipped as already-done.
 *
 * Only call this when replacing the tree wholesale.
 */
export function resetEnforcedDocks(): void {
  enforcedDocksThisBoot.clear()
}

/**
 * A `panes` contribution whose dock hint carries `enforce: true` is re-homed
 * onto the hint's anchor at every boot's first adoption pass when it isn't
 * already docked there. Unlike the retired one-time heal, nothing
 * exempts the pane — not a burned token, not $userPlacedPanes — because the
 * hint is the owner's standing invariant about where the pane lives
 * (Bot Mode's Bots pane IS the SESSIONS | BOTS tab strip), not a one-shot
 * migration. Center hints consolidate panes into their anchor's tab strip;
 * edge hints restore the declared split beside their anchor.
 *
 * Silent like adoption — the anchor zone keeps its active tab. The center
 * insert pins the zone's header shown, which is the point: the strip is how
 * the user finds the tab.
 */
function enforceDockedPanes(tree: LayoutNode, dataOf: (paneId: string) => PaneContribution | undefined): LayoutNode {
  let next = tree

  for (const pane of registry.getArea('panes')) {
    const dock = dataOf(pane.id)?.dock

    if (!dock?.enforce || !allPaneIds(next).includes(pane.id)) {
      continue
    }

    if (enforcedDocksThisBoot.has(pane.id)) {
      continue
    }

    enforcedDocksThisBoot.add(pane.id)

    const from = findGroupOfPane(next, pane.id)
    const anchor = findGroupOfPane(next, dock.pane)

    if (!from || !anchor) {
      continue
    }

    if (dock.pos === 'center' && from.id === anchor.id) {
      // Already stacked with its anchor, and nothing to repair: the trees that
      // produced the "my ui only shows bots now... cant find the sessions"
      // regression carried an accidental `headerHidden: true`, which the load
      // migration now drops outright. A surviving `never` here is deliberate
      // and recoverable from the toggle command, so boot does not overrule it.
      continue
    }

    if (dock.pos !== 'center') {
      const moved = movePaneOp(next, pane.id, {
        groupId: anchor.id,
        pos: dock.pos,
        before: dock.before
      })

      if (moved !== next) {
        next = moved
      }

      continue
    }

    const without = removePane(next, pane.id)
    const target = without ? findGroupOfPane(without, dock.pane)?.id : undefined

    if (!without || !target) {
      continue
    }

    next = insertAtGroup(without, target, pane.id, 'center', dock.before, false) ?? next
  }

  return next
}

/**
 * LIVE pane adoption — a `panes` contribution that isn't in the tree yet
 * (a plugin registered after boot, incl. runtime-loaded ones) joins the
 * tree via the SAME primitive a human drag/drop commits with
 * (`insertAtGroup`: anchor group + side). The pane's data supplies the
 * gesture:
 *
 *  - `dock: { pane, pos }` — "drop me on that edge of that pane". Any pane,
 *    any side, exactly what the drop chips do.
 *  - otherwise the semantic `placement` role infers the anchor: stack with
 *    a settled pane of the same placement, main zone as last resort.
 *
 * Happens once per pane lifetime (the committed tree remembers it across
 * boots), so user rearrangement wins from then on and plugin reloads keep
 * the pane where the user left it.
 */
export function adoptContributedPanes(): void {
  const tree = $layoutTree.get()

  if (!tree) {
    return
  }

  const panes = registry.getArea('panes')

  const dataOf = (paneId: string): PaneContribution | undefined => {
    const contribution = panes.find(c => c.id === paneId)

    return contribution ? paneChrome(contribution) : undefined
  }

  const placementOf = (paneId: string) => dataOf(paneId)?.placement
  const mainId = panes.find(c => placementOf(c.id) === 'main')?.id
  const inTree = new Set(allPaneIds(tree))

  const dismissed = $dismissedPanes.get()

  // Enforced dock invariants run FIRST: they re-home panes that are ALREADY
  // in the tree, so the missing-pane adoption below never sees them.
  const healed = enforceDockedPanes(tree, dataOf)

  // `placement: 'floating'` opts OUT of the tree entirely — those panes render
  // as fixed cards above it (renderer/floating-panes.tsx). Adopting one would
  // turn it into a track that steals width from a zone, which is the whole
  // thing floating exists to avoid.
  const missing = panes.filter(
    c =>
      !inTree.has(c.id) && !dismissed.has(c.id) && !isTreePaneParked(c.id) && placementOf(c.id) !== FLOATING_PLACEMENT
  )

  if (missing.length === 0) {
    if (healed !== tree) {
      commit(healed)
    }

    return
  }

  let next = healed

  for (const pane of missing) {
    const dock = dataOf(pane.id)?.dock
    const placement = placementOf(pane.id) ?? 'right'

    const anchor =
      (dock && allPaneIds(next).includes(dock.pane) ? dock.pane : undefined) ??
      allPaneIds(next).find(id => id !== pane.id && placementOf(id) === placement) ??
      mainId

    const target = findGroupOfPane(next, anchor ?? '')?.id

    if (target) {
      // Silent adoption: don't front over the zone's active tab — a reveal
      // does. An edge dock re-takes the share the pane held when it closed —
      // but only against the seam partner it was recorded with (#108679).
      //
      // Nothing writes the strip choice afterwards. This used to read the
      // host's hidden flag before the insert and stamp it back on after, purely
      // to undo the pin `insertAtGroup` applied; with the pin gone the zone's
      // own preference simply survives, and the adopted pane arrives with a
      // chip whenever auto says the zone has more than one.
      next =
        insertAtGroup(
          next,
          target,
          pane.id,
          dock?.pos ?? 'center',
          dock?.before,
          false,
          recalledEdgeWeights(pane.id, anchor)
        ) ?? next
    }
  }

  if (next !== tree) {
    commit(next)
  }

  // After the commit, so the zone exists to minimize. `defaultCollapsed` is the
  // pane's arrival state, not a standing invariant: it runs on the adoption
  // that put the pane in the tree, and a pane already in the tree is never
  // re-adopted — so a user's expand persists with the layout and is never
  // overruled on a later boot.
  for (const pane of missing) {
    if (dataOf(pane.id)?.defaultCollapsed) {
      setPaneCollapsed(pane.id, true)
    }
  }
}

/** Adopt now + on every registry change (call once from the app root). */
export function watchContributedPanes(): void {
  adoptContributedPanes()
  modeLayout.onRestore(adoptContributedPanes)
  registry.subscribe(adoptContributedPanes)
}

/** Reconcile the persisted tree with the registry as part of BOOT hydration:
 *  the reload prune→re-register cycle runs with share recording suspended
 *  (#108679 — a hydration prune is not a user resize, and its recorded
 *  shares were what re-docked tiles replayed at half width). Call once from
 *  the app root, after declareDefaultTree, in place of a bare
 *  watchContributedPanes() when the surface persists tiles. */
export function hydrateContributedPanes(): void {
  beginLayoutHydration()

  try {
    adoptContributedPanes()
  } finally {
    endLayoutHydration()
  }

  watchContributedPanes()
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

/** The layout's root ROW — the split that contains main + the side columns.
 *  Usually the root itself (Default, Focus); in a column-root layout (Terminal
 *  deck, Quad) it's the row child that holds sessions/workspace/files. Returns
 *  null when the tree has no row split with side-eligible panes. */
export function rootRow(): SplitNode | null {
  const tree = $layoutTree.get()

  if (!tree || tree.type !== 'split') {
    return null
  }

  if (tree.orientation === 'row') {
    return tree
  }

  // Column root: find the row child that contains the main pane — that's the
  // row the side-collapse system operates on (sessions left, files right).
  const panes = registry.getArea('panes')

  const hasMain = (node: LayoutNode): boolean => {
    if (node.type === 'group') {
      return node.panes.some(id => paneChrome(panes.find(p => p.id === id)).placement === 'main')
    }

    return node.children.some(hasMain)
  }

  return (
    (tree.children.find(child => child.type === 'split' && child.orientation === 'row' && hasMain(child)) as
      SplitNode | undefined) ?? null
  )
}

/** Which root-row side a pane currently lives in, or null when it's nested
 *  with main (dragged into the middle) — where a side collapse can't hide it.
 *  Lets side-bound closers (files/sessions) fall back to dismissal. */
export function paneRootSide(paneId: string): null | TreeSide {
  const row = rootRow()

  if (!row) {
    return null
  }

  const panes = registry.getArea('panes')
  const index = row.children.findIndex(c => allPaneIds(c).includes(paneId))

  const mainIndices = row.children.flatMap((child, i) =>
    allPaneIds(child).some(id => id === 'workspace' || paneChrome(panes.find(p => p.id === id)).placement === 'main')
      ? [i]
      : []
  )

  if (index < 0 || mainIndices.length === 0) {
    return null
  }

  return index < mainIndices[0] ? 'left' : index > mainIndices[mainIndices.length - 1] ? 'right' : null
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

/**
 * POSITIONAL side collapse — the titlebar's left/right sidebar toggles (and
 * ⌘B / ⌘J). Everything on that side of the MAIN zone in the root row hides
 * together, whatever panes live there (this is what makes the buttons agree
 * with a rearranged layout; the flip derivation works the same way). An AND
 * on top of per-pane visibility: zone shown ⇔ side open ∧ some pane shown.
 */
export type TreeSide = 'left' | 'right'

export const $collapsedTreeSides = modeLayout.atom<ReadonlySet<TreeSide>>(LAYOUT_KEYS.collapsed, () => new Set(), {
  decode: raw => {
    const sides: unknown = JSON.parse(raw)

    if (!Array.isArray(sides) || !sides.every(side => side === 'left' || side === 'right')) {
      throw new Error('Invalid collapsed sides')
    }

    return new Set<TreeSide>(sides)
  },
  encode: value => JSON.stringify([...value])
})
const hasPersistedSides = modeLayout.has(LAYOUT_KEYS.collapsed)

// Side visibility is DERIVED from an app store (the binding owns persistence
// + button state). Reveals un-collapse the column directly instead of writing
// back through the setter — the right side's store IS the file tree's toggle,
// so a neighbour's reveal must not press it. Layout reset still reopens every
// side through its setter, because there the toggles SHOULD move.
const sideOpeners: Partial<Record<TreeSide, (open: boolean) => void>> = {}
const sideVisibility: Partial<Record<TreeSide, () => boolean>> = {}

modeLayout.onRestore(() => {
  if (!modeLayout.has(LAYOUT_KEYS.collapsed)) {
    $collapsedTreeSides.set(
      new Set((Object.keys(sideVisibility) as TreeSide[]).filter(side => !sideVisibility[side]?.()))
    )
  }
})

export function setTreeSideCollapsed(side: TreeSide, collapsed: boolean) {
  const next = toggledSet($collapsedTreeSides.get(), side, collapsed)

  if (next) {
    $collapsedTreeSides.set(next)
  }

  // Opening a side is an intent to SEE it — heal any pane of that side that a
  // stale dismissal record removed from the tree, so ⌘B/⌘J can never press on
  // nothing. Closing chrome panes is NEVER permanent (main parity).
  if (!collapsed && !modeLayout.restoring) {
    restoreDismissedSidePanes(side)
  }
}

/** Explicit side-open also recovers hide-only tabs, without fronting over Bots. */
export function restoreHiddenTreeSideTabs(side: TreeSide): void {
  for (const paneId of [...$hiddenStripTabs.get()]) {
    if (paneRootSide(paneId) === side) {
      setStripTabHidden(paneId, false)
    }
  }
}

/** Restore minimized zones without changing their active tab (including Bots). */
export function restoreMinimizedTreeSide(side: TreeSide): boolean {
  const tree = $layoutTree.get()
  const row = rootRow()

  if (!tree || !row) {
    return false
  }

  let next = tree

  for (const child of row.children) {
    if (paneRootSide(allPaneIds(child)[0]) !== side) {
      continue
    }

    for (const id of groupLeafIds(child)) {
      const group = findGroup(next, id)

      // A tool panel (the terminal) owns its collapse through its store and
      // toggle. Revealing the side for Files must not also open an empty
      // terminal body under it.
      if (group?.minimized && !group.panes.every(isCollapsePane)) {
        next = setGroupMinimized(next, id, false)
      }
    }
  }

  if (next === tree) {
    return false
  }

  commit(next)

  return true
}

/**
 * Does the layout have a collapsible root side of `side`? ⌘J's normal target is
 * the right sidebar; a layout without one (e.g. a terminal-on-bottom preset)
 * lets callers fall back to the terminal so ⌘J is never a dead key. Tracks
 * physical position through a ⌘\ flip / drag, just like the toggles.
 */
export function layoutHasRootSide(side: TreeSide): boolean {
  const row = rootRow()

  if (!row) {
    return false
  }

  return row.children.some(child => paneRootSide(allPaneIds(child)[0]) === side)
}

/**
 * Un-dismiss + re-adopt every registered pane whose placement maps to `side`
 * (the same semantic mapping as `rootChildSide`: 'left' panes ⇔ ⌘B, everything
 * else non-main ⇔ ⌘J). Dismissal records for core chrome panes only exist as
 * legacy state (they all register closers now), but they must not strand the
 * pane where only a layout reset can recover it.
 */
function restoreDismissedSidePanes(side: TreeSide) {
  const dismissed = $dismissedPanes.get()

  if (dismissed.size === 0) {
    return
  }

  let changed = false

  for (const pane of registry.getArea('panes')) {
    if (!dismissed.has(pane.id)) {
      continue
    }

    const placement = paneChrome(pane).placement
    const paneSide = placement === 'left' ? 'left' : placement === 'main' ? null : 'right'

    if (paneSide === side) {
      setDismissed(pane.id, false)
      changed = true
    }
  }

  if (changed) {
    adoptContributedPanes()
  }
}

/** Bind a side's visibility to an app store (mirror of bindPaneVisibility). */
export function bindTreeSideVisibility(
  side: TreeSide,
  $open: { get(): boolean; listen(fn: (open: boolean) => void): void },
  setOpen: (open: boolean) => void
) {
  sideOpeners[side] = setOpen
  sideVisibility[side] = () => $open.get()

  if (!hasPersistedSides) {
    setTreeSideCollapsed(side, !$open.get())
  }

  $open.listen(open => setTreeSideCollapsed(side, !open))
}

/** The physical column's chrome toggle; main columns never side-collapse. */
export function treeSideOfPane(paneId: string): TreeSide | null {
  return paneRootSide(paneId)
}

/**
 * App intent "show pane X" (a preview target landed, ⌘G opened review, …):
 * open its side, unhide it, and bring it to the front of its group.
 */
export function revealTreePane(paneId: string) {
  // Reveal beats a Close: un-dismiss and let adoption put the pane back.
  if ($dismissedPanes.get().has(paneId)) {
    setDismissed(paneId, false)
  }

  // A layout replacement can omit a still-registered pane without dismissing
  // it. Reconcile that saved contribution before claiming to reveal it.
  const currentTree = $layoutTree.get()

  if (currentTree && !findGroupOfPane(currentTree, paneId)) {
    adoptContributedPanes()
  }

  // Reveal beats a hide too: clear the persisted hide-only record, or the
  // pane pops back hidden on the next launch even though it's on screen now.
  if ($hiddenStripTabs.get().has(paneId)) {
    $hiddenStripTabs.set(toggledSet($hiddenStripTabs.get(), paneId, false) ?? $hiddenStripTabs.get())
  }

  const side = treeSideOfPane(paneId)

  if (side && $collapsedTreeSides.get().has(side)) {
    // Un-collapse the COLUMN, never the side's bound store: on the right that
    // store is ⌘J / $fileBrowserOpen, i.e. the file tree's own toggle. Routing
    // a reveal through it dragged the tree open behind every neighbour that
    // shares the column — open the diff (⌘G) and the file tree appeared too.
    // The tree opens only when the user opens it.
    setTreeSideCollapsed(side, false)
  }

  const hiddenNow = $hiddenTreePanes.get()

  if (hiddenNow.has(paneId)) {
    setTreePaneHidden(paneId, false)
    // Reactive unhide preserves a visible sibling. Explicit reveal must also
    // front this pane and restore its group below.
  }

  const tree = $layoutTree.get()
  const group = tree ? findGroupOfPane(tree, paneId) : null

  if (tree && group) {
    // A minimized zone must be restored — "reveal" means show the pane, not
    // just front its tab behind a collapsed rail. Without this, a tool panel
    // (terminal/logs) in a shared zone stays minimized after its toggle opens
    // it: setPaneCollapsed's shared-zone branch calls revealTreePane instead
    // of setTreeGroupMinimized, so the zone never un-minimizes and the
    // pane appears to "close but not open" on ctrl-` / tab click.
    let next = tree

    if (group.minimized) {
      next = setGroupMinimized(next, group.id, false)
    }

    if (group.active !== paneId) {
      next = setActivePaneOp(next, group.id, paneId)
    }

    if (next !== tree) {
      commit(next)
    }
  }
}

/**
 * Dock `paneId` directly beside `anchorPaneId` — the "preview opens NEXT TO
 * the file tree" contract, position-aware: wherever the anchor lives (default
 * rail, flipped via ⌘\, dragged into a stack, tabbed into main), the pane
 * lands adjacent to it. Side rule: an anchor sitting right of the main zone
 * gets the pane on its LEFT (the rail slides open toward the chat — main
 * parity); an anchor left of main, stacked with it, or anywhere else gets it
 * on the RIGHT. Skipped when the USER has placed the pane themselves, or the
 * anchor isn't visible. Idempotent — a pane already beside its anchor is a
 * shape no-op.
 */
export function dockPaneBeside(paneId: string, anchorPaneId: string) {
  const tree = $layoutTree.get()

  if (!tree || $userPlacedPanes.get().has(paneId)) {
    return
  }

  const panes = registry.getArea('panes')
  const anchor = findGroupOfPane(tree, anchorPaneId)

  // Anchor must be a live, shown pane — never dock beside a hidden file tree.
  if (!anchor || $hiddenTreePanes.get().has(anchorPaneId) || !panes.some(c => c.id === anchorPaneId)) {
    return
  }

  // The uncloseable main workspace (session tiles are placement:'main' too,
  // but closeable, so the uncloseable flag disambiguates).
  const mainId = panes.find(c => {
    const data = paneChrome(c)

    return data.placement === 'main' && data.uncloseable
  })?.id

  const order = allPaneIds(tree)

  const anchorRightOfMain =
    !!mainId && !anchor.panes.includes(mainId) && order.indexOf(anchorPaneId) > order.indexOf(mainId)

  const pos: DropPosition = anchorRightOfMain ? 'left' : 'right'

  // A dismissed pane re-enters HERE (beside the anchor), not via adoption's
  // placement fallback — clear the record so the two never disagree.
  if ($dismissedPanes.get().has(paneId)) {
    setDismissed(paneId, false)
  }

  const next = findGroupOfPane(tree, paneId)
    ? movePaneOp(tree, paneId, { groupId: anchor.id, pos })
    : insertAtGroup(tree, anchor.id, paneId, pos, undefined, true, recalledEdgeWeights(paneId, anchorPaneId))

  if (next && next !== tree) {
    commit(next)
  }
}

/**
 * Replace the whole tree (preset application). Panes living in the CURRENT
 * tree that the preset doesn't know about (e.g. plugin panes vs a bundled
 * preset) are adopted into the group their current siblings land in, so
 * applying a preset never loses a pane.
 */
export function applyTree(tree: LayoutNode, presetId: string, resting: readonly string[] = []) {
  const previous = $layoutTree.get()

  // A preset defines the layout's SIZES too — stale drag overrides from the
  // previous arrangement would distort it. Same for user-placed pins: picking
  // a layout hands pane placement back to the app (auto-docking resumes).
  clearAllPaneSizeOverrides()
  $userPlacedPanes.set(new Set())
  commit(previous ? adoptMissingPanes(tree, previous) : tree)
  markActivePreset(presetId)

  // A preset says what is ON SCREEN. Every toggle-gated pane it places opens
  // through its owning store (so ⌃`/⌘J/⌘G stay truthful), except the ones it
  // places RESTING, which close through the same store. Iterate the preset's
  // DECLARED panes (not the adopted result) so only panes it explicitly places
  // move.
  const rests = new Set(resting)

  for (const paneId of allPaneIds(tree)) {
    if (rests.has(paneId)) {
      paneClosers[paneId]?.()

      // A store already reading closed makes that closer a same-value no-op,
      // and the fresh tree carries no minimized flag — so a tool pane's rail
      // is collapsed explicitly. Hide-style panes need nothing: the hidden
      // set outlives the tree.
      if (isCollapsePane(paneId)) {
        setPaneCollapsed(paneId, true)
      }
    } else {
      paneOpeners[paneId]?.()
    }
  }

  // Opening fronts the pane in its stack (a reveal is "show me this"), which
  // steals the active slot from whatever the preset put first — Focus opened
  // with the terminal over the chat. The preset's own tab order is the intent:
  // re-assert each declared group's active tab after the reveals.
  const applied = $layoutTree.get()

  if (applied) {
    for (const groupId of groupLeafIds(tree)) {
      const declared = findGroup(tree, groupId)
      const want = declared?.active ?? declared?.panes[0]
      const live = findGroup(applied, groupId)

      if (want && live && live.active !== want && live.panes.includes(want)) {
        activateTreePane(groupId, want)
      }
    }
  }
}

export function activateTreePane(groupId: string, paneId: string) {
  const tree = $layoutTree.get()

  if (!tree) {
    return
  }

  // A collapse-marked tool pane (terminal/logs) mounts its workspace ONLY
  // while its owning toggle store is open (PersistentTerminal). Fronting such
  // a tab without the store leaves an empty surface — no shell, no PTY — and
  // the next toggle press then reads the fronted pane as "on screen" and folds
  // the zone instead of opening it. A tab click on a tool pane is a reveal:
  // open its store with the front (the opener is a no-op when already open).
  if (isCollapsePane(paneId)) {
    paneOpeners[paneId]?.()
  }

  commit(setActivePaneOp(tree, groupId, paneId))
}

/** The group hosting `paneId`, or null. */
function paneGroup(paneId: string) {
  const tree = $layoutTree.get()

  return tree ? findGroupOfPane(tree, paneId) : null
}

/** Who takes the active slot when `paneId` steps out of the front of a SHARED
 *  zone that also hosts the uncloseable (workspace) pane: the workspace —
 *  New Session semantics — never an arbitrary adjacent sibling.
 *  [workspace, files, review, terminal] with the terminal active must land on
 *  workspace, not on review via `panes[at - 1]`, which stranded the user on a
 *  tool pane. Null when the zone has no uncloseable pane (a pure tool
 *  zone keeps its own rule). Shared by collapse (toggle) and Close (tab ✕). */
function chatZoneHandoff(group: { panes: string[] }, paneId: string): null | string {
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

/** Collapse/restore a pane's ZONE to a minimized rail — its tab stays visible.
 *  Store-driven (one-way): a tool panel's $open store mirrors here via
 *  bindPaneCollapse, so a toggle collapses rather than hides. */
export function setPaneCollapsed(paneId: string, collapsed: boolean) {
  const group = paneGroup(paneId)

  if (!group) {
    return
  }

  // SHARED zone (terminal + logs, or a tool panel stacked with the workspace):
  // one minimized flag but per-pane toggle stores — so "collapsed" is the
  // ZONE's. Open → reveal + front; close acts ONLY for the on-screen tab. An
  // inactive toggle folding its visible sibling is what re-collapsed the zone
  // on every boot (broke collapse persistence).
  if (group.panes.length > 1) {
    if (collapsed && group.active === paneId) {
      // Workspace can't minimize (strands the app) → hand it the active slot.
      const handoff = chatZoneHandoff(group, paneId)

      if (handoff) {
        activateTreePane(group.id, handoff)
      } else {
        // A shared zone with NO uncloseable member folds as a unit only when
        // every member is a tool pane ([terminal, logs]). A tool pane active
        // among hide-style panes (the terminal dragged into the sessions
        // column) must hand the slot to a non-tool sibling instead — folding
        // the group would collapse the sessions list along with the terminal.
        const peer = group.panes.find(id => id !== paneId && !isCollapsePane(id))

        if (peer) {
          activateTreePane(group.id, peer)
        } else {
          setTreeGroupMinimized(group.id, true) // pure tool zone folds as a unit
        }
      }
    } else if (!collapsed) {
      revealTreePane(paneId)
    }

    return
  }

  if (Boolean(group.minimized) !== collapsed) {
    setTreeGroupMinimized(group.id, collapsed)

    if (!collapsed) {
      revealTreePane(paneId)
    }
  }
}

/** Restore a minimized tool pane the truthful way — through its store opener
 *  when bound (keeps ⌃`/titlebar toggles in sync), then reveal regardless.
 *  Used by the rail (tab / whole-rail click), the header chevron, and ⌃`.
 *
 *  The opener is fire-and-forget because it may be a NO-OP: the store can
 *  already be `true` while the pane is off screen (the zone was minimized from
 *  the zone menu, the tab was closed with ⌘W, or a stacked sibling holds the
 *  active slot). nanostores don't fire listeners on a same-value `.set()`, so
 *  the bindPaneCollapse listener never runs. `revealTreePane` is idempotent and
 *  does the real work — un-dismiss, un-collapse the side, un-minimize, front. */
export function restoreTreePane(paneId: string) {
  paneOpeners[paneId]?.()
  revealTreePane(paneId)
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

export function resetLayoutTree() {
  persist(null)
  clearAllPaneSizeOverrides()
  // Reset restores EVERYTHING — closed panes included — and hands pane
  // placement back to the app (user-placed pins cleared).
  $dismissedPanes.set(new Set())
  $userPlacedPanes.set(new Set())

  // Hide-only chrome tabs (sessions / Bots) come back too — clear their
  // persisted hides through the setter so $hiddenTreePanes agrees.
  for (const paneId of [...$hiddenStripTabs.get()]) {
    setStripTabHidden(paneId, false)
  }

  $layoutTree.set(defaultTrees[modeLayout.mode])
  markActivePreset(modeLayout.mode === 'simple' ? 'sidebar-left' : 'default')
  // Owners PRE-PLACE their panes into the fresh default (session tiles stack
  // into main as tabs) FIRST, so generic adoption sees them already in-tree
  // and never scatters them to their old edges.
  resetHandlers.forEach(fn => fn())
  // Everything still missing (plugin panes) adopts by placement.
  adoptContributedPanes()

  // "Restore everything" includes collapsed SIDES: reopen every bound side
  // (through its store, so $sidebarOpen / the toggles stay truthful). Without
  // this a sidebar hidden before the reset silently survives it, flipping the
  // next ⌘B into a SHOW — so hiding never appears to persist.
  for (const side of Object.keys(sideOpeners) as TreeSide[]) {
    sideOpeners[side]?.(true)
  }
}

// Dev hook for automation.
if ((import.meta.env.DEV || import.meta.env.VITE_PERF_PROBE === '1') && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__HERMES_LAYOUT_TREE__ = {
    close: closeTreePane,
    dismissed: () => $dismissedPanes.get(),
    get: () => $layoutTree.get(),
    move: moveTreePane,
    registry,
    reset: resetLayoutTree,
    reveal: revealTreePane
  }
}
