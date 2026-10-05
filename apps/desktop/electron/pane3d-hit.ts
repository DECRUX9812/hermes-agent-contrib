/**
 * Click-through policy for the 3D Pane (architecture §6).
 *
 * The renderer publishes the regions it painted, in pane-local CSS px. This
 * module turns that list into the calls the platform needs — as data, so the
 * strategy is unit-testable without booting Electron:
 *
 * - **linux/X11:** the window's input shape IS the click-through, so the shape
 *   alone carries the whole strategy: shape to the regions (converted to DIP)
 *   and clicks inside them land on the pane while clicks outside fall through
 *   to whatever is underneath. With nothing to interact with, collapse to a
 *   1×1 shape — the corner is the only interactive pixel. `setIgnoreMouseEvents`
 *   is never run on this platform: there `(true)` empties the input region for
 *   good (`(false)` cannot restore it — the one-way door hud-ipc.ts vetoes), so
 *   toggling it would make the pane permanently click-through.
 *   `setShape([])` must NEVER be used either: Electron reads an empty list as
 *   "the whole rectangle", which would turn the transparent overlay into a
 *   full-screen click eater.
 * - **darwin/win32:** `forward: true` from spawn, and the renderer's exact
 *   per-pixel test (mesh raycast / `elementFromPoint().closest('[data-pane-hit]')`)
 *   toggles the ignore state as `{type:'ignore-mouse'}`. A region update must
 *   NOT re-arm click-through underneath the pointer, so with regions present
 *   the plan is empty; only the "nothing interactable" case re-arms it.
 *
 * Zoom: Chromium UI zoom is per-origin, so the pane renders at the session
 * factor (0.9 on the validation host). CSS px × factor = DIP, rounded OUTWARD
 * so the shape never clips the pixels it keeps interactive.
 */

import type { ScreenRect } from '../src/app/pane3d/protocol'

import { type PaneClickThroughStrategy, paneClickThroughStrategy } from './pane3d'

/** The shape used when nothing is interactive. Never an empty list. */
export const COLLAPSED_SHAPE: ScreenRect = { height: 1, width: 1, x: 0, y: 0 }

export type HitOp =
  { op: 'setShape'; rects: ScreenRect[] } | { op: 'setIgnoreMouseEvents'; ignore: boolean; forward: boolean }

export interface HitApplicationPlan {
  strategy: PaneClickThroughStrategy
  /** DIP rects to shape to; null when the strategy leaves the shape alone. */
  shape: ScreenRect[] | null
  /** Ordered calls to make. Forward platforms return [] for a non-empty update. */
  ops: HitOp[]
  ignoreMouse: boolean
  forward: boolean
}

function roundOutward(rect: ScreenRect): ScreenRect {
  const left = Math.floor(rect.x)
  const top = Math.floor(rect.y)
  const right = Math.ceil(rect.x + rect.width)
  const bottom = Math.ceil(rect.y + rect.height)

  return { height: Math.max(1, bottom - top), width: Math.max(1, right - left), x: left, y: top }
}

/**
 * Renderer CSS px → window DIP. A zoom the window cannot report (0, NaN,
 * negative) is treated as 1: shrinking the shape to nothing would eat the
 * avatars' clicks, which is worse than ignoring a broken factor.
 */
export function regionsToDip(regions: ScreenRect[], zoomFactor = 1): ScreenRect[] {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1

  return regions.map(rect =>
    roundOutward({ height: rect.height * zoom, width: rect.width * zoom, x: rect.x * zoom, y: rect.y * zoom })
  )
}

export function planHitApplication(
  regions: ScreenRect[],
  platform: NodeJS.Platform = process.platform,
  zoomFactor = 1
): HitApplicationPlan {
  if (paneClickThroughStrategy(platform) === 'forward') {
    return {
      strategy: 'forward',
      ignoreMouse: true,
      forward: true,
      // Nothing interactable: make sure the pane is click-through even if the
      // renderer's last exact test left it taking the mouse.
      ops: regions.length === 0 ? [{ forward: true, ignore: true, op: 'setIgnoreMouseEvents' }] : [],
      shape: null
    }
  }

  if (regions.length === 0) {
    return {
      strategy: 'shape',
      ignoreMouse: true,
      forward: false,
      ops: [
        { op: 'setShape', rects: [COLLAPSED_SHAPE] },
        { forward: false, ignore: true, op: 'setIgnoreMouseEvents' }
      ],
      shape: [COLLAPSED_SHAPE]
    }
  }

  const dip = regionsToDip(regions, zoomFactor)

  return {
    strategy: 'shape',
    ignoreMouse: false,
    forward: false,
    // Shape last: the previous shape stays live until this call widens it, so
    // no click can land in a region the pane has already stopped painting.
    ops: [
      { forward: false, ignore: false, op: 'setIgnoreMouseEvents' },
      { op: 'setShape', rects: dip }
    ],
    shape: dip
  }
}

/** The part of a BrowserWindow this module touches; injected so it is testable. */
export interface HitRegionWindow {
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => void
  setShape: (rects: ScreenRect[]) => void
}

/**
 * Apply a plan to the pane window and hand the plan back for logging/tests.
 *
 * On the shape strategy the `setIgnoreMouseEvents` ops are NOT run. X11's
 * ignore-mouse is a one-way door — `setIgnoreMouseEvents(true)` empties the
 * window's input region and `false` cannot restore it (hud-ipc.ts vetoes the
 * same request for the HUD, and it was reproduced live on the pane) — so Linux
 * expresses click-through with the shape alone: the shape IS the input region,
 * and a window with no regions keeps only its 1×1 corner. The plan still
 * states the intended mouse policy on every platform, which is what the unit
 * tests pin.
 */
export function applyHitRegions(
  win: HitRegionWindow,
  regions: ScreenRect[],
  platform: NodeJS.Platform = process.platform,
  zoomFactor = 1
): HitApplicationPlan {
  const plan = planHitApplication(regions, platform, zoomFactor)

  plan.ops.forEach(op => {
    if (op.op === 'setShape') {
      win.setShape(op.rects)

      return
    }

    if (plan.strategy === 'shape') {
      return
    }

    win.setIgnoreMouseEvents(op.ignore, op.forward ? { forward: true } : undefined)
  })

  return plan
}
