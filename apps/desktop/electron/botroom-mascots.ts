/**
 * Per-bot mascot windows — the cross-app interaction layer for Bot Room.
 *
 * Why separate windows: a fullscreen click-through overlay can only take
 * real pointer input while our app is frontmost (macOS never forwards to a
 * background app's window, forwarded synthetic moves or not). A *small*
 * always-on-top, non-activating panel is the native desktop-pet shape: the
 * OS delivers real clicks and drags to it even while another app is focused
 * (palette semantics — `acceptFirstMouse` + NSPanel), and its drag is
 * handled by the OS itself via `-webkit-app-region: drag`, so it is as
 * smooth as dragging a native window.
 *
 * One window per bot, synced with the roster the store pushes through
 * `hermes:botroom:state` (see botroom-ipc.ts). The fullscreen overlay hides
 * these while it is open — two muses on screen at once is one too many.
 */
import { type BrowserWindow, ipcMain, screen } from 'electron'

export interface BotRoomMascot {
  id: string
  name: string
  displayName?: string
  status?: string
  statusLine?: string
  color?: string
}

export interface BotRoomMascotsDeps {
  /** Spawn helper — injected so window options live in one place. */
  spawnMascotWindow: (bot: BotRoomMascot, x: number, y: number) => BrowserWindow
  /** Forward a mascot window's control message to the main renderer. */
  forwardControl: (payload: unknown) => void
}

const MASCOT_W = 150
const MASCOT_H = 165

export function createBotRoomMascots({ spawnMascotWindow, forwardControl }: BotRoomMascotsDeps) {
  /** botId -> its live mascot window. */
  const windows = new Map<string, BrowserWindow>()
  /** botId -> last known position (survives window recreation). */
  const positions = new Map<string, { x: number; y: number }>()
  /** botId -> last pushed roster row (the pill resolves anchors + labels). */
  const roster = new Map<string, BotRoomMascot>()
  /** Whether the fullscreen overlay currently owns the stage. */
  let overlayOpen = false
  /** Spawn slot counter for first-seen mascots. */
  let spawnIndex = 0

  const spawnPos = (): { x: number; y: number } => {
    const area = screen.getPrimaryDisplay().workArea
    const cols = Math.max(1, Math.floor((area.width - 240) / 140))
    const i = spawnIndex++
    const col = i % cols
    const row = Math.floor(i / cols)

    return { x: area.x + area.width - 170 - col * 150, y: area.y + 60 + row * 175 }
  }

  const ensure = (bot: BotRoomMascot): BrowserWindow | null => {
    const existing = windows.get(bot.id)

    if (existing && !existing.isDestroyed()) {
      return existing
    }

    const p = positions.get(bot.id) ?? spawnPos()

    positions.set(bot.id, p)
    const win = spawnMascotWindow(bot, p.x, p.y)

    win.on('moved', () => {
      if (win.isDestroyed()) {
        return
      }

      const [x, y] = win.getPosition()

      positions.set(bot.id, { x, y })
      forwardControl({ type: 'mascot.move', botId: bot.id, x, y })
    })

    win.on('closed', () => {
      if (windows.get(bot.id) === win) {
        windows.delete(bot.id)
      }
    })

    windows.set(bot.id, win)

    if (overlayOpen) {
      win.hide()
    }

    return win
  }

  return {
    /** Reconcile live mascot windows with the pushed roster. */
    sync(bots: BotRoomMascot[]) {
      const seen = new Set(bots.map((b) => b.id))

      for (const bot of bots) {
        roster.set(bot.id, bot)
        const win = ensure(bot)

        if (win && !win.isDestroyed()) {
          win.webContents.send('hermes:botroom-mascot:state', bot)
        }
      }

      for (const [id, win] of windows) {
        if (!seen.has(id)) {
          positions.delete(id)
          roster.delete(id)

          if (!win.isDestroyed()) {
            win.destroy()
          }

          windows.delete(id)
        }
      }
    },

    /** Update one bot's status in place. */
    updateBot(bot: BotRoomMascot) {
      roster.set(bot.id, bot)
      const win = windows.get(bot.id)

      if (win && !win.isDestroyed()) {
        win.webContents.send('hermes:botroom-mascot:state', bot)
      }
    },

    /** The last pushed roster row for a bot — the pill's anchor + labels. */
    bot(botId: string) {
      return roster.get(botId)
    },

    /** The fullscreen overlay opened/closed — mascot windows step aside /
     *  come back so a bot never renders twice at once. */
    setOverlayOpen(open: boolean) {
      overlayOpen = open

      for (const win of windows.values()) {
        if (win.isDestroyed()) {
          continue
        }

        if (open) {
          win.hide()
        } else {
          win.showInactive()
        }
      }
    },

    /** A mascot window drag ended inside the page (renderer-driven move). */
    place(botId: string, x: number, y: number) {
      positions.set(botId, { x, y })
      const win = windows.get(botId)

      if (win && !win.isDestroyed()) {
        win.setPosition(Math.round(x), Math.round(y))
      }
    },

    position(botId: string) {
      return positions.get(botId)
    },

    /** Live window for a bot — the drag IPC resolves targets this way. */
    window(botId: string) {
      return windows.get(botId)
    },

    closeAll() {
      for (const win of windows.values()) {
        if (!win.isDestroyed()) {
          win.destroy()
        }
      }

      windows.clear()
      positions.clear()
    }
  }
}

export type BotRoomMascots = ReturnType<typeof createBotRoomMascots>

/**
 * Manual window drag for mascot windows. The window body is NOT an
 * app-region (native drag doesn't engage on a non-activating panel); the
 * renderer captures the pointer and streams screen-space positions here.
 * 'start' records the grab offset; 'move' repositions; 'end' persists.
 */
export function registerBotRoomMascotDragIpc(windowsFor: (botId: string) => BrowserWindow | undefined, onMoved: (botId: string, x: number, y: number) => void) {
  const grabs = new Map<string, { dx: number; dy: number }>()

  ipcMain.on('hermes:botroom-mascot:drag', (_event, payload: { botId?: string; phase?: string; x?: number; y?: number }) => {
    if (!payload || typeof payload.botId !== 'string') {
      return
    }

    const win = windowsFor(payload.botId)

    if (!win || win.isDestroyed()) {
      return
    }

    const sx = Number(payload.x)
    const sy = Number(payload.y)

    if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
      return
    }

    if (payload.phase === 'start') {
      const [wx, wy] = win.getPosition()
      grabs.set(payload.botId, { dx: sx - wx, dy: sy - wy })

      return
    }

    const grab = grabs.get(payload.botId)

    if (!grab) {
      return
    }

    const nx = Math.round(sx - grab.dx)
    const ny = Math.round(sy - grab.dy)

    win.setPosition(nx, ny)

    if (payload.phase === 'end') {
      grabs.delete(payload.botId)
      onMoved(payload.botId, nx, ny)
    }
  })
}

/** Register the mascot window's control channel — it speaks the same
 *  BotRoomControl protocol as the overlay, forwarded to the main renderer. */
export function registerBotRoomMascotIpc(forwardControl: (payload: unknown) => void) {
  ipcMain.on('hermes:botroom-mascot:control', (_event, payload) => {
    forwardControl(payload)
  })
}
