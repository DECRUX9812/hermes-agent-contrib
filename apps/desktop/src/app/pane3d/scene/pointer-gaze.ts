import type { AvatarId } from '../protocol'

/**
 * Pointer-driven gaze (architecture §8.4, §12): while the pointer is over an
 * avatar's handle, the avatar looks toward the half of the handle it is on.
 * A plain mutable map — written by DOM pointer events, read by the frame loop,
 * never React state.
 *
 * `x` positive = toward screen-right, `y` positive = up (both -1..1).
 */
export interface PointerGaze {
  active: boolean
  x: number
  y: number
}

const gaze = new Map<AvatarId, PointerGaze>()

export function setPointerGaze(id: AvatarId, x: number, y: number): void {
  gaze.set(id, { active: true, x: clamp(x), y: clamp(y) })
}

export function clearPointerGaze(id: AvatarId): void {
  gaze.set(id, { active: false, x: 0, y: 0 })
}

export function getPointerGaze(id: AvatarId): PointerGaze {
  return gaze.get(id) ?? { active: false, x: 0, y: 0 }
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}
