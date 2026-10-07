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
 *   auto        — the decision model (decider.ts) picks who answers each
 *                 user message; when it can't answer — no key, timeout,
 *                 low confidence — the room's first member takes it, like
 *                 OpenMausBot's lead fallback
 *
 * Hermes-only rooms could mirror onto the backend's hosted `groups.*` rooms;
 * extension-local wins for v1 because rooms can mix harnesses (a Grok bot and
 * a Hermes bot can share a room — a hosted room can't express that).
 */

import type { Room, RoomMsg } from '../shared/types'

import type { DeciderConfig } from './decider'
import { decideRoomResponder } from './decider'
import type { Harness } from './harness'
import { rid } from './harness'

const MAX_RELAY_TURNS = 12
/** Lines of room context the decider may read; the per-char budget lives
 *  in decider.ts. */
const RECENT_LINES = 24
const STORAGE_KEY = 'bot-room.rooms'

interface RoomState extends Room {
  /** Currently-running member ids — prevents re-entrant relays. */
  busy: Set<string>
  stopped: boolean
  /** Deliveries left in the current user-message cascade. Bounds TOTAL
   *  fan-out (depth-capping alone is exponential with >=3 members). */
  relayBudget: number
  /** The room's tail, oldest first — the decider's context. Session-local:
   *  never persisted, like `busy`. */
  recent: Array<{ from: string; text: string }>
}

/** How the engine describes a member to the decider: display name plus
 *  whatever persona text the harness config carries (generic harnesses
 *  carry a system prompt; Hermes profiles pass just a name). */
export interface RoomMemberDescriptor {
  name: string
  description?: string
}

export class RoomEngine {
  private rooms = new Map<string, RoomState>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  onRoomMsg: ((msg: RoomMsg) => void) | null = null
  onRoomsChanged: ((rooms: Room[]) => void) | null = null
  onBotStatus: ((botId: string, status: string, line?: string) => void) | null = null
  /** Runs a page action in the tab that owns the room. */
  onPageAction: ((roomId: string, action: string, args: Record<string, unknown>) => Promise<unknown>) | null = null

  constructor(
    private getHarness: (harnessId: string) => Harness | undefined,
    private getDecider: () => DeciderConfig | null = () => null,
    private describeBot: (botId: string) => RoomMemberDescriptor = botId => ({
      name: botId.split(':').pop() ?? botId,
    }),
  ) {}

  async load() {
    const stored = await chrome.storage.local.get(STORAGE_KEY)
    const rows = (stored[STORAGE_KEY] ?? []) as Room[]

    for (const r of rows) {
      this.rooms.set(r.id, { ...r, busy: new Set(), stopped: false, relayBudget: MAX_RELAY_TURNS, recent: [] })
    }
  }

  private persist() {
    if (this.persistTimer) {clearTimeout(this.persistTimer)}
    this.persistTimer = setTimeout(() => {
      const rows = [...this.rooms.values()].map(({ busy: _b, stopped: _s, relayBudget: _rb, recent: _r, ...r }) => r)
      void chrome.storage.local.set({ [STORAGE_KEY]: rows })
    }, 400)
  }

  private broadcastRooms() {
    this.onRoomsChanged?.([...this.rooms.values()].map(({ busy: _b, stopped: _s, relayBudget: _rb, recent: _r, ...r }) => r))
    this.persist()
  }

  private emit(roomId: string, msg: Omit<RoomMsg, 'id' | 'roomId' | 'at'>) {
    const room = this.rooms.get(roomId)

    if (room && !msg.ephemeral && msg.text.trim()) {
      room.recent.push({ from: msg.authorName, text: msg.text })

      if (room.recent.length > RECENT_LINES) {room.recent.shift()}
    }

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
      relayBudget: MAX_RELAY_TURNS,
      recent: [],
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

  setRelayMode(roomId: string, relayMode: Room['relayMode']) {
    const room = this.rooms.get(roomId)

    if (!room || room.relayMode === relayMode) {return}
    room.relayMode = relayMode
    this.emit(roomId, {
      author: 'system',
      authorName: 'system',
      text: `Relay mode → ${relayMode}${relayMode === 'auto' && !this.getDecider() ? ' (no decision-model key — falls back to the first member)' : ''}`,
    })
    this.broadcastRooms()
  }

  setAnchor(roomId: string, x: number, y: number) {
    const room = this.rooms.get(roomId)

    if (!room) {return}
    room.anchor = { x, y }
    this.persist()
  }

  list(): Room[] {
    return [...this.rooms.values()].map(({ busy: _b, stopped: _s, relayBudget: _rb, ...r }) => r)
  }

  /** User spoke in a room (or at a solo bot, roomId undefined). */
  async userMessage(roomId: string, text: string, authorName = 'You') {
    const room = this.rooms.get(roomId)

    if (!room) {return}
    this.emit(roomId, { author: 'user', authorName, text })
    // fresh delivery budget per user message — a room of talkative bots can
    // never deliver more than MAX_RELAY_TURNS replies per message, period.
    room.relayBudget = MAX_RELAY_TURNS
    await this.relay(room, 'user', authorName, text, 0)
  }

  /** The relay loop: deliver `text` to the room's bots, collect replies,
   *  feed each reply back to the other members until the conversation settles
   *  or hits the turn cap. */
  private async relay(room: RoomState, author: string, authorName: string, text: string, depth: number) {
    if (room.stopped || depth > MAX_RELAY_TURNS || room.relayBudget <= 0) {return}
    const members = room.memberBotIds.filter(id => id !== author)

    let targets: string[]

    let pickedByJev: { botId: string; probability: number } | null = null

    if (author === 'user') {
      const mention = /@([\w-]+)/g
      const named = new Set<string>()

      for (const m of text.matchAll(mention)) {named.add(m[1]!.toLowerCase())}

      if (room.relayMode === 'auto' && named.size === 0) {
        // The decider's one job: who answers a message nobody was @named
        // in. Any failure routes to the first member — the room's lead.
        const route = await decideRoomResponder(this.getDecider(), {
          room: room.name,
          humans: [authorName],
          members: members.map(id => ({ id, ...this.describeBot(id) })),
          recent: room.recent,
          message: { from: authorName, text },
        })

        if (route.kind === 'member') {
          targets = [route.botId]
          pickedByJev = { botId: route.botId, probability: route.probability }
        } else if (route.kind === 'everyone') {
          targets = members
        } else {
          targets = members.slice(0, 1)
        }
      } else {
        targets =
          room.relayMode === 'roundrobin' || named.size === 0
            ? members
            : members.filter(id => named.has(id.split(':').pop()!.toLowerCase()))

        if (targets.length === 0) {targets = members} // no names matched → everyone
      }
    } else {
      // A bot spoke: relay to everyone else only when the room invites
      // back-and-forth (roundrobin); in mention mode bots reply to the user's
      // own messages only, so bots don't spiral.
      if (room.relayMode !== 'roundrobin') {return}
      targets = members
    }

    const replies = await Promise.all(
      targets.map(botId =>
        this.deliver(room, botId, authorName, text, pickedByJev?.botId === botId ? pickedByJev.probability : undefined),
      ),
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
    pickedByJev?: number,
  ): Promise<[string, string | null]> {
    const harness = this.getHarness(botId.split(':')[0]!)

    if (!harness || room.busy.has(botId) || room.relayBudget <= 0) {return [botId, null]}
    room.relayBudget--
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
    this.emit(room.id, {
      author: botId,
      authorName: this.botName(botId),
      text: result,
      ...(pickedByJev !== undefined ? { pickedByJev } : {}),
    })

    return [botId, result]
  }
}
