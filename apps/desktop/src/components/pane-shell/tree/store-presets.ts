// WHOLE-TREE REPLACEMENT — preset application, split-weight recall, and the
// nuclear reset. The dev automation hook lives last so it binds fully-wired
// verbs from every sibling.

import { registry } from '@/contrib/registry'
import { modeLayout } from '@/store/interface-mode'
import { clearAllPaneSizeOverrides } from '@/store/panes'

import {
  allPaneIds,
  findGroup,
  groupLeafIds,
  isLayoutNode,
  type LayoutNode
} from './model'
import { $activePresetId, $layoutTree, $userPlacedPanes, commit, defaultTrees, markActivePreset, persist } from './store-core'
import { adoptContributedPanes, adoptMissingPanes, revealTreePane, setPaneCollapsed, sideOpeners } from './store-lifecycle'
import { activateTreePane, moveTreePane } from './store-moves'
import { closeTreePane } from './store-ops'
import type { TreeSide } from './store-sides'
import { $dismissedPanes, $hiddenStripTabs, isCollapsePane, paneClosers, paneOpeners, resetHandlers, setStripTabHidden } from './store-visibility'

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
