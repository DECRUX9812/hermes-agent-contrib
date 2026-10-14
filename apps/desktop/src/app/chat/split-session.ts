import { atom, computed } from 'nanostores'

import { findGroupOfPane, type GroupNode, type LayoutNode, type SplitNode } from '@/components/pane-shell/tree/model'
import {
  $collapsedTreeSides,
  $dismissedPanes,
  $hiddenTreePanes,
  $layoutTree,
  $newSessionTabAction,
  isPaneVisible,
  isSessionStripPane,
  type NewSessionTabOptions
} from '@/components/pane-shell/tree/store'
import { $focusedTreePaneId } from '@/store/session-focus'

export const MAX_CHAT_ZONES = 4

export type SplitPlacement = NonNullable<NewSessionTabOptions['placement']>

/** Wiring registers the split action here; null until wired hides the glyph. */
export const $splitSessionAction = atom<(() => boolean) | null>(null)

export function visibleChatZones(tree: LayoutNode | null, isVisible: (paneId: string) => boolean): GroupNode[] {
  if (!tree) {
    return []
  }

  if (tree.type === 'group') {
    return !tree.minimized && isSessionStripPane(tree.active) && isVisible(tree.active) ? [tree] : []
  }

  return tree.children.flatMap(child => visibleChatZones(child, isVisible))
}

function countChatZones(node: LayoutNode, isVisible: (paneId: string) => boolean): number {
  if (node.type === 'group') {
    return !node.minimized && isSessionStripPane(node.active) && isVisible(node.active) ? 1 : 0
  }

  return node.children.reduce((total, child) => total + countChatZones(child, isVisible), 0)
}

function ancestorSplits(node: LayoutNode, groupId: string, trail: SplitNode[] = []): null | SplitNode[] {
  if (node.type === 'group') {
    return node.id === groupId ? trail : null
  }

  for (const child of node.children) {
    const hit = ancestorSplits(child, groupId, [...trail, node])

    if (hit) {
      return hit
    }
  }

  return null
}

/** A chat zone with no column-split sibling zones: splitting it downward keeps
 *  the grid rectangular on the way to 2x2. */
function isLoneInColumn(tree: LayoutNode, groupId: string, isVisible: (paneId: string) => boolean): boolean {
  const ancestors = ancestorSplits(tree, groupId) ?? []

  return ancestors.every(split => split.orientation !== 'column' || countChatZones(split, isVisible) <= 1)
}

/** Grid fill order over the live tree: 1 zone splits right; 2 split below the
 *  focused chat zone; 3 split below the zone still alone in its column (else
 *  below the focused one), closing a 2x2 grid. Null at the cap or with no
 *  chat zone on screen. */
export function nextSplitPlacement(
  tree: LayoutNode | null,
  focusedGroupId: null | string,
  isVisible: (paneId: string) => boolean = () => true
): null | SplitPlacement {
  if (!tree) {
    return null
  }

  const zones = visibleChatZones(tree, isVisible)

  if (zones.length === 0 || zones.length >= MAX_CHAT_ZONES) {
    return null
  }

  if (zones.length === 1) {
    return { anchor: zones[0]!.active, dir: 'right' }
  }

  const focused = focusedGroupId ? (zones.find(zone => zone.id === focusedGroupId) ?? null) : null

  if (zones.length === 2) {
    return { anchor: (focused ?? zones[1]!).active, dir: 'bottom' }
  }

  const lone = zones.find(zone => isLoneInColumn(tree, zone.id, isVisible))

  return { anchor: (lone ?? focused ?? zones[0]!).active, dir: 'bottom' }
}

export const $visibleChatZones = computed(
  [$layoutTree, $hiddenTreePanes, $dismissedPanes, $collapsedTreeSides],
  tree => visibleChatZones(tree, isPaneVisible)
)

export const $chatZoneCount = computed($visibleChatZones, zones => zones.length)

export const $canSplitSession = computed(
  $visibleChatZones,
  zones => zones.length > 0 && zones.length < MAX_CHAT_ZONES
)

export const $splitSessionTab = computed($visibleChatZones, zones => ({
  canSplit: zones.length > 0 && zones.length < MAX_CHAT_ZONES,
  capped: zones.length >= MAX_CHAT_ZONES
}))

export function splitFocusedSession(): boolean {
  const tree = $layoutTree.get()
  const focusedPane = $focusedTreePaneId.get()
  const focusedGroup = tree && focusedPane ? (findGroupOfPane(tree, focusedPane)?.id ?? null) : null
  const placement = nextSplitPlacement(tree, focusedGroup, isPaneVisible)
  const open = $newSessionTabAction.get()

  if (!placement || !open) {
    return false
  }

  open({ placement })

  return true
}
