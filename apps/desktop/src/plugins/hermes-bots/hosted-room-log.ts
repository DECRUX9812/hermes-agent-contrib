/**
 * Desktop projection of the backend-owned hosted-room event log. The backend
 * remains the room transcript and driver authority; this module owns only its
 * reloadable renderer cache and mounted-view polling.
 */

import { atom, computed, useValue } from '@hermes/plugin-sdk'
import type {
  GroupsCapabilitiesResult,
  GroupsLogResult,
  GroupsStateResult,
  ReadableAtom,
  RoomDriverStatus,
  RoomEvent
} from '@hermes/plugin-sdk'

import { $botMeta, botHandle } from './data'
import { $groupNeedsYou, mintGroupRoomId, updateGroupChat } from './group-chat'
import type { GroupChatRoom } from './group-chat'
import { displayName } from './labels'
import { botRosterMeta, requestForBot } from './routing'
import type { GroupChat, GroupMember, GroupMessage, GroupPrompt } from './types'

type HostedStatus = 'checking' | 'client' | 'error' | 'ready'

export interface HostedRoomView {
  activeMemberId: null | string
  capabilities: GroupsCapabilitiesResult | null
  cursor: number
  driverStatus: RoomDriverStatus | null
  entries: HostedRoomEntry[]
  error: null | string
  status: HostedStatus
}

export interface HostedRoomEntry extends GroupMessage {
  eventId: string
  seq: number
}

export interface HostedRoomAction extends Record<string, unknown> {
  kind: string
  task_id?: string
}

export interface HostedRoomRequest {
  (method: string, params: Record<string, unknown>): Promise<unknown>
}

interface HostedRoomWatchOptions {
  group: string
  members: GroupMember[]
  room: GroupChat
  /** Route every hosted call through this instead of the bot's own connection. */
  request?: HostedRoomRequest
}

const IDLE_VIEW: HostedRoomView = {
  activeMemberId: null,
  capabilities: null,
  cursor: 0,
  driverStatus: null,
  entries: [],
  error: null,
  status: 'checking'
}

const $hostedRoomViews = atom<Record<string, HostedRoomView>>({})
const viewStores = new Map<string, ReadableAtom<HostedRoomView>>()
const ensureFlights = new Map<string, Promise<HostedRoomView>>()
const pollFlights = new Map<string, Promise<void>>()
const watchers = new Map<string, number>()
const CURSOR_KEY_PREFIX = 'hermes-bots-hosted-room:v1:'
const LOG_PAGE_SIZE = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

function viewFor(roomId: string): HostedRoomView {
  return $hostedRoomViews.get()[roomId] || IDLE_VIEW
}

export function hostedRoomViewSnapshot(roomId: string): HostedRoomView {
  return viewFor(roomId)
}

export function hostedRoomWasCreated(room: GroupChat): boolean {
  return room.hostedRoomCreated === true
}

function setView(roomId: string, update: (current: HostedRoomView) => HostedRoomView) {
  const current = viewFor(roomId)
  const next = update(current)

  if (next === current) {
    return current
  }

  $hostedRoomViews.set({
    ...$hostedRoomViews.get(),
    [roomId]: next
  })

  return next
}

export function hostedRoomViewStore(roomId: string) {
  const cached = viewStores.get(roomId)

  if (cached) {
    return cached
  }

  const store = computed($hostedRoomViews, views => views[roomId] || IDLE_VIEW)
  viewStores.set(roomId, store)

  return store
}

export function useHostedRoomView(roomId: string): HostedRoomView {
  return useValue(hostedRoomViewStore(roomId))
}

/** Merge the read-only renderer history with the backend-owned log. Ids win
 *  over sequence so an event paged twice cannot paint twice. */
export function mergeHostedRoomEntries(
  localLog: GroupMessage[],
  hostedEntries: HostedRoomEntry[]
): GroupMessage[] {
  const hostedIds = new Set(hostedEntries.map(entry => String(entry.id || entry.eventId)))
  const localOnly = localLog.filter(entry => !entry.id || !hostedIds.has(String(entry.id)))

  return [...localOnly, ...hostedEntries]
}

export function resetHostedRoomViewsForTest(): void {
  $hostedRoomViews.set({})
  ensureFlights.clear()
  pollFlights.clear()
  watchers.clear()
}

function localMember(member: GroupMember): boolean {
  return (
    member.connectionId === 'local' &&
    member.remoteSource !== true &&
    member.sourceMissing !== true &&
    member.ghost !== true
  )
}

/** The roster key the backend stores for a member: its profile, else its name. */
function memberKey(member: GroupMember): string {
  return String(member.targetProfile || member.name)
}

/** The single policy point for selecting the room's driver. */
export function roomDriveMode(
  room: GroupChat,
  members: GroupMember[],
  hosted: { capabilities: { driver?: boolean } | null; status: HostedStatus } | null | undefined,
  hasUnsupportedAttachments = false
): 'client' | 'hosted' {
  if (
    room.hostedRoomClientOnly ||
    !room.roomId ||
    room.holdDetection === false ||
    room.listener ||
    Object.keys(room.limits || {}).length > 0 ||
    Boolean(room.goal) ||
    Object.keys(room.holds || {}).length > 0 ||
    Object.keys(room.heldMessages || {}).length > 0 ||
    hasUnsupportedAttachments ||
    !members.length ||
    !members.every(localMember) ||
    hosted?.status !== 'ready' ||
    hosted.capabilities?.driver !== true
  ) {
    return 'client'
  }

  return 'hosted'
}

/** A room earns a backend id only when the hosted driver could take it; minting one re-keys its local prefs. */
function hostedEligible(room: GroupChat, members: GroupMember[]): boolean {
  return (
    roomDriveMode({ ...room, roomId: 'pending' }, members, { capabilities: { driver: true }, status: 'ready' }) ===
    'hosted'
  )
}

export function hostedRoomCursorKey(roomId: string, connectionId = 'local'): string {
  return `${CURSOR_KEY_PREFIX}${connectionId}:${roomId}`
}

export interface HostedRoomCheckpoint {
  cursor: number
  events: RoomEvent[]
}

function checkpointKey(roomId: string, connectionId = 'local') {
  return hostedRoomCursorKey(roomId, connectionId)
}

export function loadHostedRoomCheckpoint(
  roomId: string,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  connectionId = 'local'
): HostedRoomCheckpoint {
  if (!storage) {
    return { cursor: 0, events: [] }
  }

  try {
    const raw = storage.getItem(checkpointKey(roomId, connectionId))

    if (!raw) {
      return { cursor: 0, events: [] }
    }

    const parsed: unknown = JSON.parse(raw)

    if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
      return { cursor: 0, events: [] }
    }

    const events = parsed.events.filter(
      (event): event is RoomEvent =>
        isRecord(event) &&
        typeof event.seq === 'number' &&
        typeof event.event_id === 'string' &&
        typeof event.kind === 'string'
    )

    return {
      cursor: Math.max(0, Number(parsed.cursor) || 0),
      events: mergeHostedRoomEvents([], events)
    }
  } catch {
    return { cursor: 0, events: [] }
  }
}

export function persistHostedRoomCheckpoint(
  roomId: string,
  checkpoint: HostedRoomCheckpoint,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  connectionId = 'local'
): boolean {
  if (!storage) {
    return false
  }

  try {
    storage.setItem(checkpointKey(roomId, connectionId), JSON.stringify(checkpoint))

    return true
  } catch {
    return false
  }
}

/** Deduplicate event re-pages by both immutable event id and sequence. */
export function mergeHostedRoomEvents(existing: RoomEvent[], incoming: RoomEvent[]): RoomEvent[] {
  const byId = new Map<string, RoomEvent>()
  const bySeq = new Map<number, RoomEvent>()

  for (const event of [...existing, ...incoming]) {
    if (!event || !Number.isInteger(event.seq) || !event.event_id) {
      continue
    }

    if (!byId.has(event.event_id) && !bySeq.has(event.seq)) {
      byId.set(event.event_id, event)
      bySeq.set(event.seq, event)
    }
  }

  return [...bySeq.values()].sort((left, right) => left.seq - right.seq)
}

function eventTime(createdAt: number): number {
  return createdAt < 1_000_000_000_000 ? createdAt * 1000 : createdAt
}

export function projectHostedRoomEvents(events: RoomEvent[], members: GroupMember[]): HostedRoomEntry[] {
  const out: HostedRoomEntry[] = []

  for (const event of mergeHostedRoomEvents([], events)) {
    const payload = event.payload || {}

    if (event.kind !== 'message.user' && event.kind !== 'message.member') {
      continue
    }

    const memberId = String(payload.member_id)

    const member =
      event.kind === 'message.member'
        ? members.find(candidate => memberKey(candidate) === memberId || String(candidate.name) === memberId)
        : undefined

    const text = typeof payload.text === 'string' ? payload.text : ''

    if (!text) {
      continue
    }

    const source = member?.connectionLabel || member?.connectionId

    const from = member
      ? {
          kind: 'member' as const,
          name: member.name,
          ...(source ? { source } : {})
        }
      : { kind: 'user' as const, name: 'You' }

    out.push({
      at: eventTime(Number(event.created_at) || 0),
      eventId: event.event_id,
      from,
      id: event.event_id,
      seq: event.seq,
      text,
      thread: String(payload.thread_id || 'legacy')
    })
  }

  return out
}

function activeMemberFromEvents(events: RoomEvent[]): null | string {
  const active = new Map<string, RoomEvent>()

  for (const event of events) {
    const taskId = String(event.payload?.task_id || '')

    if (!taskId) {
      continue
    }

    if (event.kind === 'turn.started') {
      active.set(taskId, event)
    } else if (
      event.kind === 'turn.settled' ||
      event.kind === 'turn.failed' ||
      event.kind === 'turn.cancelled' ||
      event.kind === 'turn.deferred'
    ) {
      active.delete(taskId)
    }
  }

  const latest = [...active.values()].sort((a, b) => a.seq - b.seq)

  return latest.length ? String(latest[latest.length - 1].payload.member_id || '') || null : null
}

function routedMember(member: GroupMember): GroupMember {
  return {
    ...member,
    sourceScoped: true,
    route: member.route || {
      connectionId: 'local',
      mode: 'local',
      profile: member.name,
      targetProfile: member.targetProfile || member.name
    }
  } as GroupMember
}

function roomRequest(member: GroupMember, request?: HostedRoomRequest) {
  const target = routedMember(member)

  return (method: string, params: Record<string, unknown>) => {
    const wireParams = { ...params, profile: target.targetProfile || target.name }

    return request ? request(method, wireParams) : requestForBot(target, method, wireParams)
  }
}

function roomMemberInputs(members: GroupMember[]) {
  const meta = $botMeta.get()

  return members.map(member => {
    const resolved = botRosterMeta(member, meta)
    const name = displayName(member, resolved)

    return {
      member_id: memberKey(member),
      profile: memberKey(member),
      handle: botHandle(member.name, member),
      display_name: name
    }
  })
}

/** The local profile allowed to call this room's backend owner after a roster edit. */
export function hostedRoomOwnerMember(room: GroupChat, members: GroupMember[]): GroupMember | null {
  const owner = String(room.hostedRoomOwner || '')
  const existing = members.find(member => localMember(member) && memberKey(member) === owner)

  if (existing) {
    return existing
  }

  if (owner) {
    return {
      connectionId: 'local',
      name: owner,
      targetProfile: owner
    }
  }

  return members.find(localMember) || null
}

/**
 * Initialize the backend room idempotently. The caller provides the durable
 * room object so old local rooms acquire their existing room id, never a new
 * backend transcript identity.
 */
export async function ensureHostedRoom(
  group: string,
  roomValue: GroupChat,
  members: GroupMember[],
  request?: HostedRoomRequest,
  refresh = false
): Promise<HostedRoomView> {
  let room = roomValue as GroupChatRoom

  if (!room.roomId) {
    const roomId = mintGroupRoomId()
    room = updateGroupChat(group, current => ({ ...current, roomId })) as GroupChatRoom
  }

  const roomId = String(room.roomId)
  const alreadyCreated = hostedRoomWasCreated(room)
  const candidate = roomDriveMode(room, members, { capabilities: { driver: true }, status: 'ready' })

  if (!alreadyCreated && candidate !== 'hosted') {
    return setView(roomId, current => ({ ...current, status: 'client', error: null }))
  }

  if (
    !refresh &&
    (viewFor(roomId).status === 'ready' ||
      (viewFor(roomId).status === 'client' && !viewFor(roomId).error))
  ) {
    return viewFor(roomId)
  }

  const flight = ensureFlights.get(roomId)

  if (flight) {
    return flight
  }

  const initialize = (async () => {
    setView(roomId, current => ({ ...current, status: 'checking', error: null }))
    const owner = hostedRoomOwnerMember(room, members)

    if (!owner) {
      return setView(roomId, current => ({ ...current, status: 'client', error: null }))
    }

    const target = routedMember(owner)
    const call = roomRequest(target, request)

    try {
      const capabilities = (await call('groups.capabilities', {})) as GroupsCapabilitiesResult

      if (!capabilities?.driver) {
        return setView(roomId, current => ({
          ...current,
          capabilities: capabilities || null,
          status: 'client',
          error: null
        }))
      }

      if (!alreadyCreated) {
        await call('groups.create', {
          room_id: roomId,
          name: group,
          members: roomMemberInputs(members)
        })
        room = updateGroupChat(
          group,
          current => ({
            ...current,
            hostedRoomCreated: true,
            hostedRoomOwner: owner.targetProfile || owner.name
          }),
          { sync: false }
        ) as GroupChatRoom
      }

      const checkpoint = loadHostedRoomCheckpoint(roomId)

      return setView(roomId, current => ({
        ...current,
        capabilities,
        cursor: Math.max(current.cursor, checkpoint.cursor),
        entries: current.entries.length
          ? current.entries
          : projectHostedRoomEvents(checkpoint.events, members),
        status: 'ready',
        error: null
      }))
    } catch (error) {
      return setView(roomId, current => ({
        ...current,
        status: 'client',
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  })()

  ensureFlights.set(roomId, initialize)

  try {
    return await initialize
  } finally {
    if (ensureFlights.get(roomId) === initialize) {
      ensureFlights.delete(roomId)
    }
  }
}

/** Paint one committed backend event into the mounted view and its reload cache. */
export function recordHostedRoomEvent(roomId: string, event: RoomEvent, members: GroupMember[]): void {
  const checkpoint = loadHostedRoomCheckpoint(roomId)
  const events = mergeHostedRoomEvents(checkpoint.events, [event])
  const cursor = Math.max(checkpoint.cursor, viewFor(roomId).cursor, event.seq)

  persistHostedRoomCheckpoint(roomId, { cursor, events })
  setView(roomId, current => ({
    ...current,
    activeMemberId: activeMemberFromEvents(events),
    cursor,
    entries: projectHostedRoomEvents(events, members)
  }))
}

export async function sendHostedRoomMessage(
  roomId: string,
  member: GroupMember,
  text: string,
  threadId: string,
  eventId: string,
  request?: HostedRoomRequest
): Promise<RoomEvent> {
  const call = roomRequest(routedMember(member), request)

  const params = {
    room_id: roomId,
    event_id: eventId,
    payload: { text, thread_id: threadId }
  }

  // Reusing this client id makes the retry safe if the backend committed the
  // event but the response was lost.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = (await call('groups.send', params)) as { event?: RoomEvent }

      if (!result?.event) {
        throw new Error('The hosted room did not return its committed event.')
      }

      return result.event
    } catch (error) {
      if (attempt > 0) {
        throw error
      }
    }
  }
}

export function newHostedRoomEventId(): string {
  return globalThis.crypto?.randomUUID?.() || `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export async function stopHostedRoom(roomId: string, member: GroupMember): Promise<void> {
  await roomRequest(routedMember(member))('groups.stop', { room_id: roomId })
}

export async function renameHostedRoom(
  roomId: string,
  member: GroupMember,
  name: string,
  eventId = newHostedRoomEventId()
): Promise<void> {
  const call = roomRequest(routedMember(member))
  const params = { room_id: roomId, name, event_id: eventId }

  for (let attempt = 0; ; attempt += 1) {
    try {
      await call('groups.rename', params)

      return
    } catch (error) {
      if (attempt > 0) {
        throw error
      }
    }
  }
}

export async function disbandHostedRoom(roomId: string, member: GroupMember): Promise<void> {
  await roomRequest(routedMember(member))('groups.disband', { room_id: roomId })
}

export async function answerHostedRoomApproval(
  roomId: string,
  member: GroupMember,
  action: HostedRoomAction,
  choice: string
): Promise<void> {
  const requestId = String(action.request_id || '')
  const memberId = String(action.member_id || '')

  if (!requestId || !memberId || !['once', 'deny'].includes(choice)) {
    throw new Error('The room approval is no longer available.')
  }

  await roomRequest(routedMember(member))('groups.approve', {
    room_id: roomId,
    member_id: memberId,
    task_id: String(action.task_id || ''),
    execution_generation: Number(action.execution_generation) || 0,
    choice,
    request_id: requestId
  })
}

export async function retryHostedRoomTask(
  roomId: string,
  member: GroupMember,
  action: HostedRoomAction
): Promise<void> {
  const taskId = String(action.task_id || '')

  if (!taskId) {
    throw new Error('The room task is no longer retryable.')
  }

  await roomRequest(routedMember(member))('groups.retry', { room_id: roomId, task_id: taskId })
}

function projectPageStatus(
  roomId: string,
  events: RoomEvent[],
  status: RoomDriverStatus | null,
  members: GroupMember[],
  cursor: number
) {
  const activeMemberId = activeMemberFromEvents(events)
  const entries = projectHostedRoomEvents(events, members)

  setView(roomId, current => ({
    ...current,
    activeMemberId,
    cursor: Math.max(current.cursor, cursor),
    driverStatus: status,
    entries,
    status: 'ready',
    error: null
  }))
}

async function pollHostedRoom(
  roomId: string,
  member: GroupMember,
  members: GroupMember[],
  request?: HostedRoomRequest
): Promise<void> {
  const existingFlight = pollFlights.get(roomId)

  if (existingFlight) {
    return existingFlight
  }

  const poll = (async () => {
    const call = roomRequest(routedMember(member), request)
    const previousCursor = viewFor(roomId).cursor

    const [stateResult, checkpoint] = await Promise.all([
      call('groups.state', { room_id: roomId }) as Promise<GroupsStateResult>,
      Promise.resolve(loadHostedRoomCheckpoint(roomId))
    ])

    let events = checkpoint.events
    let cursor = Math.max(viewFor(roomId).cursor, checkpoint.cursor)
    let page: GroupsLogResult

    do {
      const previousPageCursor = cursor
      page = (await call('groups.log', {
        room_id: roomId,
        since_seq: cursor,
        limit: LOG_PAGE_SIZE
      })) as GroupsLogResult
      events = mergeHostedRoomEvents(events, page.events || [])
      cursor = Math.max(cursor, Number(page.cursor) || 0)

      if (page.has_more && cursor <= previousPageCursor) {
        throw new Error('The hosted room log did not advance its cursor.')
      }
    } while (page.has_more)

    const next = { cursor, events }

    persistHostedRoomCheckpoint(roomId, next)
    projectPageStatus(roomId, events, stateResult.driver_status || null, members, cursor)

    const latestNewUserSeq = [...events].reverse().find(event => event.kind === 'message.user')?.seq || 0

    const latestNewYouMention = [...events].reverse().find(
      event =>
        event.kind === 'message.member' &&
        event.seq > previousCursor &&
        event.seq > latestNewUserSeq &&
        /@user\b/i.test(String(event.payload?.text || ''))
    )

    if (latestNewYouMention) {
      const groupName = String((stateResult.room as { name?: unknown })?.name || '')

      if (groupName) {
        // Existing room attention is cleared by the room-open/user-send paths.
        // This only raises attention when a hosted member asks for the user.
        $groupNeedsYou.set({ ...$groupNeedsYou.get(), [groupName]: true })
      }
    }
  })()

  pollFlights.set(roomId, poll)

  try {
    await poll
  } finally {
    if (pollFlights.get(roomId) === poll) {
      pollFlights.delete(roomId)
    }
  }
}

/** Start polling only for a mounted, visible room surface. */
export function watchHostedRoom(options: HostedRoomWatchOptions): () => void {
  const { group, members, request } = options
  let room = options.room

  if (!room.roomId) {
    if (!hostedEligible(room, members)) {
      return () => undefined
    }

    room = updateGroupChat(group, current => ({ ...current, roomId: mintGroupRoomId() }))
  }

  const roomId = String(room.roomId)
  const watcherId = (watchers.get(roomId) || 0) + 1
  watchers.set(roomId, watcherId)
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let attemptedInitialization = false
  const member = hostedRoomOwnerMember(room, members)

  const poll = async () => {
    if (stopped || !member) {
      return
    }

    try {
      const view = await ensureHostedRoom(group, room, members, request, !attemptedInitialization)
      attemptedInitialization = true

      if (view.status === 'ready') {
        await pollHostedRoom(roomId, member, members, request)
      }
    } catch (error) {
      setView(roomId, current => ({
        ...current,
        error: error instanceof Error ? error.message : String(error)
      }))
    }

    if (!stopped) {
      const interval = viewFor(roomId).driverStatus?.working ? 1000 : 5000
      timer = setTimeout(() => void poll(), interval)
    }
  }

  void poll()

  return () => {
    stopped = true

    if (timer !== null) {
      clearTimeout(timer)
    }

    if (watchers.get(roomId) === watcherId) {
      watchers.delete(roomId)
    }
  }
}

export function hostedRoomApprovalActions(view: HostedRoomView): HostedRoomAction[] {
  return (view.driverStatus?.pending_actions || []).filter(
    (action): action is HostedRoomAction => isRecord(action) && action.kind === 'approval'
  )
}

export function hostedRoomApprovalPrompts(group: string, view: HostedRoomView): GroupPrompt[] {
  const actions = hostedRoomApprovalActions(view)

  return actions.flatMap(raw => {
    if (!isRecord(raw) || raw.kind !== 'approval') {
      return []
    }

    const approval = isRecord(raw.approval) ? raw.approval : {}
    const requestId = String(raw.request_id || approval.request_id || '')
    const memberId = String(raw.member_id || '')

    if (!requestId || !memberId) {
      return []
    }

    const choices = Array.isArray(approval.choices)
      ? approval.choices.filter((choice): choice is string => choice === 'once' || choice === 'deny')
      : []

    return [
      {
        at: Date.now(),
        command: typeof approval.command === 'string' ? approval.command : '',
        choices: choices.length ? choices : ['once', 'deny'],
        group,
        kind: 'approval' as const,
        member: String(approval.profile || memberId),
        memberKey: memberId,
        question: String(approval.message || approval.command || ''),
        requestId,
        sessionId: typeof raw.session_id === 'string' ? raw.session_id : null,
        thread: typeof raw.thread_id === 'string' && raw.thread_id ? raw.thread_id : 'legacy'
      }
    ]
  })
}

export function hostedRoomRetryActions(view: HostedRoomView): HostedRoomAction[] {
  return (view.driverStatus?.pending_actions || []).filter(
    (action): action is HostedRoomAction => isRecord(action) && action.kind === 'retry'
  )
}

export function hostedRoomRequestForTest(
  member: GroupMember,
  method: string,
  params: Record<string, unknown>,
  request: HostedRoomRequest
) {
  return roomRequest(routedMember(member), request)(method, params)
}
