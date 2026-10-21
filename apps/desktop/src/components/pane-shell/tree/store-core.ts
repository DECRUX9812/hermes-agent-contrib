import { atom } from 'nanostores'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { registry } from '@/contrib/registry'
import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { Codecs } from '@/lib/persisted'
import { writeKey } from '@/lib/storage'
import { type InterfaceMode, modeLayout } from '@/store/interface-mode'
import { isBrowserWindow, isSecondaryWindow } from '@/store/windows'

import {
  allPaneIds,
  type DropPosition,
  findGroupOfPane,
  groupLeafIds,
  insertAtGroup,
  isLayoutNode,
  type LayoutNode,
  mergeZonesWithPane as mergeZonesWithPaneOp,
  migratePersistedTree,
  mirrorTreeHorizontal,
  movePane as movePaneOp,
  movePanes as movePanesOp,
  normalize,
  reorderPanesInGroup as reorderPanesInGroupOp,
  setGroupMinimized,
  setGroupTabStrip as setGroupTabStripOp,
  setSplitWeights as setSplitWeightsOp,
  type TabStripMode
} from './model'

// v2: v1 trees were saved against placeholder panes with index-order zone
// assignment (chat could land in a corner cell). Retire them wholesale.
writeKey('hermes.desktop.layoutTree.v1', null)

export const defaultTrees: Record<InterfaceMode, LayoutNode | null> = { advanced: null, simple: null }

export function persist(tree: LayoutNode | null) {
  // A secondary window (single-chat pop-out) shares the origin's localStorage;
  // writing its stripped-down DEFAULT tree back would wipe the primary's layout.
  // A popped-out Browser is the same class of window.
  if (isSecondaryWindow() || isBrowserWindow()) {
    return
  }

  modeLayout.write(LAYOUT_KEYS.tree, tree === null ? null : JSON.stringify(tree))
}

/** The live tree (null until a default is declared). A secondary window ignores
 *  the persisted (primary) layout and boots to the default — nothing but its
 *  own routed session. */
export const $layoutTree = modeLayout.atom<LayoutNode | null>(
  LAYOUT_KEYS.tree,
  () => defaultTrees[modeLayout.mode],
  Codecs.json(parsed =>
    isLayoutNode(parsed) ? normalize(migratePersistedTree(parsed)) : defaultTrees[modeLayout.mode]
  ),
  true
)

export function commit(next: LayoutNode | null) {
  if (!next) {
    return
  }

  $layoutTree.set(next)
  persist(next)
}

/**
 * Which layout preset the current tree came from; `'custom'` after the user
 * rearranges anything. Drives the picker's active highlight.
 */
export const $activePresetId = modeLayout.atom(
  LAYOUT_KEYS.preset,
  () => (modeLayout.mode === 'simple' ? 'sidebar-left' : 'default'),
  Codecs.text
)

export function markActivePreset(id: string) {
  $activePresetId.set(id)
}

/** Add/remove `item` in a readonly set, returning a fresh set — or null when
 *  membership already matches `present` (so callers can early-out on a no-op). */
export function toggledSet<T>(set: ReadonlySet<T>, item: T, present: boolean): Set<T> | null {
  if (set.has(item) === present) {
    return null
  }

  const next = new Set(set)

  if (present) {
    next.add(item)
  } else {
    next.delete(item)
  }

  return next
}

export const paneSetCodec = {
  decode: (raw: string): ReadonlySet<string> => new Set(Codecs.stringArray.decode(raw)),
  encode: (value: ReadonlySet<string>) => Codecs.stringArray.encode([...value])
}

/**
 * Narrow viewport (the app's sidebar-collapse breakpoint): panes whose
 * contribution declares `collapsible: true` leave the grid and become
 * edge overlays (see NarrowOverlays in renderer.tsx).
 */
// Optional-chained + `typeof window` guarded like every other matchMedia call
// site: this module is imported by non-DOM code paths (session actions) whose
// test env has no `window`/`matchMedia` — an unguarded call throws at load.
const narrowQuery = typeof window !== 'undefined' ? window.matchMedia?.(SIDEBAR_COLLAPSE_MEDIA_QUERY) : undefined

export const $narrowViewport = atom(Boolean(narrowQuery?.matches))

narrowQuery?.addEventListener('change', event => $narrowViewport.set(event.matches))

/** The titlebar flip toggle (⌘\): mirror the whole layout left↔right. */
export function mirrorLayoutTree() {
  const tree = $layoutTree.get()

  if (tree) {
    commit(mirrorTreeHorizontal(tree))
  }
}

/** Pane ids in the tree under a `${prefix}:` namespace — lets a mirror prune
 *  panes the SHARED (cross-profile) tree persisted for tiles that no longer
 *  back the current profile (a profile switch reloads with the other profile's
 *  tile panes still stacked in). */
export function treePanesWithPrefix(prefix: string): string[] {
  const tree = $layoutTree.get()

  return tree ? allPaneIds(tree).filter(id => id.startsWith(prefix)) : []
}

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

// ---------------------------------------------------------------------------
// USER-PLACED panes — "their spot wins". A pane the user has explicitly
// dragged (zone move / span / zone-menu split) keeps that placement; auto-
// docking (dockPaneBeside) only steers panes the user hasn't touched.
// Presets and resets hand placement back to the app.
// ---------------------------------------------------------------------------

export const $userPlacedPanes = modeLayout.atom<ReadonlySet<string>>(LAYOUT_KEYS.placed, () => new Set(), paneSetCodec)

function markPaneUserPlaced(paneId: string) {
  const next = toggledSet($userPlacedPanes.get(), paneId, true)

  if (next) {
    $userPlacedPanes.set(next)
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

function findSplitWeights(node: LayoutNode, splitId: string): number[] | null {
  if (node.type !== 'split') {
    return null
  }

  if (node.id === splitId) {
    return node.weights
  }

  for (const child of node.children) {
    const hit = findSplitWeights(child, splitId)

    if (hit) {
      return hit
    }
  }

  return null
}

/**
 * The weights a layout preset declares for `splitId` — the ACTIVE preset
 * first, then any other preset that knows the id. (Rearranging panes marks
 * the active preset 'custom' but zone STRUCTURE — and so split ids — comes
 * from whichever preset was applied, so the original baseline stays
 * findable.) Null when no preset has a matching-shape split.
 */
export function presetSplitWeights(splitId: string, length: number): number[] | null {
  const activeId = $activePresetId.get()
  const presets = [...registry.getArea('layouts')].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId))

  for (const preset of presets) {
    const weights = preset.data && isLayoutNode(preset.data) ? findSplitWeights(preset.data, splitId) : null

    if (weights && weights.length === length) {
      return [...weights]
    }
  }

  return null
}

export function persistTree() {
  persist($layoutTree.get())
}
