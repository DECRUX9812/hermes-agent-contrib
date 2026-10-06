import { chartRuntime } from '../director/chart-state'
import type { AvatarState } from '../director/store'
import type { AvatarId, PaneAnchor, ScreenRect } from '../protocol'
import { AVATAR_IDS } from '../protocol'
import { reservedSlotRect, unionScreenRects, type Viewport } from '../scene/projection'
import { type AvatarSilhouette, visibleSlotLayout } from '../scene/slot-layout'

import type { CardBox } from './card-geometry'

export interface ObstacleInput {
  anchor: PaneAnchor
  /** The director's per-avatar rows. */
  avatars: Record<AvatarId, { state: AvatarState; visible: boolean }>
  /** The live projected frames. */
  frames: Record<AvatarId, { screenRect: ScreenRect | null }>
  /** Every registered avatar (the slot layout budgets the dock from the whole cast). */
  silhouettes: readonly AvatarSilhouette[]
  viewport: Viewport
  /** The bubble's own speaker, which never counts as an obstacle to itself. */
  exclude?: AvatarId
}

/** True while the rig is climbing through the perch line — in OR out (§8.4). */
export function isSettlingAvatar(state: AvatarState): boolean {
  return state === 'emerging' || state === 'hiding'
}

/**
 * The obstacle boxes for card and bubble placement (VAL-NOTIFY-005/007).
 *
 * A visible avatar's animated `screenRect` is exact for a settled avatar, but
 * while it emerges the rig is still below the perch line: the animated rect sits
 * under the edge and reports the space the avatar is rising into as free, so an
 * open card can be placed there and then be crossed by the newcomer. An
 * emerging (or hiding) avatar therefore contributes the UNION of its animated
 * rect and its final perch rect, computed straight from the slot row — the same
 * row `Stage` places the rig on, so the reservation exists from the frame the
 * avatar becomes visible, with no dependence on the render loop.
 *
 * A settled pane is byte-for-byte what it always was: the slot row is only
 * computed while somebody is settling, and every other avatar uses its exact
 * projected rect.
 */
export function avatarObstacleBoxes(input: ObstacleInput): CardBox[] {
  const { anchor, avatars, exclude, frames, silhouettes, viewport } = input
  const ids = AVATAR_IDS.filter(id => id !== exclude && avatars[id]?.visible)
  const settling = ids.some(id => isSettlingAvatar(avatars[id].state))
  const slots = settling ? visibleSlotLayout({ anchor, avatars, silhouettes, viewport }) : null
  const sizeById = new Map(silhouettes.map(size => [size.id, size]))

  return ids
    .map(id => {
      const rect = frames[id]?.screenRect ?? null
      const size = sizeById.get(id)
      const slot = slots?.[id]

      if (!slot || !size || !isSettlingAvatar(avatars[id].state)) {
        return rect
      }

      const reserved = reservedSlotRect(slot, size, viewport)

      return rect ? unionScreenRects(rect, reserved) : reserved
    })
    .filter((rect): rect is ScreenRect => rect !== null)
}

/**
 * The presented chart panel's box, or null when no chart is up (VAL-CHART-005).
 *
 * A SECONDARY obstacle: a card or bubble avoids it when it can, but never at the
 * cost of covering an avatar or leaving the pane — the caller passes it as
 * `placeCards`/`bubbleLayout`'s `avoid` list, which keeps avatars and the pane
 * bounds ahead of the chart. The rect comes from `chartViewFor` (via
 * `chartRuntime.panelRect`), the same numbers that place the panel.
 */
export function chartObstacleBox(): CardBox | null {
  if (!chartRuntime.visible || !chartRuntime.panelRect) {
    return null
  }

  return chartRuntime.panelRect
}
