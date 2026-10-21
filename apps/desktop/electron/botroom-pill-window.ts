/**
 * Bot Room task pill — the small composer that opens next to a mascot when
 * you click its action dot. Another always-on-top, non-activating panel:
 * answerable over any app, dismisses itself after send.
 */
import { BrowserWindow, screen } from 'electron'

import type { BotRoomSpawnEnv } from './botroom-mascot-window'
import type { BotRoomMascot } from './botroom-mascots'

const PILL_W = 320
const PILL_H = 132
/** The mascot window is 165px tall — anchor.y is its top edge. */
const MASCOT_H = 165
const GAP = 10

export function createPillWindowSpawner(env: BotRoomSpawnEnv) {
  let pillWindow: BrowserWindow | null = null
  let pillBotId: string | null = null

  const open = (bot: BotRoomMascot, anchor: { x: number; y: number }): BrowserWindow => {
    // One pill at a time — retarget the existing one when already open.
    if (pillWindow && !pillWindow.isDestroyed()) {
      pillBotId = bot.id
      positionNear(pillWindow, anchor)
      pillWindow.webContents.send('hermes:botroom-mascot:state', bot)
      pillWindow.showInactive()

      return pillWindow
    }

    const { x, y } = placeNear(anchor)

    const win = new BrowserWindow({
      width: PILL_W,
      height: PILL_H,
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
      // Focusable on click — the pill only ever exists because the user
      // explicitly opened it at a mascot, so taking the keyboard then is
      // the intent, not a hijack. It never grabs focus on its own
      // (showInactive below); non-activating 'panel' type keeps it out of
      // the app switcher's anchor on macOS.
      focusable: true,
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
      // Best effort.
    }

    const url = env.botroomUrl({
      win: 'botroom-pill',
      bot: bot.id,
      name: encodeURIComponent(bot.displayName ?? bot.name),
      color: encodeURIComponent(bot.color ?? '')
    })

    void win.loadURL(url)
    win.once('ready-to-show', () => win.showInactive())

    win.on('closed', () => {
      if (pillWindow === win) {
        pillWindow = null
        pillBotId = null
      }
    })

    pillWindow = win
    pillBotId = bot.id

    return win
  }

  const positionNear = (win: BrowserWindow, anchor: { x: number; y: number }) => {
    const { x, y } = placeNear(anchor)

    win.setPosition(x, y)
  }

  // Centered under the mascot, fully clear of its 165px window so the two
  // surfaces never overlap (the mascot would otherwise cover the input).
  // Flips above the mascot when the screen bottom is too close.
  const placeNear = (anchor: { x: number; y: number }): { x: number; y: number } => {
    const area = screen.getPrimaryDisplay().workArea
    const x = Math.max(area.x + 8, Math.min(anchor.x - PILL_W / 2 + 75, area.x + area.width - PILL_W - 8))
    const below = anchor.y + MASCOT_H + GAP
    const above = anchor.y - PILL_H - GAP
    const y = below + PILL_H <= area.y + area.height ? below : Math.max(area.y + 8, above)

    return { x: Math.round(x), y: Math.round(y) }
  }

  return {
    open,
    updateBot(bot: BotRoomMascot) {
      if (pillWindow && !pillWindow.isDestroyed() && pillBotId === bot.id) {
        pillWindow.webContents.send('hermes:botroom-mascot:state', bot)
      }
    },
    close() {
      if (pillWindow && !pillWindow.isDestroyed()) {
        pillWindow.close()
      }
    },
    isOpenFor: (botId: string) => pillBotId === botId && !!pillWindow && !pillWindow.isDestroyed()
  }
}

export type BotRoomPill = ReturnType<typeof createPillWindowSpawner>
