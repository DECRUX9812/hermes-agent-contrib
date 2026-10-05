/**
 * The renderer half of the darwin/win32 click-through strategy (architecture §6).
 *
 * There is no `setShape` there, so the window stays
 * `setIgnoreMouseEvents(true, { forward: true })` and the renderer decides, per
 * forwarded pointer move, whether the pointer is over something interactive.
 * The decision is pure so the latch rules (composer open, mid-drag) are
 * provable without a window; only the change-only `{type:'ignore-mouse'}` send
 * lives in the publisher.
 */

import type { ScreenRect } from '../protocol'

export interface Point {
  x: number
  y: number
}

export function pointInRect(point: Point, rect: ScreenRect): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

export function pointInAnyRegion(point: Point, regions: ScreenRect[]): boolean {
  return regions.some(rect => pointInRect(point, rect))
}

export interface ForwardHitInput {
  platform: NodeJS.Platform
  /** Last forwarded pointer position, null before the first move. */
  pointer: Point | null
  /** `elementFromPoint(...).closest('[data-pane-hit]')` matched something. */
  elementHit: boolean
  /** Published regions, pane CSS px (the fallback test for avatar parts). */
  regions: ScreenRect[]
  /** Any avatar is in `listening` — the composer needs the keyboard and clicks. */
  composerOpen: boolean
  /** A pointer button is down; flipping to click-through mid-drag loses the drag. */
  dragging: boolean
  /** The ignore state the window is in now. */
  current: boolean
}

/**
 * Whether the pane should ignore the mouse (`true`) or take it (`false`).
 *
 * Linux never enters forward mode — `setShape` owns interactivity there — so
 * the current state is returned untouched. While the composer is open the pane
 * must keep the mouse; mid-drag it must not change its mind; before the first
 * pointer move it stays click-through.
 */
export function decideIgnoreMouse(input: ForwardHitInput): boolean {
  const { composerOpen, current, dragging, elementHit, platform, pointer, regions } = input

  if (platform === 'linux') {
    return current
  }

  if (composerOpen) {
    return false
  }

  if (dragging) {
    return current
  }

  if (!pointer) {
    return true
  }

  return !(elementHit || pointInAnyRegion(pointer, regions))
}
