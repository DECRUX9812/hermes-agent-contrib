/**
 * Electron wiring for the AnchorService (architecture §7): turns the real
 * BrowserWindows, `<webview>` guests and the OS-window enumerator into the
 * injected handles pane3d-anchor.ts watches. Kept apart from the session logic
 * so the service stays Electron-free and unit-testable.
 *
 * Consent: `enumerateWindowsFrontToBack` is asked for titles only when macOS
 * Screen Recording is already granted (`titlesAvailableFor`) — enumerating
 * without it triggers the permission prompt (AGENTS.md).
 */

import { BrowserWindow, systemPreferences, webContents } from 'electron'

import type { PaneState, ScreenRect } from '../src/app/pane3d/protocol'

import { createAnchorService } from './pane3d-anchor'
import { type AnchorGuestCandidate, titlesAvailableFor } from './pane3d-anchor-pick'
import type { AnchorHostWindow, AnchorOsWindow, AnchorService } from './pane3d-anchor-types'

/** One record per `<webview>` element; ids come from the element itself. */
const WEBVIEW_PROBE = `(() => {
  const out = []
  document.querySelectorAll('webview').forEach(el => {
    let id = null
    try { id = typeof el.getWebContentsId === 'function' ? el.getWebContentsId() : null } catch (error) { id = null }
    if (id == null) return
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && r.width > 0 && r.height > 0
    const activeElement = document.activeElement
    const active = activeElement === el || (activeElement instanceof Node && el.contains(activeElement))
    out.push({ active, rect: { height: r.height, width: r.width, x: r.x, y: r.y }, visible, webContentsId: id })
  })
  return out
})()`

export interface ElectronAnchorServiceOptions {
  getPaneWindow: () => BrowserWindow | null
  pushState: (state: PaneState) => void
  rehome?: (screenRect: ScreenRect) => void
}

/** Build the AnchorService against the real Electron windows and guests. */
export function createElectronAnchorService(options: ElectronAnchorServiceOptions): AnchorService {
  // Imported lazily so the pure helper tests never load the native enumerator.
  const enumerateOsWindow = async (): Promise<AnchorOsWindow | null> => {
    const { enumerateWindowsFrontToBack, enumerationFailed } = await import('./window-below')
    const list = await enumerateWindowsFrontToBack(process.pid, screenTitlesAvailable())

    if (enumerationFailed(list)) {
      return null
    }

    const front = list.find(item => item.pid !== process.pid)

    if (!front || !front.bounds.width || !front.bounds.height) {
      return null
    }

    return { app: front.app, bounds: front.bounds, title: front.title }
  }

  return createAnchorService({
    enumerateOsWindow,
    getPane: () => {
      const win = options.getPaneWindow()

      if (!win || win.isDestroyed()) {
        return null
      }

      return {
        getContentBounds: () => win.getContentBounds(),
        getZoomFactor: () => win.webContents.getZoomFactor(),
        isDestroyed: () => win.isDestroyed(),
        isVisible: () => win.isVisible()
      }
    },
    listGuests: () =>
      webContents
        .getAllWebContents()
        .filter(contents => contents.getType() === 'webview' && !contents.isDestroyed())
        .map(contents => {
          const hostWebContents = contents.hostWebContents

          return {
            getHost: () => {
              const win = hostWebContents ? BrowserWindow.fromWebContents(hostWebContents) : null

              return win && !win.isDestroyed() ? wrapHost(win) : null
            },
            getTitle: () => {
              try {
                return contents.getTitle()
              } catch {
                return ''
              }
            },
            isDestroyed: () => contents.isDestroyed(),
            on: (event, listener) => contents.on(event as never, listener),
            removeListener: (event, listener) => contents.removeListener(event as never, listener),
            webContentsId: contents.id
          }
        }),
    listHosts: () =>
      BrowserWindow.getAllWindows()
        .filter(win => !win.isDestroyed())
        .map(wrapHost),
    platform: process.platform,
    pushState: options.pushState,
    reducedMotion: () => {
      try {
        return Boolean(systemPreferences.getAnimationSettings().prefersReducedMotion)
      } catch {
        return false
      }
    },
    rehome: options.rehome
  })
}

/** Whether OS-window titles may be read without prompting for Screen Recording. */
function screenTitlesAvailable(): boolean {
  let access: string | null = null

  try {
    access = systemPreferences.getMediaAccessStatus?.('screen') ?? null
  } catch {
    access = null
  }

  return titlesAvailableFor(process.platform, access)
}

function wrapHost(win: Electron.BrowserWindow): AnchorHostWindow {
  return {
    getContentBounds: () => win.getContentBounds(),
    getZoomFactor: () => win.webContents.getZoomFactor(),
    id: win.id,
    isDestroyed: () => win.isDestroyed(),
    isFocused: () => win.isFocused(),
    isMinimized: () => win.isMinimized(),
    isVisible: () => win.isVisible(),
    on: (event, listener) => win.on(event as never, listener),
    probeWebviews: async () => {
      try {
        const result = await win.webContents.executeJavaScript(WEBVIEW_PROBE)

        return Array.isArray(result) ? (result as AnchorGuestCandidate[]) : []
      } catch {
        return []
      }
    },
    removeListener: (event, listener) => win.removeListener(event as never, listener)
  }
}
