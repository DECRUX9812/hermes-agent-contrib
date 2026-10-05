// The 3D Pane BrowserWindow: spawn, open/close, and the click-through it must
// start BEFORE its first paint (architecture §5/§6).
//
// Main.ts owns the Electron-local wiring helpers (URL loading, reveal, renderer
// lifecycle, console capture), so they arrive injected and this module stays a
// plain controller — which also makes the reuse + ordering rules unit-testable
// with a fake window factory.
import { BrowserWindow, screen } from 'electron'

import type { ScreenRect } from '../src/app/pane3d/protocol'

import { type DisplayLike, paneClickThroughStrategy, paneUrl, resolvePaneBounds } from './pane3d'

export interface Pane3dWindowDeps {
  isMac: boolean
  preloadPath: string
  /** Dev-server origin, or the `file://` URL of the built renderer index. */
  rendererBase: () => string
  loadWindowUrl: (win: BrowserWindow, url: string, label: string) => void
  wireWindow: (win: BrowserWindow) => void
  wireReveal: (win: BrowserWindow) => void
  installLifecycle: (win: BrowserWindow) => void
  attachConsole: (win: BrowserWindow) => void
  onClosed: () => void
  getAnchor?: () => ScreenRect | null
  getDisplays?: () => DisplayLike[]
  getPrimaryDisplay?: () => DisplayLike | null
  createWindow?: (options: Record<string, unknown>) => BrowserWindow
  /** Platform as data so tests never fake the host OS. */
  platform?: NodeJS.Platform
}

export interface Pane3dController {
  getWindow: () => BrowserWindow | null
  isOpen: () => boolean
  open: () => BrowserWindow
  close: () => void
}

const FALLBACK_BOUNDS: ScreenRect = { height: 720, width: 1280, x: 0, y: 0 }

export function createPane3dController(deps: Pane3dWindowDeps): Pane3dController {
  const platform = deps.platform ?? process.platform
  const getDisplays = deps.getDisplays ?? (() => screen.getAllDisplays())
  const getPrimaryDisplay = deps.getPrimaryDisplay ?? (() => screen.getPrimaryDisplay())
  const createWindow = deps.createWindow ?? ((options: Record<string, unknown>) => new BrowserWindow(options as never))

  let paneWindow: BrowserWindow | null = null
  // Electron's close() is async; a window mid-close must never be reused or
  // left on screen while a replacement spawns (the pet-overlay lesson).
  let closing = false

  const alive = (win: BrowserWindow | null): win is BrowserWindow => Boolean(win && !win.isDestroyed())

  const spawn = (): BrowserWindow => {
    const bounds = resolvePaneBounds(getDisplays(), deps.getAnchor?.() ?? null, getPrimaryDisplay()) ?? FALLBACK_BOUNDS

    const win = createWindow({
      ...bounds,
      alwaysOnTop: true,
      // Fully transparent — the renderer paints only avatars/cards.
      backgroundColor: '#00000000',
      focusable: false,
      frame: false,
      fullscreenable: false,
      hasShadow: false,
      hiddenInMissionControl: deps.isMac,
      maximizable: false,
      minimizable: false,
      movable: false,
      resizable: false,
      show: false,
      skipTaskbar: !deps.isMac,
      transparent: true,
      type: deps.isMac ? 'panel' : undefined,
      webPreferences: {
        // Keep avatars animating while the app behind is minimized/blurred.
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: deps.preloadPath,
        sandbox: true
      }
    })

    win.setAlwaysOnTop(true, deps.isMac ? 'floating' : 'screen-saver')
    win.setHiddenInMissionControl?.(true)

    // Click-through BEFORE anything can show the window: if this page is slow,
    // blank or dead, a mouse-enabled transparent full-screen layer would eat
    // every click on the desktop. On Linux/X11 the SHAPE is the input region —
    // a 1x1 window is fully click-through — and `setIgnoreMouseEvents` is
    // deliberately NOT called: there it empties the input region for good
    // (`setIgnoreMouseEvents(false)` cannot restore it, the same one-way door
    // the HUD vetoes in hud-ipc.ts), so the pane could never become
    // interactive again. Elsewhere the window ignores the mouse but keeps
    // forwarding moves so the renderer can re-arm.
    if (paneClickThroughStrategy(platform) === 'shape') {
      win.setShape([{ height: 1, width: 1, x: 0, y: 0 }])
    } else {
      win.setIgnoreMouseEvents(true, { forward: true })
    }

    try {
      win.setVisibleOnAllWorkspaces(
        true,
        deps.isMac ? { skipTransformProcessType: true, visibleOnFullScreen: true } : undefined
      )
    } catch {
      // Not supported everywhere — best effort.
    }

    deps.wireWindow(win)
    deps.wireReveal(win)
    deps.installLifecycle(win)

    win.on('closed', () => {
      // A stale window replaced by open() must not touch its replacement.
      if (paneWindow !== win) {
        return
      }

      paneWindow = null
      closing = false
      deps.onClosed()
    })

    deps.attachConsole(win)
    deps.loadWindowUrl(win, paneUrl(deps.rendererBase()), 'Pane 3D')

    return win
  }

  const open = (): BrowserWindow => {
    if (alive(paneWindow) && !closing) {
      paneWindow.showInactive()

      return paneWindow
    }

    // A previous close was requested but never finished — force the stale
    // window down before spawning a replacement so two panes can never coexist.
    if (alive(paneWindow)) {
      const stale = paneWindow

      paneWindow = null
      stale.destroy()
    }

    closing = false
    paneWindow = spawn()

    return paneWindow
  }

  const close = (): void => {
    if (alive(paneWindow)) {
      closing = true
      paneWindow.close()
    }
  }

  return {
    close,
    getWindow: () => (alive(paneWindow) ? paneWindow : null),
    isOpen: () => alive(paneWindow) && !closing,
    open
  }
}
