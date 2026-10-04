/**
 * Service worker — the room's spine.
 *
 * Owns: settings, the Hermes gateway connection, the harness registry, the
 * room engine, the page bridge, and the message bus to every content script.
 * MV3 workers are event-driven and can be reaped; everything durable lives in
 * chrome.storage and the WS reconnects on first demand.
 */

import type {
  Bot, ConnStatus, ContentToSw, PageActionResult, RoomMsg, Settings, SwToContent,
} from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

import { PageBridge } from './bridge'
import type { Harness } from './harness'
import { HermesHarness } from './hermes'
import { makeOpenAIHarness } from './openai'
import { RoomEngine } from './rooms'
import { GatewayRpc } from './rpc'

const SETTINGS_KEY = 'bot-room.settings'

/** Deterministic per-bot accent (name → stable hue). */
function profileColorFor(name: string): string {
  let h = 0

  for (const ch of name) {h = (h * 31 + ch.charCodeAt(0)) >>> 0}
  const hue = h % 360

  return `hsl(${hue}, 72%, 58%)`
}

class BotRoomService {
  private settings: Settings = DEFAULT_SETTINGS
  private rpc: GatewayRpc | null = null
  private hermes: HermesHarness | null = null
  private harnesses = new Map<string, Harness>()
  private bridge = new PageBridge()
  private rooms: RoomEngine
  private bots = new Map<string, Bot>()
  private rosterTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.rooms = new RoomEngine(id => this.harnesses.get(id))
    this.rooms.onRoomMsg = msg => this.broadcast({ type: 'room.msg', msg })
    this.rooms.onRoomsChanged = rooms => this.broadcast({ type: 'rooms', rooms })

    this.rooms.onBotStatus = (botId, status, line) => {
      const bot = this.bots.get(botId)

      if (bot) {
        bot.status = status as Bot['status']

        if (line !== undefined) {bot.statusLine = line}
        this.broadcast({ type: 'bot.status', bot })
      }
    }

    this.rooms.onPageAction = async (_roomId, action, args) =>
      this.bridge.run(action.startsWith('browser_') ? action : `browser_${action}`, args, {})
  }

  private booted = false
  async boot() {
    if (this.booted) {return}
    this.booted = true
    const stored = await chrome.storage.local.get(SETTINGS_KEY)
    this.settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] ?? {}) }
    await this.rooms.load()
    this.buildHarnesses()
    await this.connect()
    this.startRosterPoll()
  }

  private buildHarnesses() {
    for (const [, h] of this.harnesses) {h.dispose()}
    this.harnesses.clear()
    this.bots.clear()

    if (this.rpc) {
      this.rpc.onClose = () => this.scheduleReconnect()
      this.hermes = new HermesHarness(this.rpc, profileColorFor)
      this.hermes.setPageBridge({
        run: (action, args, meta) => this.bridge.run(action, args, meta),
      })

      this.hermes.onBotStatus = bot => {
        this.bots.set(bot.id, bot)
        this.broadcast({ type: 'bot.status', bot })
      }

      this.harnesses.set('hermes', this.hermes)
    }

    for (const cfg of this.settings.harnesses) {
      const h = makeOpenAIHarness(cfg)
      this.harnesses.set(h.id, h)
    }
  }

  async connect() {
    if (!this.settings.hermes?.url || !this.settings.hermes.token) {
      await this.refreshRoster()

      return
    }

    this.rpc = new GatewayRpc(this.settings.hermes.url, this.settings.hermes.token)
    this.buildHarnesses()

    try {
      await this.refreshRoster()
    } catch (e) {
      console.warn('[bot-room] connect failed', e)
    }
  }

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private scheduleReconnect() {
    if (this.reconnectTimer) {return}
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, 5000)
  }

  private startRosterPoll() {
    if (this.rosterTimer) {clearInterval(this.rosterTimer)}
    this.rosterTimer = setInterval(() => void this.refreshRoster(), 8000)
    // chrome.alarms survives worker sleep; poll on wake too.
    void chrome.alarms.create('bot-room-poll', { periodInMinutes: 0.5 })
  }

  private async refreshRoster() {
    const all: Bot[] = []

    for (const harness of this.harnesses.values()) {
      try {
        for (const b of await harness.listBots()) {
          all.push(b)
          this.bots.set(b.id, b)
        }
      } catch (e) {
        console.warn(`[bot-room] ${harness.id} roster failed`, e)
      }
    }

    this.broadcast({ type: 'bots', bots: all })
  }

  status(): ConnStatus {
    return {
      connected: this.rpc?.isOpen ?? false,
      botsCount: this.bots.size,
      identity: this.hermes?.identityPresent ?? false,
    }
  }

  currentSettings(): Settings {
    return this.settings
  }

  /** Fan a message out to every live overlay. */
  private broadcast(msg: SwToContent) {
    void chrome.tabs.query({}, tabs => {
      for (const t of tabs) {
        if (t.id !== undefined) {
          chrome.tabs.sendMessage(t.id, msg).catch(() => undefined)
        }
      }
    })
  }

  async handleContent(tabId: number | undefined, msg: ContentToSw): Promise<SwToContent | PageActionResult | void> {
    if (tabId !== undefined) {this.bridge.setAnchor(tabId)}

    switch (msg.type) {
      case 'hello': {
        await this.refreshRoster()
        let host = ''

        try { host = new URL(msg.url).hostname } catch { /* odd url */ }

        const enabled =
          this.settings.enabled && !this.settings.disabledHosts.includes(host)

        return {
          type: 'init',
          enabled,
          bots: [...this.bots.values()],
          rooms: this.rooms.list(),
          backendOk: this.rpc?.isOpen ?? this.settings.hermes == null,
          note: this.status().connected ? undefined : 'backend not connected',
        }
      }

      case 'task': {
        if (msg.roomId) {
          void this.rooms.userMessage(msg.roomId, msg.text)

          return
        }

        const bot = msg.botId ? this.bots.get(msg.botId) : undefined
        const harness = bot && this.harnesses.get(bot.harnessId)

        if (!bot || !harness) {break}
        void harness.send(bot.ref, msg.text, {
          onDelta: () => undefined,
          onStatus: line => this.rooms.onBotStatus?.(bot.id, 'working', line),
          onPageAction: (action, args, reply) => {
            void this.bridge
              .run(`browser_${action}`, args, { tabId })
              .then(reply, () => reply({ ok: false }))
          },
        }).then(res => {
          this.broadcast({
            type: 'room.msg',
            msg: {
              id: `solo-${Date.now()}`,
              roomId: `solo:${bot.id}`,
              author: bot.id,
              authorName: bot.displayName,
              text: res.text,
              at: Date.now(),
            } satisfies RoomMsg,
          })
        })

        return
      }

      case 'room.create':
        this.rooms.createRoom(msg.name, msg.botIds ?? [])

        return

      case 'room.send':
        void this.rooms.userMessage(msg.roomId, msg.text)

        return

      case 'room.scratchpad':
        this.rooms.setScratchpad(msg.roomId, msg.text)

        return

      case 'room.move':
        if (msg.botId) {this.rooms.addBot(msg.roomId, msg.botId)}

        if (msg.x !== undefined && msg.y !== undefined) {
          this.rooms.setAnchor(msg.roomId, msg.x, msg.y)
        }

        return

      case 'room.remove':
        this.rooms.removeRoom(msg.roomId)

        return

      case 'mascot.move':
        // v0.1: mascot positions live in the content script only.
        return

      case 'action.result':
        this.bridge.resolveResult(msg.payload)

        return

      case 'settings.apply':
        await this.applySettings(msg.settings)

        return
    }
  }

  async applySettings(next: Settings) {
    this.settings = next
    await chrome.storage.local.set({ [SETTINGS_KEY]: next })

    if (this.rpc) {this.rpc.close()}
    this.rpc = null
    this.hermes = null
    this.buildHarnesses()
    await this.connect()
    this.broadcast({ type: 'rooms', rooms: this.rooms.list() })
  }
}

const service = new BotRoomService()

chrome.runtime.onInstalled.addListener(() => void service.boot())
chrome.runtime.onStartup.addListener(() => void service.boot())

chrome.runtime.onMessage.addListener((msg: ContentToSw, sender, sendResponse) => {
  void (async () => {
    await service.boot()
    const res = await service.handleContent(sender.tab?.id, msg)
    sendResponse(res)
  })()

  return true
})

// Options page messages (runtime messages with no tab).
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'options') {return}
  port.onMessage.addListener(async (msg: { type: string; settings?: Settings }) => {
    if (msg.type === 'settings.get') {
      await service.boot()
      const stored = await chrome.storage.local.get(SETTINGS_KEY)
      port.postMessage({
        type: 'settings',
        settings: stored[SETTINGS_KEY] ?? DEFAULT_SETTINGS,
        status: service.status(),
      })
    } else if (msg.type === 'settings.set' && msg.settings) {
      await service.applySettings(msg.settings)
      port.postMessage({ type: 'settings', settings: msg.settings, status: service.status() })
    } else if (msg.type === 'test.connection') {
      await service.connect()
      port.postMessage({ type: 'settings', settings: service.currentSettings(), status: service.status() })
    }
  })
})
