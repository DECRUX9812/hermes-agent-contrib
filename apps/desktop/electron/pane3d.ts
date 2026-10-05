/**
 * Pure geometry/URL/strategy helpers for the 3D Pane window.
 *
 * The pane is a transparent, frameless, always-on-top BrowserWindow covering a
 * whole display's work area (architecture §5). Its spawn path is deliberately
 * dumb: every decision that can be stated as data — which display to cover,
 * which URL to load, which click-through strategy the platform needs — lives
 * here so it unit-tests without booting Electron.
 */

import type { ScreenRect } from '../src/app/pane3d/protocol'

export interface DisplayLike {
  workArea?: ScreenRect
}

const hasWorkArea = (display: DisplayLike | null | undefined): display is { workArea: ScreenRect } =>
  Boolean(
    display &&
    display.workArea &&
    [display.workArea.x, display.workArea.y, display.workArea.width, display.workArea.height].every(Number.isFinite)
  )

const centerOf = (rect: ScreenRect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

const containsPoint = (area: ScreenRect, point: { x: number; y: number }) =>
  point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height

const toRect = (area: ScreenRect): ScreenRect => ({
  x: Math.round(area.x),
  y: Math.round(area.y),
  width: Math.round(area.width),
  height: Math.round(area.height)
})

/**
 * The bounds the pane window should cover: the `workArea` of the display
 * containing the anchor's center (the display the user is looking at), falling
 * back to `primary` and then merely the first display with a work area. Null
 * when there is nothing to cover — the caller keeps its own default.
 */
export function resolvePaneBounds(
  displays: DisplayLike[] | null | undefined,
  anchor?: ScreenRect | null,
  primary?: DisplayLike | null
): ScreenRect | null {
  const list = (Array.isArray(displays) ? displays : []).filter(hasWorkArea)

  const containing =
    anchor && hasWorkArea({ workArea: anchor })
      ? list.find(d => containsPoint(d.workArea, centerOf(anchor)))
      : undefined

  const chosen = containing ?? (hasWorkArea(primary) ? primary : undefined) ?? list[0]

  return chosen ? toRect(chosen.workArea) : null
}

/**
 * The renderer URL for the pane. `base` is the dev-server origin or the
 * `file://` URL of the built `index.html`; `?win=pane3d` goes BEFORE the `#/`
 * route hash (architecture §2/§5) so hash routing keeps working.
 */
export function paneUrl(base: string): string {
  const stripped = String(base ?? '')
    .split('#')[0]
    .split('?')[0]

  const origin = stripped.endsWith('/') ? stripped.slice(0, -1) : stripped
  const isDocument = /\.html?$/i.test(origin) || origin.startsWith('file:')

  return isDocument ? `${origin}?win=pane3d#/` : `${origin}/?win=pane3d#/`
}

/**
 * How the pane starts (and stays) click-through before its renderer has
 * published any hit region.
 *
 * Linux/X11 has no `forward: true`, so the window is shaped down to a 1×1 rect
 * and made to ignore the mouse; the shape is what actually lets clicks reach
 * the window underneath. Everywhere else the window ignores the mouse but keeps
 * forwarding pointer moves so the renderer can re-arm interactivity.
 */
export type PaneClickThroughStrategy = 'shape' | 'forward'

export function paneClickThroughStrategy(platform: NodeJS.Platform = process.platform): PaneClickThroughStrategy {
  return platform === 'linux' ? 'shape' : 'forward'
}
