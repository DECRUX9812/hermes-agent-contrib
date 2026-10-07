/**
 * Injected handles for the AnchorService (architecture §7). They describe the
 * real Electron windows/guests and the OS-window enumerator as narrow interfaces
 * so the service session (pane3d-anchor.ts) unit-tests without Electron. The
 * Electron adapter that builds them lives in pane3d-anchor-electron.ts.
 */

import type { PaneAnchor, PaneState, ScreenRect } from '../src/app/pane3d/protocol'

import type { AnchorGuestCandidate } from './pane3d-anchor-pick'

export interface AnchorPaneWindow {
  getContentBounds: () => ScreenRect
  getZoomFactor: () => number
  isDestroyed: () => boolean
  isVisible: () => boolean
}

export interface AnchorHostWindow {
  id: number
  isFocused: () => boolean
  isDestroyed: () => boolean
  isVisible: () => boolean
  isMinimized: () => boolean
  getContentBounds: () => ScreenRect
  getZoomFactor: () => number
  /** Ask the host renderer for one record per `<webview>` element. */
  probeWebviews: () => Promise<AnchorGuestCandidate[]>
  on: (event: string, listener: () => void) => void
  removeListener: (event: string, listener: () => void) => void
}

export interface AnchorGuestHandle {
  webContentsId: number
  isDestroyed: () => boolean
  getTitle: () => string
  getHost: () => AnchorHostWindow | null
  on: (event: string, listener: () => void) => void
  removeListener: (event: string, listener: () => void) => void
}

export interface AnchorOsWindow {
  title: string
  app?: string
  /** Screen DIP. */
  bounds: ScreenRect
}

export interface AnchorServiceDeps {
  getPane: () => AnchorPaneWindow | null
  pushState: (state: PaneState) => void
  /** Re-home the pane to the display containing this screen-DIP rect. */
  rehome?: (screenRect: ScreenRect) => void
  listHosts: () => AnchorHostWindow[]
  listGuests: () => AnchorGuestHandle[]
  enumerateOsWindow: () => Promise<AnchorOsWindow | null>
  platform?: NodeJS.Platform
  reducedMotion?: () => boolean
  now?: () => number
  pollMs?: number
  probeTimeoutMs?: number
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
}

export interface AnchorService {
  /** Begin watching and push `init`. Re-entrant: a second call refreshes init. */
  start: () => Promise<void>
  /** Clear the poll and every listener. Idempotent. */
  stop: () => void
  /** Compute the current anchor without pushing it. */
  pick: () => Promise<PaneAnchor>
  /** The last anchor's screen-DIP rect (for the spawn-time display choice). */
  currentScreenRect: () => ScreenRect | null
  isRunning: () => boolean
}
