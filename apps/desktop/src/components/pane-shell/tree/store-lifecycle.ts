// TREE LIFECYCLE — the one strongly-connected cluster: contributed-pane
// adoption, dock enforcement, reveal, pane collapse/restore, and the
// side-collapse verbs that drive adoption.

import { registry } from '@/contrib/registry'
import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { modeLayout } from '@/store/interface-mode'

import {
  allPaneIds,
  findGroupOfPane,
  groupLeafIds,
  insertAtGroup,
  type LayoutNode,
  movePane as movePaneOp,
  removePane,
  setActivePane as setActivePaneOp,
  setGroupMinimized
} from './model'
import { FLOATING_PLACEMENT } from './renderer/floating-rect'
import {
  paneChrome,
  type PaneContribution
} from './renderer/track-model'
import { $layoutTree, commit, defaultTrees, paneGroup, toggledSet } from './store-core'
import { activateTreePane, setTreeGroupMinimized } from './store-moves'
import { beginLayoutHydration, endLayoutHydration, recalledEdgeWeights } from './store-shares'
import { $collapsedTreeSides, type TreeSide, treeSideOfPane } from './store-sides'
import { $dismissedPanes, $hiddenStripTabs, $hiddenTreePanes, chatZoneHandoff, isCollapsePane, paneOpeners, setDismissed, setTreePaneHidden } from './store-visibility'

/**
 * Adopt panes present in `source` but missing from `target`: each joins the
 * group its source siblings map to in the target (first group as a last
 * resort). Layout changes never lose panes.
 */
export function adoptMissingPanes(target: LayoutNode, source: LayoutNode): LayoutNode {
  const have = new Set(allPaneIds(target))
  let next = target

  for (const paneId of allPaneIds(source)) {
    if (have.has(paneId)) {
      continue
    }

    const sibling = findGroupOfPane(source, paneId)?.panes.find(p => have.has(p))
    const targetId = (sibling ? findGroupOfPane(next, sibling)?.id : undefined) ?? groupLeafIds(next)[0]

    if (targetId) {
      // Silent adoption: don't steal the target zone's active tab (logs).
      next = insertAtGroup(next, targetId, paneId, 'center', null, false) ?? next
      have.add(paneId)
    }
  }

  return next
}

/**
 * Declare the app's default tree. Adopted immediately when the user has no
 * persisted customization; a persisted tree from an older default adopts any
 * panes it's missing.
 */
export function declareDefaultTree(tree: LayoutNode, simpleTree: LayoutNode = tree) {
  defaultTrees.advanced = tree
  defaultTrees.simple = simpleTree
  const defaultTree = defaultTrees[modeLayout.mode]!
  const current = $layoutTree.get()

  if (!current) {
    $layoutTree.set(defaultTree)

    return
  }

  const next = adoptMissingPanes(current, defaultTree)

  if (next !== current) {
    commit(next)
  }
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
    c => !inTree.has(c.id) && !dismissed.has(c.id) && placementOf(c.id) !== FLOATING_PLACEMENT
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

const hasPersistedSides = modeLayout.has(LAYOUT_KEYS.collapsed)

// Side visibility is DERIVED from an app store (the binding owns persistence
// + button state). Reveals un-collapse the column directly instead of writing
// back through the setter — the right side's store IS the file tree's toggle,
// so a neighbour's reveal must not press it. Layout reset still reopens every
// side through its setter, because there the toggles SHOULD move.
export const sideOpeners: Partial<Record<TreeSide, (open: boolean) => void>> = {}
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
