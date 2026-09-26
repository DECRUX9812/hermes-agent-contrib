// USER-INITIATED MOVES — dock, move, merge, reorder, minimize, strip writes.
// Each lands in commit() once; adoption/reveal live one layer up.

import { registry } from '@/contrib/registry'

import {
  allPaneIds,
  type DropPosition,
  findGroupOfPane,
  insertAtGroup,
  mergeZonesWithPane as mergeZonesWithPaneOp,
  mirrorTreeHorizontal,
  movePane as movePaneOp,
  movePanes as movePanesOp,
  reorderPanesInGroup as reorderPanesInGroupOp,
  setActivePane as setActivePaneOp,
  setGroupMinimized,
  setGroupTabStrip as setGroupTabStripOp,
  setSplitWeights as setSplitWeightsOp,
  type TabStripMode
} from './model'
import { paneChrome } from './renderer/track-model'
import { $layoutTree, $userPlacedPanes, commit, markActivePreset, markPaneUserPlaced } from './store-core'
import { recalledEdgeWeights } from './store-shares'
import { $dismissedPanes, $hiddenTreePanes, isCollapsePane, paneOpeners, setDismissed } from './store-visibility'

/** The titlebar flip toggle (⌘\): mirror the whole layout left↔right. */
export function mirrorLayoutTree() {
  const tree = $layoutTree.get()

  if (tree) {
    commit(mirrorTreeHorizontal(tree))
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

export function moveTreePane(paneId: string, target: { groupId: string; pos: DropPosition; before?: null | string }) {
  const tree = $layoutTree.get()

  if (!tree) {
    return
  }

  const next = movePaneOp(tree, paneId, target)

  // movePane returns the SAME root for no-op drops ("stays here") — only a
  // real move customizes the preset or pins the pane as user-placed.
  if (next !== tree) {
    commit(next)
    markActivePreset('custom')
    markPaneUserPlaced(paneId)
  }
}

/**
 * Move a multi-tab SELECTION in one commit (drag any selected tab): the lead
 * pane takes the drop geometry, the rest stack in behind it in strip order,
 * and `activeId` (the pressed tab) fronts in the landing group.
 */
export function moveTreePanes(
  paneIds: readonly string[],
  target: { groupId: string; pos: DropPosition; before?: null | string },
  activeId?: string
) {
  const tree = $layoutTree.get()

  if (!tree) {
    return
  }

  const next = movePanesOp(tree, paneIds, target, activeId)

  if (next !== tree) {
    commit(next)
    markActivePreset('custom')

    for (const paneId of paneIds) {
      markPaneUserPlaced(paneId)
    }
  }
}

/**
 * Shift-drag span: merge the highlighted zones into one holding `paneId`. Falls
 * back to a single-zone move at `fallbackGroupId` when the set can't merge
 * (non-rectangular selection).
 */
export function mergeTreeZones(groupIds: string[], paneId: string | readonly string[], fallbackGroupId: null | string) {
  const tree = $layoutTree.get()

  if (!tree) {
    return
  }

  const paneIds = typeof paneId === 'string' ? [paneId] : paneId
  const merged = mergeZonesWithPaneOp(tree, groupIds, paneId)

  if (merged) {
    commit(merged)
    markActivePreset('custom')

    for (const id of paneIds) {
      markPaneUserPlaced(id)
    }
  } else if (fallbackGroupId) {
    moveTreePanes(paneIds, { groupId: fallbackGroupId, pos: 'center' })
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

/** Reorder a tab block (multi-tab selection, or a single tab) within its
 *  group's strip — the block keeps its own order. */
export function reorderTreePanes(groupId: string, paneIds: readonly string[], toIndex: number) {
  const tree = $layoutTree.get()

  if (tree) {
    commit(reorderPanesInGroupOp(tree, groupId, paneIds, toIndex))
    markActivePreset('custom')
  }
}

export function setTreeGroupMinimized(groupId: string, minimized: boolean) {
  const tree = $layoutTree.get()

  if (tree) {
    commit(setGroupMinimized(tree, groupId, minimized))
  }
}

/** Write a zone's standing tab-strip choice; `undefined` returns it to auto. */
export function setTreeGroupTabStrip(groupId: string, tabStrip: TabStripMode | undefined) {
  const tree = $layoutTree.get()

  if (tree) {
    commit(setGroupTabStripOp(tree, groupId, tabStrip))
  }
}

export function setTreeSplitWeights(splitId: string, weights: number[]) {
  const tree = $layoutTree.get()

  if (tree) {
    // Weight drags are high-frequency: update live, persist on the trailing edge.
    $layoutTree.set(setSplitWeightsOp(tree, splitId, weights))
  }
}
