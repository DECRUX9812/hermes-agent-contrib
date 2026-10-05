import { atom } from 'nanostores'

import { activeGatewayProfileKey } from '@/store/gateway-registry'
import { requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway-routing'

/**
 * Bot Room controller (main-renderer side).
 *
 * The overlay window (`?win=botroom`) is a full-screen transparent,
 * always-on-top surface where bot mascots live on the desktop itself. It
 * carries NO gateway — this store is the single source of truth: it pushes
 * the roster/status/rooms to the overlay over IPC and answers its control
 * messages (tasks, room ops, mascot positions) exactly like the pet overlay
 * controller does one level down.
 *
 * Bot Mode invariant honored here: one bot = one Hermes profile, and its
 * canonical chat is (profile, session titled "Bot Chat") — resolved by TITLE
 * via session.list on every send, never a stored session-id pointer
 * (src/AGENTS.md § Bot Mode). Requests route to the bot's own profile via
 * requestGatewayForAgent, matching requestForBot's routing.
 */

export interface BotRoomBot {
  id: string
  /** Profile name — also the routing key for per-bot requests. */
  name: string
  displayName?: string
  status: 'idle' | 'working' | 'sleeping' | 'offline'
  statusLine?: string
  color?: string
}

export interface BotRoomRoom {
  id: string
  name: string
  memberBotIds: string[]
  anchor?: { x: number; y: number }
}

export interface BotRoomStatePayload {
  type: 'init' | 'bots' | 'bot.status' | 'rooms' | 'room.msg'
  enabled?: boolean
  bots?: BotRoomBot[]
  bot?: BotRoomBot
  rooms?: BotRoomRoom[]
  msg?: {
    roomId: string
    author: string
    text: string
    ephemeral?: boolean
    at: number
  }
}

export type BotRoomControl =
  | { type: 'ready' }
  | { type: 'task'; botId?: string; roomId?: string; text: string }
  | { type: 'room.create'; name: string; botIds?: string[] }
  | { type: 'room.move'; roomId: string; botId?: string }
  | { type: 'room.remove'; roomId: string }
  | { type: 'mascot.move'; botId: string; x: number; y: number }
  | { type: 'open-pill'; botId: string }
  | { type: 'open-app' }
  | { type: 'close' }

export const $botroomActive = atom(false)

const CANONICAL_CHAT_TITLE = 'Bot Chat'

interface ProfileRow {
  name: string
  display_name?: string
  status?: string
  last_active?: string
  ui_meta?: Record<string, unknown>
}

interface SessionRow {
  id: string
  resolved_id?: string
  title?: string
}

interface ResumedSession {
  session_id?: string
}

const $bots = atom<Map<string, BotRoomBot>>(new Map())
const $rooms = atom<Map<string, BotRoomRoom>>(new Map())
let wired = false
let pollTimer: ReturnType<typeof setInterval> | null = null

function wireControl(): void {
  if (wired) {
    return
  }

  wired = true
  window.hermesDesktop.botroom.onControl((msg) => void handleControl(msg))
}

// Self-wire in the MAIN renderer only (every window kind imports this store,
// including `?win=botroom` itself — the overlay window has no business
// answering its own control channel). Importing the module is enough; no
// call site needed.
if (
  typeof window !== 'undefined' &&
  window.hermesDesktop?.botroom &&
  !new URLSearchParams(window.location.search).has('win')
) {
  wireControl()
}

function push(payload: BotRoomStatePayload): void {
  window.hermesDesktop.botroom.pushState(payload)
}

function startFeed(): void {
  if (pollTimer === null) {
    pollTimer = setInterval(() => void refreshBots(), 8000)
  }
}

async function refreshBots(): Promise<void> {
  try {
    const res = await requestGatewayForProfile<{ profiles: ProfileRow[] }>(
      activeGatewayProfileKey(),
      'profiles.list',
      { include_hidden: true },
    )

    const next = new Map<string, BotRoomBot>()

    for (const p of res.profiles ?? []) {
      const id = `profile:${p.name}`

      const status: BotRoomBot['status'] = p.status === 'working'
        ? 'working'
        : p.status === 'sleeping'
          ? 'sleeping'
          : 'idle'

      next.set(id, {
        id,
        name: p.name,
        displayName: p.display_name ?? p.name,
        status,
        statusLine: p.last_active,
        color: (p.ui_meta?.color as string) ?? undefined,
      })
    }

    const prev = $bots.get()
    const membershipChanged = next.size !== prev.size || [...next.keys()].some((k) => !prev.has(k))

    if (membershipChanged) {
      $bots.set(next)
      push({ type: 'bots', bots: [...next.values()] })
    } else {
      for (const [id, b] of next) {
        if (prev.get(id)?.status !== b.status || prev.get(id)?.statusLine !== b.statusLine) {
          $bots.get().set(id, b)
          push({ type: 'bot.status', bot: b })
        }
      }
    }
  } catch {
    // Backend not reachable — the overlay keeps whatever roster it had.
  }
}

/** Resolve the bot's canonical "Bot Chat" session id — by title, every
 *  time (no stored pointer; a name cannot dangle). */
async function canonicalChatId(bot: BotRoomBot): Promise<string | null> {
  const res = await requestGatewayForAgent<{ sessions?: SessionRow[] } | SessionRow[]>(
    null,
    bot.name,
    'session.list',
    { title: CANONICAL_CHAT_TITLE, include_hidden: true },
  )

  const rows = Array.isArray(res) ? res : (res.sessions ?? [])
  const row = rows.find((r) => r.title === CANONICAL_CHAT_TITLE) ?? rows[0]

  return row ? String(row.resolved_id || row.id) : null
}

/** Mint the canonical chat when the registry is empty — same shape as the
 *  bots plugin's broadcast path (create hidden + titled, then title write on
 *  the runtime id; a collision just means a concurrent writer won and the
 *  next resolve adopts it). */
async function mintCanonicalChat(bot: BotRoomBot): Promise<string | null> {
  const created = await requestGatewayForAgent<{ session_id?: string; stored_session_id?: string }>(
    null,
    bot.name,
    'session.create',
    { follow_profile_config: true, hidden: true, title: CANONICAL_CHAT_TITLE },
    undefined,
    undefined,
    { spawnPriority: 'foreground' },
  )

  const runtime = created?.session_id

  if (runtime) {
    try {
      await requestGatewayForAgent(null, bot.name, 'session.title', {
        session_id: runtime,
        title: CANONICAL_CHAT_TITLE,
      })
    } catch {
      // Title already in use → a concurrent/pre-existing row wins; the
      // caller's next resolve (below) adopts it.
    }
  }

  return created?.stored_session_id ?? (await canonicalChatId(bot))
}

async function submitToBot(botId: string, text: string): Promise<void> {
  const bot = $bots.get().get(botId)

  if (!bot) {
    return
  }

  const stored = (await canonicalChatId(bot)) ?? (await mintCanonicalChat(bot))

  if (!stored) {
    return
  }

  const resumed = await requestGatewayForAgent<ResumedSession>(
    null,
    bot.name,
    'session.resume',
    { session_id: stored, omit_messages: true, lazy: true },
    undefined,
    undefined,
    { spawnPriority: 'foreground' },
  )

  const runtime = resumed.session_id

  if (!runtime) {
    return
  }

  await requestGatewayForAgent(
    null,
    bot.name,
    'prompt.submit',
    { session_id: runtime, text },
    undefined,
    undefined,
    { spawnPriority: 'foreground' },
  )
}

function roomPost(roomId: string, author: string, text: string): void {
  push({ type: 'room.msg', msg: { roomId, author, text, at: Date.now() } })
}

async function roomRelay(room: BotRoomRoom, author: string, text: string): Promise<void> {
  // Fan out to every member except the speaker. Bounded: each inbound message
  // delivers at most one prompt per member — no recursive re-relay, so a room
  // turn is linear in members.
  for (const memberId of room.memberBotIds.filter((id) => id !== author)) {
    const b = $bots.get().get(memberId)

    if (!b) {
      continue
    }

    roomPost(room.id, memberId, '…')

    try {
      await submitToBot(memberId, `[Room "${room.name}" — ${author}]: ${text}`)
      roomPost(room.id, memberId, `${b.displayName ?? b.name} acknowledged`)
    } catch {
      roomPost(room.id, memberId, `${b.displayName ?? b.name} unreachable`)
    }
  }
}

async function handleControl(msg: BotRoomControl): Promise<void> {
  switch (msg.type) {
    case 'task': {
      const room = msg.roomId ? $rooms.get().get(msg.roomId) : undefined

      if (room) {
        roomPost(room.id, 'user', msg.text)
        await roomRelay(room, 'user', msg.text)
      } else if (msg.botId) {
        await submitToBot(msg.botId, msg.text)
      }

      break
    }

    case 'room.create': {
      const id = `room:${Date.now().toString(36)}`
      const room: BotRoomRoom = { id, name: msg.name, memberBotIds: msg.botIds ?? [] }
      const next = new Map($rooms.get())
      next.set(id, room)
      $rooms.set(next)
      push({ type: 'rooms', rooms: [...next.values()] })

      break
    }

    case 'room.move': {
      const room = $rooms.get().get(msg.roomId)

      if (!room) {
        break
      }

      if (msg.botId && !room.memberBotIds.includes(msg.botId)) {
        const next = new Map($rooms.get())
        next.set(msg.roomId, { ...room, memberBotIds: [...room.memberBotIds, msg.botId] })
        $rooms.set(next)
        push({ type: 'rooms', rooms: [...next.values()] })
        roomPost(msg.roomId, 'system', `${$bots.get().get(msg.botId)?.displayName ?? msg.botId} joined`)
      }

      break
    }

    case 'room.remove': {
      const next = new Map($rooms.get())
      next.delete(msg.roomId)
      $rooms.set(next)
      push({ type: 'rooms', rooms: [...next.values()] })

      break
    }

    case 'mascot.move':
      break // positions are overlay-side state; persistence arrives with rooms v2
    case 'ready': {
      // The overlay may have been opened straight through the bridge (the
      // roster-toolbar button) without openBotRoom() — latch the active flag
      // and the roster feed here so either path boots identically.
      $botroomActive.set(true)
      startFeed()
      push({ type: 'init', enabled: true, bots: [...$bots.get().values()], rooms: [...$rooms.get().values()] })
      void refreshBots()

      break
    }

    case 'close': {
      $botroomActive.set(false)

      if (pollTimer !== null) {
        clearInterval(pollTimer)
        pollTimer = null
      }

      void window.hermesDesktop.botroom.close()

      break
    }
  }
}

/** Open the Bot Room overlay and start feeding it the roster. */
export async function openBotRoom(): Promise<void> {
  wireControl()

  await window.hermesDesktop.botroom.open()
  $botroomActive.set(true)
  startFeed()

  void refreshBots()
}

export async function closeBotRoom(): Promise<void> {
  await window.hermesDesktop.botroom.close()
  $botroomActive.set(false)

  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export async function toggleBotRoom(): Promise<void> {
  if ($botroomActive.get()) {
    await closeBotRoom()
  } else {
    await openBotRoom()
  }
}
