import fs from 'node:fs'
import path from 'node:path'

import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron'

import { buildTrayMenuTemplate, sanitizeTrayStatusPush, trayStatusBadge, type TrayStatusPush } from './tray-status'

export interface MinimizeToTrayStatus {
  enabled: boolean
  available: boolean
  /** Menu-bar status feed (#38): the tray icon exists for the status menu even
   *  when hide-on-minimize/close is off. */
  statusEnabled: boolean
}

interface Options {
  preferencesPath: string
  getIconPath: () => string | undefined
  restoreMainWindow: () => void
  isQuittingForHandoff: () => boolean
  log: (message: string) => void
  /** Tray menu actions (menu-bar status): all user-driven, none auto-acts. */
  focusSession: (id: string) => void
  newSession: () => void
  /** Quick Entry quick action — absent from the menu when this returns false. */
  quickEntryEnabled: () => boolean
  summonQuickEntry: () => void
}

/** Device-local native preference; renderer windows only cache its status. */
export function createMinimizeToTray(options: Options) {
  let enabled = false
  // #38: the tray doubles as a status surface — a separate opt-in from
  // hide-to-tray so a user can run a menu-bar Hermes without window-hiding
  // behavior, or vice versa.
  let statusEnabled = false
  let quitting = false
  let tray: Tray | null = null
  // Latest status push from the primary renderer; null until the first one.
  let statusPush: TrayStatusPush | null = null
  let stopWatchingHost: (() => void) | undefined
  let dockHidden = false
  let hostGeneration = 0
  let pending = Promise.resolve()
  const windows = new Set<BrowserWindow>()
  const hidden = new Set<BrowserWindow>()

  const status = (): MinimizeToTrayStatus => ({
    enabled,
    available: !!tray && !tray.isDestroyed(),
    statusEnabled
  })

  // The icon exists when EITHER feature needs it: hide-to-tray (`enabled`) or
  // the menu-bar status surface (`statusEnabled`).
  const trayWanted = () => enabled || statusEnabled

  const syncTrayFace = () => {
    if (!tray || tray.isDestroyed()) {
      return
    }

    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenuTemplate(statusPush, {
          focusSession: id => options.focusSession(id),
          newSession: () => options.newSession(),
          quit: () => app.quit(),
          show: () => restore(),
          summonQuickEntry: options.quickEntryEnabled() ? () => options.summonQuickEntry() : null
        })
      )
    )

    // The badge is the whole point on macOS: a compact "runs / needs-you" text
    // next to the icon. Other platforms expose no tray title — their status
    // lives in the menu's first line and the tooltip.
    if (process.platform === 'darwin') {
      tray.setTitle(trayStatusBadge(statusPush))
    }

    tray.setToolTip(statusPush?.strings.statusLine ?? 'Hermes')
  }

  const broadcast = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('hermes:minimize-to-tray:changed', status())
      }
    }
  }

  const showDock = () => {
    if (dockHidden) {
      dockHidden = false
      void app.dock?.show()
    }
  }

  const syncDock = () => {
    if (process.platform !== 'darwin') {
      return
    }

    // A hidden primary must not remove a visible peer from Cmd-Tab/the Dock.
    const foreground = [...windows].some(win => !win.isDestroyed() && win.isVisible() && !win.isMinimized())

    if (status().available && hidden.size > 0 && !foreground && !quitting) {
      dockHidden = true
      app.dock?.hide()
    } else {
      showDock()
    }
  }

  const released = (win: BrowserWindow) => {
    if (!hidden.delete(win)) {
      return
    }

    if (process.platform === 'win32') {
      win.setSkipTaskbar(false)
    }

    showDock()
  }

  const restoreHidden = () => {
    showDock()

    for (const win of [...hidden]) {
      if (win.isDestroyed()) {
        hidden.delete(win)

        continue
      }

      released(win)

      if (win.isMinimized()) {
        win.restore()
      }

      if (process.platform === 'win32') {
        // showInactive() never activates the window. A restored-but-inactive
        // window can come back painted yet dead to input (AppHangB1, #119252),
        // so genuinely activate it like focusWindow in main.ts does.
        win.show()
        win.focus()
      } else {
        win.showInactive()
      }
    }
  }

  const restore = () => {
    restoreHidden()
    options.restoreMainWindow()
  }

  const destroyTray = () => {
    stopWatchingHost?.()
    stopWatchingHost = undefined
    tray?.destroy()
    tray = null
  }

  const hostLost = () => {
    // Losing the shell/tray must never strand an invisible app.
    hostGeneration += 1
    restoreHidden()
    destroyTray()
    broadcast()
  }

  const apply = async () => {
    if (!trayWanted()) {
      restoreHidden()
      destroyTray()
    } else if (!status().available && !quitting) {
      try {
        if (process.platform === 'linux') {
          const { watchLinuxTrayHost } = await import('./tray-host')
          const generation = hostGeneration
          stopWatchingHost = await watchLinuxTrayHost(hostLost)

          if (generation !== hostGeneration) {
            throw new Error('System tray host disappeared')
          }
        }

        if (quitting) {
          destroyTray()

          return status()
        }

        const iconPath = options.getIconPath()
        const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()

        if (icon.isEmpty()) {
          throw new Error('No usable tray icon')
        }

        tray = new Tray(
          icon.resize({
            width: process.platform === 'darwin' ? 18 : 24,
            height: process.platform === 'darwin' ? 18 : 24
          })
        )
        tray.setToolTip('Hermes')
        syncTrayFace()

        // macOS single-click opens the native menu, not the window behind it.
        if (process.platform !== 'darwin') {
          tray.on('click', restore)
        }

        tray.on('double-click', restore)
      } catch (error) {
        restoreHidden()
        destroyTray()
        options.log(`[tray] unavailable; ordinary window behavior retained: ${error}`)
      }
    }

    broadcast()

    return status()
  }

  function registerWindow(win: BrowserWindow, { closeToTray = false } = {}) {
    windows.add(win)

    const hide = () => {
      if (win.isDestroyed()) {
        return false
      }

      if (!enabled || !status().available || quitting || options.isQuittingForHandoff()) {
        return false
      }

      hidden.add(win)

      if (process.platform === 'win32') {
        win.setSkipTaskbar(true)
      }

      win.hide()
      syncDock()

      return true
    }

    // Hide past the native minimize dispatch, not inside it: hiding
    // synchronously here re-enters window-state changes mid-flight and on
    // Windows wedges isMinimized(), so the later restore takes the
    // restore-on-hidden path back to a painted-but-dead window (#119252).
    // Guards are re-evaluated at fire time inside hide(); the close handler
    // below keeps its synchronous hide so preventDefault still works.
    win.on('minimize', () => {
      setImmediate(() => {
        // The user may have restored the window in the meantime (taskbar or
        // shortcut); a stale hide must not snatch it back.
        if (!win.isDestroyed() && !win.isMinimized() && win.isVisible()) {
          return
        }

        hide()
      })
    })

    if (closeToTray) {
      win.on('close', event => {
        if (hide()) {
          event.preventDefault()
        }
      })
    }

    // Windows session ending need not emit app.before-quit. Never hold it open.
    win.on('query-session-end', () => {
      quitting = true
    })
    win.on('show', () => {
      released(win)
      syncDock()
    })
    win.on('restore', () => {
      released(win)
      syncDock()
    })
    win.on('closed', () => {
      windows.delete(win)
      hidden.delete(win)
      syncDock()
    })
  }

  async function start() {
    try {
      const prefs = JSON.parse(fs.readFileSync(options.preferencesPath, 'utf8'))
      enabled = prefs.enabled === true
      statusEnabled = prefs.status === true
    } catch {
      // Missing or malformed preference preserves ordinary minimize/close.
    }

    const operation = apply()
    pending = operation.then(
      () => undefined,
      () => undefined
    )

    return operation
  }

  const writePrefs = () => {
    fs.mkdirSync(path.dirname(options.preferencesPath), { recursive: true })
    fs.writeFileSync(
      `${options.preferencesPath}.tmp`,
      JSON.stringify({ enabled, status: statusEnabled }),
      'utf8'
    )
    fs.renameSync(`${options.preferencesPath}.tmp`, options.preferencesPath)
  }

  function setEnabled(on: boolean): Promise<MinimizeToTrayStatus> {
    // Serialize writes from peer windows so an older native apply cannot win.
    const operation = pending.then(async () => {
      enabled = on === true
      writePrefs()

      return apply()
    })

    pending = operation.then(
      () => undefined,
      () => undefined
    )

    return operation
  }

  function setStatusEnabled(on: boolean): Promise<MinimizeToTrayStatus> {
    const operation = pending.then(async () => {
      statusEnabled = on === true
      writePrefs()

      return apply()
    })

    pending = operation.then(
      () => undefined,
      () => undefined
    )

    return operation
  }

  ipcMain.handle('hermes:minimize-to-tray:get', status)
  ipcMain.handle('hermes:minimize-to-tray:set', (_event, on) => setEnabled(on === true))
  ipcMain.handle('hermes:menu-bar-status:get', status)
  ipcMain.handle('hermes:menu-bar-status:set', (_event, on) => setStatusEnabled(on === true))

  // Primary renderer → tray: live session status for the menu + badge. A
  // malformed push is dropped whole so a renderer bug can't wedge the menu.
  ipcMain.on('hermes:menu-bar-status:push', (_event, payload) => {
    const push = sanitizeTrayStatusPush(payload)

    if (!push) {
      return
    }

    statusPush = push
    syncTrayFace()
  })
  app.on('will-quit', destroyTray)

  return {
    start,
    status,
    setEnabled,
    setStatusEnabled,
    registerWindow,
    restore,
    // Call only AFTER the active-work guard accepts the quit. Cancelling the
    // prompt must leave hiding and its recovery affordance intact.
    beginQuit: () => {
      quitting = true
    }
  }
}
