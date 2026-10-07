/**
 * Pure anchor selection + conversion for the 3D Pane (architecture §7).
 *
 * `pickHermesGuest` chooses which in-app-browser guest the avatars perch on and
 * `toPaneLocal` converts a screen-DIP rect into the pane renderer's CSS-px space
 * (Chromium UI zoom is per-origin, so the pane renders at the session factor).
 * Everything here is plain data so the rules unit-test without booting Electron;
 * the session orchestration lives in pane3d-anchor.ts and the Electron wiring in
 * pane3d-anchor-electron.ts.
 */

import type { PaneAnchor, ScreenRect } from '../src/app/pane3d/protocol'

export interface AnchorGuestCandidate {
  webContentsId: number
  /** `<webview>` bounding rect in host content-area CSS px, or null if unlaid. */
  rect: ScreenRect | null
  visible: boolean
  /** The host document's activeElement is (inside) this webview. */
  active: boolean
  title: string
}

export interface AnchorHostCandidate {
  windowId: number
  focused: boolean
  /** `performance.now()`-style stamp of the last focus, 0 if never. */
  lastFocusedAt: number
  /** Host content bounds, screen DIP. */
  bounds: ScreenRect
  zoom: number
  /** Host is on screen. Read AFTER the async DOM probe — HUD mode can hide it. */
  visible: boolean
  minimized: boolean
  guests: AnchorGuestCandidate[]
}

/** One OS window from the front-to-back enumerator (window-below.ts). */
export interface OsWindowCandidate {
  app: string
  id?: number
  pid: number
  title: string
  bounds: ScreenRect
}

const usableGuest = (candidate: AnchorGuestCandidate): boolean =>
  candidate.visible && candidate.rect != null && candidate.rect.width > 0 && candidate.rect.height > 0

/**
 * Best browser guest across all Hermes host windows. A hidden (HUD mode) or
 * minimized host keeps its webview alive off screen with a non-zero DOM rect, so
 * such a host is never eligible even when it was the most recently focused one.
 * Prefers the focused host, then the most recently focused; within that host
 * prefers the guest holding the active element, then the first visible one.
 */
export function pickHermesGuest(
  hosts: AnchorHostCandidate[]
): { guest: AnchorGuestCandidate; host: AnchorHostCandidate } | null {
  const eligible = hosts.filter(host => host.visible && !host.minimized && host.guests.some(usableGuest))

  if (eligible.length === 0) {
    return null
  }

  const focused = eligible.find(host => host.focused)
  const host = focused ?? [...eligible].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0]
  const guests = host.guests.filter(usableGuest)
  const guest = guests.find(candidate => candidate.active) ?? guests[0]

  return { guest, host }
}

/**
 * Frontmost OS window that is NOT ours — the `os-window` fallback (§7.2).
 *
 * `windows` arrives in front-to-back z-order. Every window owned by a Hermes
 * PID is skipped: the browser (main) pid plus every child pid the app reports
 * (renderer/GPU/utility), because an own window must never become the anchor —
 * a child can own one too (e.g. a devtools window). Zero-area rows (minimized
 * windows report those on some platforms) are unusable as an anchor. `null`
 * means nothing foreign is on screen and the caller floats on the desktop.
 */
export function pickFrontmostForeignWindow(
  windows: readonly OsWindowCandidate[],
  ownPids: readonly number[]
): OsWindowCandidate | null {
  const own = new Set(ownPids)

  return windows.find(win => !own.has(win.pid) && win.bounds.width > 0 && win.bounds.height > 0) ?? null
}

/**
 * Screen DIP → pane-window-local CSS px. The pane content origin is subtracted
 * in DIP, then the zoom converts DIP to CSS (the renderer's space). A broken
 * zoom is treated as 1 rather than collapsing every rect to nothing.
 */
export function toPaneLocal(rect: ScreenRect, paneOrigin: { x: number; y: number }, zoomFactor = 1): ScreenRect {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1

  return {
    height: rect.height / zoom,
    width: rect.width / zoom,
    x: (rect.x - paneOrigin.x) / zoom,
    y: (rect.y - paneOrigin.y) / zoom
  }
}

/** Change detection: same kind/label and every rect edge within `tolerance` px. */
export function anchorEqual(a: PaneAnchor, b: PaneAnchor, tolerance = 1): boolean {
  return (
    a.kind === b.kind &&
    a.label === b.label &&
    Math.abs(a.rect.x - b.rect.x) <= tolerance &&
    Math.abs(a.rect.y - b.rect.y) <= tolerance &&
    Math.abs(a.rect.width - b.rect.width) <= tolerance &&
    Math.abs(a.rect.height - b.rect.height) <= tolerance
  )
}

export const DESKTOP_ANCHOR: PaneAnchor = {
  kind: 'desktop',
  label: '',
  rect: { height: 0, width: 0, x: 0, y: 0 }
}

/** Budget for the host `<webview>` DOM probe before it is treated as empty. */
export const PROBE_TIMEOUT_MS = 1000

/**
 * Resolve with `fallback` if `promise` has not settled within `ms`, or if it
 * rejects. A host renderer that is hung or gone must never leave the service
 * stuck in "picking" with no anchor (and no rejection to catch).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms)

    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

/**
 * macOS gates OS-window titles behind Screen Recording consent; enumerating
 * without the grant triggers the permission prompt (AGENTS.md "macOS Screen
 * Recording consent"). Platform is data so tests never fake the host OS.
 */
export function titlesAvailableFor(platform: NodeJS.Platform, screenAccess: string | null | undefined): boolean {
  return platform !== 'darwin' || screenAccess === 'granted'
}
