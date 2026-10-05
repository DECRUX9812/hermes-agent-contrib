// IPC surface for the 3D Pane (architecture §4). Window handles stay injected
// because main.ts owns their lifecycle; the relay below owns the queue and the
// sender rules so both are unit-testable without booting Electron.
//
// Channels:
//   hermes:pane3d:panel   pane → main   (PaneControl)
//   hermes:pane3d:state   main → pane   (PaneState)
//   hermes:pane3d:control main → host renderer (forwarded notify action/dismissed)
import { randomUUID } from 'node:crypto'

import { BrowserWindow, ipcMain } from 'electron'

import type {
  AvatarId,
  DemoScript,
  NotifyRequest,
  PageContext,
  PaneControl,
  PaneState,
  ScreenRect
} from '../src/app/pane3d/protocol'

import { paneClickThroughStrategy } from './pane3d'
import { applyHitRegions as applyPaneHitRegions } from './pane3d-hit'

export const PANE3D_CHANNELS = {
  open: 'hermes:pane3d:open',
  close: 'hermes:pane3d:close',
  isOpen: 'hermes:pane3d:is-open',
  playDemo: 'hermes:pane3d:play-demo',
  notify: 'hermes:pane3d:notify',
  summon: 'hermes:pane3d:summon',
  dismiss: 'hermes:pane3d:dismiss',
  captureContext: 'hermes:pane3d:capture-context',
  // pane → main
  panel: 'hermes:pane3d:panel',
  // main → pane
  state: 'hermes:pane3d:state',
  // main → host renderer
  control: 'hermes:pane3d:control'
} as const

export interface Pane3dRelayDeps {
  isPaneOpen: () => boolean
  openPane: () => void
  closePane: () => void
  sendToPane: (state: PaneState) => void
  sendToHost: (control: PaneControl) => void
  raiseMainWindow: () => void
  setPaneFocusable: (focusable: boolean) => void
  setPaneIgnoreMouse: (ignore: boolean) => void
  /** Apply the renderer's region list (pane3d-hit.ts); called on change only. */
  applyHitRegions?: (regions: ScreenRect[]) => void
  newId?: () => string
}

export interface Pane3dRelay {
  /** Deliver a state, opening the pane if closed and holding it until 'ready'. */
  deliver: (state: PaneState, openIfClosed: boolean) => void
  send: (state: PaneState) => void
  notify: (request: NotifyRequest) => string
  playDemo: (script?: DemoScript) => void
  summon: (avatar: AvatarId) => void
  dismiss: (avatar: AvatarId) => void
  onPaneControl: (message: PaneControl, fromPane: boolean) => void
}

/**
 * Whether a control message really came from the pane window. Only the pane owns
 * its hit regions, focus and click-through, so everything else is refused.
 */
export function isPaneSender(
  sender: unknown,
  paneWindow: { isDestroyed?: () => boolean } | null | undefined,
  resolveWindow: (sender: unknown) => { isDestroyed?: () => boolean } | null | undefined
): boolean {
  if (!sender || !paneWindow || paneWindow.isDestroyed?.()) {
    return false
  }

  return resolveWindow(sender) === paneWindow
}

/**
 * The pane-side protocol state machine. A state addressed to a closed pane opens
 * it and waits for the renderer's `ready`; notifications are queued, never
 * dropped (architecture §4). `summon`/`dismiss` are director commands that only
 * make sense while the pane is up, so they never open it.
 */
export function createPane3dRelay(deps: Pane3dRelayDeps): Pane3dRelay {
  const newId = deps.newId ?? (() => randomUUID())
  let ready = false
  let pending: PaneState[] = []

  const deliver = (state: PaneState, openIfClosed: boolean) => {
    if (!deps.isPaneOpen()) {
      if (!openIfClosed) {
        return
      }

      deps.openPane()
      // A fresh pane has not announced itself yet, whatever the last one did.
      ready = false
      pending.push(state)

      return
    }

    if (ready) {
      deps.sendToPane(state)

      return
    }

    pending.push(state)
  }

  const onPaneControl = (message: PaneControl, fromPane: boolean) => {
    if (!fromPane) {
      return
    }

    switch (message.type) {
      case 'ready': {
        ready = true
        const queued = pending
        pending = []
        queued.forEach(state => deps.sendToPane(state))

        return
      }

      case 'close':
        deps.closePane()

        return

      case 'notify.action':

      case 'notify.dismissed':
        deps.sendToHost(message)

        return

      case 'open-app':
        deps.raiseMainWindow()

        return

      case 'focus':
        deps.setPaneFocusable(message.focusable)

        return

      case 'ignore-mouse':
        deps.setPaneIgnoreMouse(message.ignore)

        return

      case 'hit-regions':
        deps.applyHitRegions?.(message.regions)

        return
    }
  }

  return {
    deliver,
    dismiss: avatar => deliver({ type: 'dismiss', avatar }, false),
    notify: request => {
      const id = newId()
      deliver({ id, request, type: 'notify' }, true)

      return id
    },
    onPaneControl,
    playDemo: (script = 'launch') => deliver({ script, type: 'demo' }, true),
    send: state => deliver(state, false),
    summon: avatar => deliver({ type: 'summon', avatar }, false)
  }
}

export interface Pane3dIpcDeps {
  getMainWindow: () => BrowserWindow | null
  getPaneWindow: () => BrowserWindow | null
  isPane3dOpen: () => boolean
  openPane3d: () => void
  closePane3d: () => void
  /** Swapped for the real PageContextService in the context-tasks milestone. */
  captureContext?: () => Promise<PageContext>
  newId?: () => string
}

export function registerPane3dIpc(deps: Pane3dIpcDeps): { relay: Pane3dRelay } {
  const withPane = (fn: (win: BrowserWindow) => void) => {
    const win = deps.getPaneWindow()

    if (win && !win.isDestroyed()) {
      fn(win)
    }
  }

  const relay = createPane3dRelay({
    applyHitRegions: regions => {
      // Regions arrive in pane CSS px; the window's zoom factor (Chromium UI
      // zoom is per-origin, so the pane shares the session's factor) converts
      // them to the DIP space `setShape` wants.
      withPane(win => applyPaneHitRegions(win, regions, process.platform, win.webContents.getZoomFactor()))
    },
    closePane: deps.closePane3d,
    isPaneOpen: deps.isPane3dOpen,
    newId: deps.newId,
    openPane: deps.openPane3d,
    raiseMainWindow: () => {
      const win = deps.getMainWindow()

      if (!win || win.isDestroyed()) {
        return
      }

      if (win.isMinimized()) {
        win.restore()
      }

      win.show()
      win.focus()
    },
    sendToHost: control => {
      const win = deps.getMainWindow()

      if (win && !win.isDestroyed()) {
        win.webContents.send(PANE3D_CHANNELS.control, control)
      }
    },
    sendToPane: state => {
      const win = deps.getPaneWindow()

      if (win && !win.isDestroyed()) {
        win.webContents.send(PANE3D_CHANNELS.state, state)
      }
    },
    setPaneFocusable: focusable => {
      withPane(win => {
        win.setFocusable(focusable)

        if (focusable) {
          win.focus()
        }
      })
    },
    setPaneIgnoreMouse: ignore => {
      // The forward strategy is the only one that toggles interactivity at
      // runtime; Linux re-shapes instead (see pane3d-hit.ts).
      if (paneClickThroughStrategy() !== 'forward') {
        return
      }

      withPane(win => {
        win.setIgnoreMouseEvents(Boolean(ignore), { forward: true })
      })
    }
  })

  ipcMain.handle(PANE3D_CHANNELS.open, async () => {
    deps.openPane3d()

    return { ok: true }
  })
  ipcMain.handle(PANE3D_CHANNELS.close, async () => {
    deps.closePane3d()

    return { ok: true }
  })
  ipcMain.handle(PANE3D_CHANNELS.isOpen, async () => deps.isPane3dOpen())
  ipcMain.handle(PANE3D_CHANNELS.playDemo, async (_event, script: DemoScript | undefined) => {
    relay.playDemo(script)

    return { ok: true }
  })
  ipcMain.handle(PANE3D_CHANNELS.notify, async (_event, request: NotifyRequest) => ({
    id: relay.notify(request),
    ok: true
  }))
  ipcMain.handle(PANE3D_CHANNELS.summon, async (_event, avatar: AvatarId) => {
    relay.summon(avatar)

    return { ok: true }
  })
  ipcMain.handle(PANE3D_CHANNELS.dismiss, async (_event, avatar: AvatarId) => {
    relay.dismiss(avatar)

    return { ok: true }
  })
  ipcMain.handle(PANE3D_CHANNELS.captureContext, async () => {
    if (deps.captureContext) {
      return deps.captureContext()
    }

    return { capturedAt: Date.now(), source: 'none' }
  })

  ipcMain.on(PANE3D_CHANNELS.panel, (event, message: PaneControl) => {
    const fromPane = isPaneSender(event.sender, deps.getPaneWindow(), BrowserWindow.fromWebContents)
    relay.onPaneControl(message, fromPane)
  })

  return { relay }
}
