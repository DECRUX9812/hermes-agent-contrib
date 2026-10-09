// Pop-out panel windows: detach any panel (chat, activity, etc.) into its own
// floating BrowserWindow that can live on a different virtual desktop.
// Follows the pane3d-window.ts controller pattern.
import { BrowserWindow } from 'electron'

export type PopoutPanel = 'chat' | 'activity' | 'sessions'

export interface PopoutWindowDeps {
  isMac: boolean
  preloadPath: string
  /** Dev-server origin, or the `file://` URL of the built renderer index. */
  rendererBase: () => string
  loadWindowUrl: (win: BrowserWindow, url: string, label: string) => void
  wireWindow: (win: BrowserWindow) => void
  installLifecycle: (win: BrowserWindow) => void
  onClosed: (panel: PopoutPanel) => void
  createWindow?: (options: Record<string, unknown>) => BrowserWindow
  platform?: NodeJS.Platform
}

export interface PopoutController {
  getWindow: (panel: PopoutPanel) => BrowserWindow | null
  isOpen: (panel: PopoutPanel) => boolean
  open: (panel: PopoutPanel) => BrowserWindow
  close: (panel: PopoutPanel) => void
  closeAll: () => void
}

const PANEL_TITLES: Record<PopoutPanel, string> = {
  activity: 'Hermes Activity',
  chat: 'Hermes Chat',
  sessions: 'Hermes Sessions'
}

const PANEL_SIZE: Record<PopoutPanel, { height: number; width: number }> = {
  activity: { height: 700, width: 420 },
  chat: { height: 800, width: 480 },
  sessions: { height: 700, width: 420 }
}

function popoutUrl(base: string, panel: PopoutPanel): string {
  const stripped = String(base ?? '').split('#')[0].split('?')[0]
  const origin = stripped.endsWith('/') ? stripped.slice(0, -1) : stripped
  const isDocument = /\.html?$/i.test(origin) || origin.startsWith('file:')
  const sep = isDocument ? '?' : '/?'
  return `${origin}${sep}win=popout&panel=${panel}#/`
}

export function createPopoutController(deps: PopoutWindowDeps): PopoutController {
  const createWindow =
    deps.createWindow ?? ((options: Record<string, unknown>) => new BrowserWindow(options as never))

  const windows = new Map<PopoutPanel, BrowserWindow>()

  const alive = (win: BrowserWindow | null): win is BrowserWindow => Boolean(win && !win.isDestroyed())

  const spawn = (panel: PopoutPanel): BrowserWindow => {
    const size = PANEL_SIZE[panel]
    const win = createWindow({
      ...size,
      alwaysOnTop: false,
      autoHideMenuBar: true,
      backgroundColor: '#1a1a1a',
      frame: true,
      fullscreenable: true,
      hasShadow: true,
      maximizable: true,
      minimizable: true,
      movable: true,
      resizable: true,
      show: false,
      title: PANEL_TITLES[panel],
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: deps.preloadPath,
        sandbox: true
      }
    })

    deps.wireWindow(win)
    deps.installLifecycle(win)
    deps.loadWindowUrl(win, popoutUrl(deps.rendererBase(), panel), `popout-${panel}`)

    win.on('closed', () => {
      windows.delete(panel)
      deps.onClosed(panel)
    })

    win.once('ready-to-show', () => win.show())

    windows.set(panel, win)
    return win
  }

  return {
    close: panel => {
      const win = windows.get(panel)
      if (alive(win)) win.close()
    },
    closeAll: () => {
      for (const [, win] of windows) {
        if (alive(win)) win.close()
      }
      windows.clear()
    },
    getWindow: panel => windows.get(panel) ?? null,
    isOpen: panel => alive(windows.get(panel) ?? null),
    open: panel => {
      const existing = windows.get(panel)
      if (alive(existing)) {
        existing.focus()
        return existing
      }
      return spawn(panel)
    }
  }
}
