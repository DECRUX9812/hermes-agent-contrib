/**
 * Live turn state for the rail header, the roster's live line and the
 * Approvals tab. It is built from gateway events the shell already delivers
 * (`host.onEvent`), so it works on a shell whose host lacks the fork's
 * dot/status/attention atoms.
 *
 * It is never stale. An entry exists only while its session is busy:
 * - message.start / tool.* / approval.* move the entry's phase;
 * - message.complete and error drop it;
 * - so does every busy-map change that shows the session idle.
 * An event for a session that is not busy is ignored, so a late frame
 * cannot bring a finished turn back.
 */

import { atom, host } from '@hermes/plugin-sdk'

export interface LiveTurn {
  /** The command or change an approval is waiting on. */
  command?: string
  phase: 'approval' | 'thinking' | 'tool'
  promptId?: string
  since: number
  tool?: string
}

export interface LiveTurnEvent {
  payload?: unknown
  session_id?: string
  type: string
}

/** Runtime session id → its turn, only while that session is busy. */
export const $liveTurns = atom<Record<string, LiveTurn>>({})

/** Runtime id → stored id, learned from focus. Turn events speak runtime
 *  ids, and the roster keys a bot's chat by its stored id. */
export const $learnedStoredByRuntime = atom<Record<string, string>>({})

/** A file the bot wrote this window session, newest first. */
export interface LiveFile {
  at: number
  path: string
  /** The focused chat's profile when the write landed there. */
  profile?: string
  runtimeId: string
  storedId?: string
}

/** Files written by bots, fed by tool.complete. Delivered as they land,
 *  for a host whose artifact listing is empty or missing. */
export const $liveFiles = atom<LiveFile[]>([])

const LIVE_FILES_LIMIT = 20
const FILE_TOOLS = new Set(['patch', 'write_file'])

/** The path a successful file-writing tool call produced, or null. */
export function deliveredPath(payload: unknown): null | string {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const p = payload as Record<string, unknown>
  const tool = String(p.tool_name || p.name || '')
  const args = p.args && typeof p.args === 'object' ? (p.args as Record<string, unknown>) : {}
  const path = typeof args.path === 'string' ? args.path.trim() : ''

  return FILE_TOOLS.has(tool) && p.is_error !== true && path ? path : null
}

export function recordLiveFile(file: LiveFile): void {
  const rest = $liveFiles.get().filter(f => f.path !== file.path)

  $liveFiles.set([file, ...rest].slice(0, LIVE_FILES_LIMIT))
}

export const LIVE_TURN_EVENTS = [
  'approval.cancelled',
  'approval.request',
  'approval.responded',
  'approval.settled',
  'error',
  'message.complete',
  'message.start',
  'tool.complete',
  'tool.start'
] as const

const field = (payload: unknown, key: string): string => {
  const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined

  return typeof value === 'string' ? value : ''
}

/** Next turn state for one event; null drops the entry. */
export function reduceLiveTurn(current: LiveTurn | null, event: LiveTurnEvent, at: number): LiveTurn | null {
  switch (event.type) {
    case 'message.complete':

    case 'error':
      return null

    case 'message.start':
      return current ?? { phase: 'thinking', since: at }
    case 'tool.start': {
      const tool = field(event.payload, 'name') || field(event.payload, 'tool_name')

      return current?.phase === 'approval' ? current : { phase: 'tool', since: at, ...(tool ? { tool } : {}) }
    }

    case 'tool.complete':
      return current?.phase === 'approval' ? current : { phase: 'thinking', since: at }
    case 'approval.request': {
      const command = field(event.payload, 'command') || field(event.payload, 'description')
      const promptId = field(event.payload, 'prompt_id')

      return {
        phase: 'approval',
        since: at,
        ...(command ? { command } : {}),
        ...(promptId ? { promptId } : {}),
        ...(current?.tool ? { tool: current.tool } : {})
      }
    }

    default:
      // approval.settled / cancelled / responded: the gate is answered and
      // the tool it held either runs or is refused, so the turn carries on.
      return current?.phase === 'approval' ? { phase: current.tool ? 'tool' : 'thinking', since: at, ...(current.tool ? { tool: current.tool } : {}) } : current
  }
}

export function feedLiveTurn(event: LiveTurnEvent, busy: Record<string, boolean>, at = Date.now()): void {
  const id = event?.session_id

  if (!id) {
    return
  }

  const turns = $liveTurns.get()
  const current = turns[id] ?? null

  // A late frame for a finished turn must not bring it back.
  if (!current && !busy[id]) {
    return
  }

  const next = reduceLiveTurn(current, event, at)

  if (next === current) {
    return
  }

  const copy = { ...turns }

  if (next) {
    copy[id] = next
  } else {
    delete copy[id]
  }

  $liveTurns.set(copy)
}

/** Drop every entry whose session the busy map no longer shows as busy. */
export function sweepLiveTurns(busy: Record<string, boolean>): void {
  const turns = $liveTurns.get()
  const stale = Object.keys(turns).filter(id => !busy[id])

  if (!stale.length) {
    return
  }

  const copy = { ...turns }

  for (const id of stale) {
    delete copy[id]
  }

  $liveTurns.set(copy)
}

export function learnStoredId(runtimeId: null | string | undefined, storedId: null | string | undefined): void {
  if (!runtimeId || !storedId || $learnedStoredByRuntime.get()[runtimeId] === storedId) {
    return
  }

  $learnedStoredByRuntime.set({ ...$learnedStoredByRuntime.get(), [runtimeId]: storedId })
}

/** Subscribe to the shell's events and busy map. Returns false (and wires
 *  nothing) on a shell without them. */
export function wireLiveTurns(onDispose: (dispose: () => void) => void): boolean {
  const busyAtom = host.state.busyBySession

  if (typeof host.onEvent !== 'function' || !busyAtom) {
    return false
  }

  for (const type of LIVE_TURN_EVENTS) {
    onDispose(host.onEvent(type, (event: LiveTurnEvent) => feedLiveTurn({ ...event, type }, busyAtom.get() || {})))
  }

  onDispose(
    host.onEvent('tool.complete', (event: LiveTurnEvent) => {
      const path = deliveredPath(event?.payload)
      const runtimeId = event?.session_id

      if (!path || !runtimeId) {
        return
      }

      const focused = host.state.focusedSessionId?.get() === runtimeId
      const profile = focused ? host.state.focusedSessionProfile?.get() : undefined
      const storedId = focused ? host.state.focusedStoredSessionId?.get() : undefined

      recordLiveFile({
        at: Date.now(),
        path,
        runtimeId,
        ...(profile ? { profile } : {}),
        ...(storedId ? { storedId } : {})
      })
    })
  )

  onDispose(busyAtom.listen(busy => sweepLiveTurns(busy || {})))

  const learn = () => learnStoredId(host.state.focusedSessionId?.get(), host.state.focusedStoredSessionId?.get())

  if (host.state.focusedSessionId && host.state.focusedStoredSessionId) {
    onDispose(host.state.focusedSessionId.listen(learn))
    onDispose(host.state.focusedStoredSessionId.listen(learn))
    learn()
  }

  return true
}
