import { atom, computed } from 'nanostores'

import { type DropPosition } from './model'

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
