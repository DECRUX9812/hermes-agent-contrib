// POSITIONAL SIDE COLLAPSE — side geometry reads only.
// The collapse *verbs* live in store-lifecycle (they run pane adoption).

import { registry } from '@/contrib/registry'
import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { modeLayout } from '@/store/interface-mode'

import {
  allPaneIds,
  findGroup,
  groupLeafIds,
  type LayoutNode,
  setGroupMinimized,
  type SplitNode
} from './model'
import { paneChrome } from './renderer/track-model'
import { $layoutTree, commit } from './store-core'
import { $hiddenStripTabs, setStripTabHidden } from './store-visibility'

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

/** The layout's root ROW — the split that contains main + the side columns.
 *  Usually the root itself (Default, Focus); in a column-root layout (Terminal
 *  deck, Quad) it's the row child that holds sessions/workspace/files. Returns
 *  null when the tree has no row split with side-eligible panes. */
function rootRow(): SplitNode | null {
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
      if (findGroup(next, id)?.minimized) {
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

/** The physical column's chrome toggle; main columns never side-collapse. */
export function treeSideOfPane(paneId: string): TreeSide | null {
  return paneRootSide(paneId)
}
