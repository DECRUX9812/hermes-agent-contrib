// The layout tree itself: the persisted root atom, drag/drop session
// state, and the commit/persist helpers every sibling shares.

import {
  atom,
  computed
} from 'nanostores'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { Codecs } from '@/lib/persisted'
import { writeKey } from '@/lib/storage'
import {
  type InterfaceMode,
  modeLayout
} from '@/store/interface-mode'
import {
  isBrowserWindow,
  isSecondaryWindow
} from '@/store/windows'

import {
  type DropPosition,
  findGroupOfPane,
  isLayoutNode,
  type LayoutNode,
  migratePersistedTree,
  normalize
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

/** Pane id being dragged (tree drag session), null when idle. Also set to the
 *  SESSION_TILE_DRAG sentinel while a sidebar session is dragged over the tree,
 *  so the SAME zone overlay lights up (see session-tile-drop-bridge). */
export const $treeDragging = atom<string | null>(null)

/** Sentinel `$treeDragging` value for a session (not a pane) drag — the zone
 *  overlay renders its normal targets, scoped to session-hosting zones. */
export const SESSION_TILE_DRAG = '__session-tile-drag__'

/** Sentinel `$treeDragging` value for a NEW-session drag (the sidebar's
 *  "New session" row dragged into a zone). It reuses the SAME zone overlay as
 *  a session drag EXCEPT the "link to chat" affordance never lights: a session
 *  that doesn't exist yet can't be `@session`-linked, so a center drop stacks a
 *  fresh tab instead. Keeping this distinct from SESSION_TILE_DRAG is what lets
 *  the overlay's `sessionDrag` checks (which gate the link affordance) stay
 *  false here with zero edits to the hot overlay paths. */
export const NEW_SESSION_DRAG = '__new-session-drag__'

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

export interface DropHint {
  kind: 'group'
  /** The zone a drop will land in (ClosestCenter among `groupIds`). */
  groupId?: string
  /** Full highlighted set (multi-zone when Shift extends the range). */
  groupIds?: string[]
  pos?: DropPosition
  /** Hovering the target's TAB STRIP: the drop stacks at a specific slot —
   *  before this pane id, or at the end (`before: null`). The strip renders
   *  the insertion divider; the zone sheet stands down. */
  stack?: { before: null | string }
}

/** Live drop target under the pointer while dragging. */
export const $dropHint = atom<DropHint | null>(null)

/**
 * Derived session-drag booleans for HEAVY subscribers (the chat surfaces).
 * `$dropHint` churns on every pointer-crossing during ANY drag; a chat surface
 * subscribing to it raw re-renders its whole thread per hint change. These
 * computeds collapse the churn to booleans that only notify on actual flips —
 * and stay `false` throughout pane/tab drags, which chat never cares about.
 */
export const $sessionTileDragging = computed($treeDragging, dragging => dragging === SESSION_TILE_DRAG)

/** True while a session drag aims at a zone EDGE (a tile split) or a tab
 *  strip (a stack) — the moments the chat surfaces' "link to chat" overlay
 *  must stand down. */
export const $sessionTileEdgeHover = computed(
  [$treeDragging, $dropHint],
  (dragging, hint) =>
    dragging === SESSION_TILE_DRAG && ((hint?.pos !== undefined && hint.pos !== 'center') || hint?.stack !== undefined)
)

// The retired one-time dock-heal ledger (`heal: '<token>'` hints). Its guards
// (token burned even when the heal was skipped; $userPlacedPanes exempt) left
// exactly the users who had fought the old stacked layout stuck with it —
// enforced docks (`enforce: true`) replaced it. Drop the stale key.
writeKey('hermes.desktop.paneDockHeals.v1', null)

export function commit(next: LayoutNode | null) {
  if (!next) {
    return
  }

  $layoutTree.set(next)
  persist(next)
}

// ---------------------------------------------------------------------------
// USER-PLACED panes — "their spot wins". A pane the user has explicitly
// dragged (zone move / span / zone-menu split) keeps that placement; auto-
// docking (dockPaneBeside) only steers panes the user hasn't touched.
// Presets and resets hand placement back to the app.
// ---------------------------------------------------------------------------

export const $userPlacedPanes = modeLayout.atom<ReadonlySet<string>>(LAYOUT_KEYS.placed, () => new Set(), paneSetCodec)

export function markPaneUserPlaced(paneId: string) {
  const next = toggledSet($userPlacedPanes.get(), paneId, true)

  if (next) {
    $userPlacedPanes.set(next)
  }
}

/** The group hosting `paneId`, or null. */
export function paneGroup(paneId: string) {
  const tree = $layoutTree.get()

  return tree ? findGroupOfPane(tree, paneId) : null
}

export function persistTree() {
  persist($layoutTree.get())
}
