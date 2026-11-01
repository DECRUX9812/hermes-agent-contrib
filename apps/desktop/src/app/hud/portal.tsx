/**
 * The browser HUD, rendered into its Document-PiP window.
 *
 * Electron spawns a second renderer for HUD mode; the browser cannot (a
 * Document-PiP window's document may never navigate — `lib/browser-hud.ts`).
 * So the SAME renderer renders the SAME `HudShell` twice-removed: once as the
 * app shell it already was, and once through a portal into the PiP window's
 * host element. `$hudPortalHost` is the meeting point.
 *
 * Two things make the portal honest rather than a copy:
 *  - React 19 attaches its event listeners to the PORTAL container as well as
 *    the root container (HostPortal mount, `listenToAllSupportedEvents`), so
 *    clicks and keys inside the other document are dispatched normally. No
 *    manual re-dispatch, no `onClickCapture` shims.
 *  - The providers wrap the portal's subtree, not the app's, so `useHudSurface`
 *    and `useHudView` are true for HUD components only. The app shell keeps
 *    behaving like the app shell in the same renderer.
 *
 * Mounted by `ContribController` alongside the normal shell. Renders nothing
 * outside a browser-hosted Desktop.
 */

import { useStore } from '@nanostores/react'
import { useMemo } from 'react'
import { createPortal } from 'react-dom'

import { $hudPortalHost } from '@/store/hud'

import { HudShell } from './hud-shell'
import { HudSurfaceProvider, HudViewProvider } from './view'

export function HudPortal() {
  const host = useStore($hudPortalHost)

  // Identity matters: a fresh view object on every render would re-render the
  // whole HUD subtree on unrelated store traffic.
  const view = useMemo(() => (host ? { document: host.document, window: host.window } : null), [host])

  if (!host || !view) {
    return null
  }

  return createPortal(
    <HudViewProvider view={view}>
      <HudSurfaceProvider>
        <HudShell />
      </HudSurfaceProvider>
    </HudViewProvider>,
    host.container
  )
}
