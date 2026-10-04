/**
 * Room engine — extension-local rooms that can mix harnesses.
 *
 * A room is a shared conversation: user messages fan out to member bots,
 * each bot's reply is re-injected to the others as `[Name]: text` (that's the
 * "bots hand notes to each other" loop), and every member sees the room's
 * scratchpad as live context.
 *
 * Relay modes:
 *   mention     — a bot replies only when @named (or when the room's sole
 *                 non-author member, so a 1:1 room "just works")
 *   roundrobin  — every member answers every message (the watch-them-talk
 *                 mode; bounded by a turn cap so loops can't run away)
 *
 * Hermes-only rooms could mirror onto the backend's hosted `groups.*` rooms;
 * extension-local wins for v1 because rooms can mix harnesses (a Grok bot and
 * a Hermes bot can share a room — a hosted room can't express that).
 */

import type { Room, RoomMsg } from '../shared/types'

import type { Harness } from './harness'
import { rid } from './harness'

const MAX_RELAY_TURNS = 12
const STORAGE_KEY = 'bot-room.rooms'

interface RoomState extends Room {
  /** Currently-running member ids — prevents re-entrant relays. */
  busy: Set<string>
  stopped: boolean
}

export class RoomEngine {
  private rooms = new Map<string, RoomState>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  onRoomMsg: ((msg: RoomMsg) => void) | null = null
  onRoomsChanged: ((rooms: Room[]) => void) | null = null
  onBotStatus: ((botId: string, status: string, line?: string) => void) | null = null
  /** Runs a page action in the tab that owns the room. */
  onPageAction: ((roomId: string, action: string, args: Record<string, unknown>) => Promise<unknown>) | null = null

  constructor(private getHarness: (harnessId: string) => Harness | undefined) {}

  async load() {
    const stored = await chrome.storage.local.get(STORAGE_KEY)
    const rows = (stored[STORAGE_KEY] ?? []) as Room[]

    for (const r of rows) {
      this.rooms.set(r.id, { ...r, busy: new Set(), stopped: false })
    }
  }

  private persist() {
    if (this.persistTimer) {clearTimeout(this.persistTimer)}
    this.persistTimer = setTimeout(() => {
      const rows = [...this.rooms.values()].map(({ busy: _b, stopped: _s, ...r }) => r)
      void chrome.storage.local.set({ [STORAGE_KEY]: rows })
    }, 400)
  }

  private broadcastRooms() {
    this.onRoomsChanged?.([...this.rooms.values()].map(({ busy: _b, stopped: _s, ...r }) => r))
    this.persist()
  }

  private emit(roomId: string, msg: Omit<RoomMsg, 'id' | 'roomId' | 'at'>) {
    this.onRoomMsg?.({ ...msg, id: rid(), roomId, at: Date.now() })
  }

  createRoom(name: string, botIds: string[]): Room {
    const room: RoomState = {
      id: rid(),
      name: name || `Room ${this.rooms.size + 1}`,
      memberBotIds: botIds,
      scratchpad: '',
      createdAt: Date.now(),
      relayMode: 'roundrobin',
      anchor: null,
      busy: new Set(),
      stopped: false,
    }

    this.rooms.set(room.id, room)
    this.broadcastRooms()

    return room
  }

  removeRoom(roomId: string) {
    const room = this.rooms.get(roomId)

    if (room) {room.stopped = true}
    this.rooms.delete(roomId)
    this.broadcastRooms()
  }

  addBot(roomId: string, botId: string) {
    const room = this.rooms.get(roomId)

    if (!room || room.memberBotIds.includes(botId)) {return}
    room.memberBotIds.push(botId)
    this.emit(roomId, {
      author: 'system',
      authorName: 'system',
      text: `${this.botName(botId)} joined the room`,
    })
    this.broadcastRooms()
  }

  setScratchpad(roomId: string, text: string) {
    const room = this.rooms.get(roomId)

    if (!room) {return}
    room.scratchpad = text
    this.persist()
  }

  setAnchor(roomId: string, x: number, y: number) {
    const room = this.rooms.get(roomId)

    if (!room) {return}
    room.anchor = { x, y }
    this.persist()
  }

  list(): Room[] {
    return [...this.rooms.values()].map(({ busy: _b, stopped: _s, ...r }) => r)
  }

  /** User spoke in a room (or at a solo bot, roomId undefined). */
  async userMessage(roomId: string, text: string, authorName = 'You') {
    const room = this.rooms.get(roomId)

    if (!room) {return}
    this.emit(roomId, { author: 'user', authorName, text })
    await this.relay(room, 'user', authorName, text, 0)
  }

  /** The relay loop: deliver `text` to the room's bots, collect replies,
   *  feed each reply back to the other members until the conversation settles
   *  or hits the turn cap. */
  private async relay(room: RoomState, author: string, authorName: string, text: string, depth: number) {
    if (room.stopped || depth > MAX_RELAY_TURNS) {return}
    const members = room.memberBotIds.filter(id => id !== author)

    let targets: string[]

    if (author === 'user') {
      const mention = /@([\w-]+)/g
      const named = new Set<string>()

      for (const m of text.matchAll(mention)) {named.add(m[1]!.toLowerCase())}
      targets =
        room.relayMode === 'roundrobin' || named.size === 0
          ? members
          : members.filter(id => named.has(id.split(':').pop()!.toLowerCase()))

      if (targets.length === 0) {targets = members} // no names matched → everyone
    } else {
      // A bot spoke: relay to everyone else only when the room invites
      // back-and-forth (roundrobin); in mention mode bots reply to the user's
      // own messages only, so bots don't spiral.
      if (room.relayMode !== 'roundrobin') {return}
      targets = members
    }

    const replies = await Promise.all(
      targets.map(botId => this.deliver(room, botId, authorName, text)),
    )

    // Each bot that answered gets heard by the room (depth+1 relay).
    for (const [botId, replyText] of replies) {
      if (!replyText || room.stopped) {continue}
      await this.relay(room, botId, this.botName(botId), replyText, depth + 1)
    }
  }

  private botName(botId: string): string {
    return botId.split(':').pop() ?? botId
  }

  private async deliver(
    room: RoomState,
    botId: string,
    authorName: string,
    text: string,
  ): Promise<[string, string | null]> {
    const harness = this.getHarness(botId.split(':')[0]!)

    if (!harness || room.busy.has(botId)) {return [botId, null]}
    room.busy.add(botId)
    const ref = botId.split(':').slice(1).join(':')
    const scratch = room.scratchpad.trim()

    const prompt =
      `[Room "${room.name}"${scratch ? ` · shared notes: ${scratch}` : ''}] ` +
      `${authorName}: ${text}`

    this.emit(room.id, {
      author: botId,
      authorName: this.botName(botId),
      text: '…',
      ephemeral: true,
    })
    this.onBotStatus?.(botId, 'working', 'In the room…')
    let result: string | null = null

    try {
      const res = await harness.send(ref, prompt, {
        onPageAction: (action, args, reply) => {
          void this.onPageAction?.(room.id, action, args).then(reply, () => reply({ ok: false }))
        },
      })

      result = res.text
    } catch (e) {
      result = `(unreachable: ${String(e).slice(0, 120)})`
    }

    room.busy.delete(botId)
    this.onBotStatus?.(botId, 'idle')
    this.emit(room.id, { author: botId, authorName: this.botName(botId), text: result })

    return [botId, result]
  }
}
