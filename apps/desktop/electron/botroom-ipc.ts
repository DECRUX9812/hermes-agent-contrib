// IPC surface for the Bot Room overlay — the full-screen transparent layer
// where bot mascots live on the desktop — plus its per-bot mascot/pill
// windows. Extracted shape mirrors pet-overlay-ipc: window handles stay
// injected because main.ts owns their lifecycle, and state/control relay
// between the renderers lives here.
import { BrowserWindow, ipcMain } from 'electron'

import { botroomClickThrough } from './botroom'
import type { BotRoomMascots } from './botroom-mascots'
import type { BotRoomPill } from './botroom-pill-window'

export interface BotRoomIpcDeps {
  getMainWindow: () => BrowserWindow | null
  getBotRoomWindow: () => BrowserWindow | null
  openBotRoom: () => void
  closeBotRoom: () => void
  mascots: BotRoomMascots
  pill: BotRoomPill
  /** The roster row each mascot/pill needs — main keeps the last pushed one. */
  getBot: (botId: string) => { id: string; name: string; displayName?: string; status?: string; statusLine?: string; color?: string } | undefined
}

export function registerBotRoomIpc({
  getMainWindow,
  getBotRoomWindow,
  openBotRoom,
  closeBotRoom,
  mascots,
  pill,
  getBot
}: BotRoomIpcDeps) {
  ipcMain.handle('hermes:botroom:open', async () => {
    openBotRoom()

    return { ok: true }
  })

  ipcMain.handle('hermes:botroom:close', async () => {
    closeBotRoom()

    return { ok: true }
  })

  // Click-through: the overlay is a full-screen transparent rectangle; only
  // interactive pixels (mascot hit zones, panels, menus, the tray) should take
  // the pointer. The renderer hit-tests on forwarded mousemoves and toggles
  // this — everything else falls through to the desktop below. Only the
  // overlay itself may ignore; mascot/pill windows are small and always
  // interactive, so the sender's window is resolved rather than assumed.
  ipcMain.on('hermes:botroom:ignore-mouse', (event, ignore) => {
    const target = BrowserWindow.fromWebContents(event.sender)

    if (!target || target !== getBotRoomWindow()) {
      return
    }

    if (Boolean(ignore) && !botroomClickThrough()) {
      return
    }

    if (!target.isDestroyed()) {
      target.setIgnoreMouseEvents(Boolean(ignore), { forward: true })
    }
  })

  // Non-activating by default so it never steals the app's alt-tab anchor —
  // but panels/composers need the keyboard, so a renderer flips this while
  // any text field holds focus. Applies to whichever Bot Room window sent it
  // (overlay or task pill).
  ipcMain.on('hermes:botroom:set-focusable', (event, focusable) => {
    const target = BrowserWindow.fromWebContents(event.sender)

    if (!target || target.isDestroyed()) {
      return
    }

    target.setFocusable(Boolean(focusable))

    if (focusable) {
      target.focus()
    }
  })

  // Main renderer → windows: bot roster/status/rooms. The overlay window gets
  // the payload verbatim; the per-bot mascot windows and the task pill get
  // their sync here too so one push drives every surface.
  ipcMain.on('hermes:botroom:state', (_event, payload) => {
    const botRoomWindow = getBotRoomWindow()

    if (botRoomWindow && !botRoomWindow.isDestroyed()) {
      botRoomWindow.webContents.send('hermes:botroom:state', payload)
    }

    if (payload && (payload.type === 'init' || payload.type === 'bots') && Array.isArray(payload.bots)) {
      mascots.sync(payload.bots)

      for (const bot of payload.bots) {
        pill.updateBot(bot)
      }
    } else if (payload && payload.type === 'bot.status' && payload.bot) {
      mascots.updateBot(payload.bot)
      pill.updateBot(payload.bot)
    } else if (payload && payload.type === 'bot.action' && typeof payload.botId === 'string') {
      mascots.action(payload.botId, String(payload.action ?? ''))
    }
  })

  // Any Bot Room surface → main renderer: tasks, room ops, move reports,
  // window control. Window-lifecycle verbs are handled here in main (same
  // shortcut as 'open-app' — no renderer hop needed to move windows).
  ipcMain.on('hermes:botroom:control', (_event, payload) => {
    // 'open-pill': a mascot's action dot asked for its task composer. Main
    // resolves the bot row + anchor and spawns/retargets the pill.
    if (payload && payload.type === 'open-pill' && typeof payload.botId === 'string') {
      const bot = getBot(payload.botId)

      if (bot) {
        pill.open(bot, mascots.position(payload.botId) ?? { x: 80, y: 80 })
      }

      return
    }

    const mainWindow = getMainWindow()

    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    // 'open-app' raises the app — pure window control, don't forward.
    if (payload && payload.type === 'open-app') {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }

      mainWindow.show()
      mainWindow.focus()

      return
    }

    mainWindow.webContents.send('hermes:botroom:control', payload)
  })
}
