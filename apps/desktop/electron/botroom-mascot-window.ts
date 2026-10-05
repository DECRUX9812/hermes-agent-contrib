/**
 * BrowserWindow factory for one Bot Room mascot. Kept separate from
 * botroom-mascots.ts (the sync/IPC logic) so the window-option contract sits
 * in one place next to the other overlays'.
 */
import { BrowserWindow } from 'electron'

import type { BotRoomMascot } from './botroom-mascots'

export interface BotRoomSpawnEnv {
  preloadPath: string
  botroomUrl: (extra: Record<string, string>) => string
  isMac: boolean
  rememberLog?: (message: string) => void
}

export function createMascotWindowSpawner(env: BotRoomSpawnEnv) {
  return (bot: BotRoomMascot, x: number, y: number): BrowserWindow => {
    const win = new BrowserWindow({
      width: 150,
      height: 165,
      x: Math.round(x),
      y: Math.round(y),
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: !env.isMac,
      hasShadow: false,
      alwaysOnTop: true,
      type: env.isMac ? 'panel' : undefined,
      hiddenInMissionControl: env.isMac,
      // Non-activating palette semantics: the mascot answers clicks/drags
      // without stealing the focused app — that's the whole point of putting
      // bots on the desktop.
      focusable: false,
      // Deliver the first click straight to the window even while another
      // app is frontmost — no click-to-activate swallowed tap.
      acceptFirstMouse: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: env.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: true,
        backgroundThrottling: false
      }
    })

    win.setAlwaysOnTop(true, env.isMac ? 'floating' : 'screen-saver')
    win.setHiddenInMissionControl?.(true)

    try {
      win.setVisibleOnAllWorkspaces(
        true,
        env.isMac ? { visibleOnFullScreen: true, skipTransformProcessType: true } : undefined
      )
    } catch {
      // Best effort — unsupported on some platforms.
    }

    const url = env.botroomUrl({
      win: 'botroom-mascot',
      bot: bot.id,
      name: encodeURIComponent(bot.displayName ?? bot.name),
      color: encodeURIComponent(bot.color ?? '')
    })

    void win.loadURL(url)
    win.once('ready-to-show', () => win.showInactive())

    return win
  }
}
