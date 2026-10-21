import type { BotRoomBot as Bot, BotRoomControl, BotRoomStatePayload } from '@/store/botroom'

import { mountBotRoom } from './engine/stage'

/**
 * Boot the Bot Room window (`?win=botroom`): a full-screen transparent,
 * always-on-top surface where bot mascots live on the desktop itself. Same
 * puppet contract as the pet overlay — no gateway here; the main renderer
 * owns roster/rooms/tasks and pushes state over IPC, we send control back.
 *
 * `&demo=1` stubs the bridge with a canned roster and fake handlers so the
 * whole stage (mascots, deck, panels, rooms, palette) runs with no backend —
 * the visual-verification and film path.
 */
export function mountBotRoomWindow(): void {
  const host = document.createElement('div')
  document.body.appendChild(host)

  const demo = new URLSearchParams(window.location.search).get('demo') === '1'

  if (demo || !window.hermesDesktop?.botroom) {
    installDemoBridge()
  }

  mountBotRoom(host)
}

const DEMO_BOTS: Bot[] = [
  { id: 'profile:muse', name: 'muse', displayName: 'Muse', status: 'idle' },
  { id: 'profile:grok', name: 'grok', displayName: 'Grokbot', status: 'idle' },
  { id: 'profile:scout', name: 'scout', displayName: 'Scout', status: 'working', statusLine: 'summarizing diff' },
  { id: 'profile:openclaw', name: 'openclaw', displayName: 'OpenClaw', status: 'idle' },
  { id: 'profile:gemini', name: 'gemini', displayName: 'Gemini', status: 'idle' },
  { id: 'profile:codex', name: 'codex', displayName: 'Codex CLI', status: 'idle' },
]

/** A stand-in `hermesDesktop.botroom`: what the main renderer would have
 *  said anyway, produced locally. Keeps the stage's mount path identical. */
function installDemoBridge(): void {
  const stateListeners = new Set<(p: BotRoomStatePayload) => void>()
  const rooms: { id: string; name: string; memberBotIds: string[] }[] = []

  const emit = (p: BotRoomStatePayload) => stateListeners.forEach((l) => l(p))

  window.hermesDesktop = {
    ...window.hermesDesktop,
    botroom: {
      open: async () => ({ ok: true }),
      close: async () => ({ ok: true }),
      setIgnoreMouse: () => undefined,
      setFocusable: () => undefined,
      pushState: () => undefined,
      onState: (cb: (p: BotRoomStatePayload) => void) => {
        stateListeners.add(cb)

        return () => stateListeners.delete(cb)
      },
      onControl: () => () => undefined,
      control: (msg: BotRoomControl) => {
        if (msg.type === 'ready') {
          emit({ type: 'init', enabled: true, bots: DEMO_BOTS, rooms: [] })
        } else if (msg.type === 'task' && msg.botId) {
          const bot = DEMO_BOTS.find((b) => b.id === msg.botId)

          if (bot) {
            emit({ type: 'bot.status', bot: { ...bot, status: 'working', statusLine: 'on it' } })
            setTimeout(
              () => emit({ type: 'bot.status', bot: { ...bot, status: 'idle', statusLine: undefined } }),
              2600,
            )
          }
        } else if (msg.type === 'room.create') {
          rooms.push({ id: `room:${Date.now()}`, name: msg.name, memberBotIds: [] })
          emit({ type: 'rooms', rooms: [...rooms] })
        } else if (msg.type === 'room.move') {
          const r = rooms.find((room) => room.id === msg.roomId)

          if (r && msg.botId && !r.memberBotIds.includes(msg.botId)) {
            r.memberBotIds.push(msg.botId)
            emit({ type: 'rooms', rooms: [...rooms] })
          }
        } else if (msg.type === 'room.remove') {
          const i = rooms.findIndex((room) => room.id === msg.roomId)

          if (i >= 0) {
            rooms.splice(i, 1)
          }

          emit({ type: 'rooms', rooms: [...rooms] })
        }
      },
    },
  } as typeof window.hermesDesktop
}
