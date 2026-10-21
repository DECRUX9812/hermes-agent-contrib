import { hasAvatar } from '../avatars/registry'
import type { AvatarId, PaneAnchor } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import { type AvatarSize, computeSlotLayout, dockRect, type SlotTarget, type Viewport } from './projection'

/** An avatar's declared silhouette, keyed by id (the registry's shape). */
export interface AvatarSilhouette extends AvatarSize {
  id: AvatarId
}

export interface SlotLayoutSource {
  anchor: PaneAnchor
  /** The director's per-avatar rows; only `visible` ids get a slot. */
  avatars: Record<AvatarId, { visible: boolean }>
  /** Every registered avatar, whether visible or not — the dock size depends on the cast. */
  silhouettes: readonly AvatarSilhouette[]
  viewport: Viewport
}

/**
 * The perch row for the avatars that are currently visible (architecture §8.6).
 *
 * One source for both the scene (which places the rigs) and the DOM layer (which
 * must know the space an emerging avatar is about to occupy — VAL-NOTIFY-007).
 * The dock width is budgeted from the whole cast, exactly as `Stage` always did.
 */
export function visibleSlotLayout(source: SlotLayoutSource): Record<AvatarId, SlotTarget> {
  const { anchor, avatars, silhouettes, viewport } = source

  const heights = Object.fromEntries(silhouettes.map(size => [size.id, size.height])) as Record<AvatarId, number>

  const widths = Object.fromEntries(
    silhouettes.filter(size => size.width !== undefined).map(size => [size.id, size.width as number])
  ) as Partial<Record<AvatarId, number>>

  const ids = AVATAR_IDS.filter(id => avatars[id]?.visible && hasAvatar(id))

  return computeSlotLayout({
    anchor,
    dock: dockRect(silhouettes.length, viewport),
    heights,
    ids,
    viewport,
    widths
  })
}
