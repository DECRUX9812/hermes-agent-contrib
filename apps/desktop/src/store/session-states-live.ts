import { atom, computed } from 'nanostores'

import type { ClientSessionState } from '@/app/types'
import { type ChatMessage, chatMessageText, finalizeInterruptedMessages, sealOpenToolParts } from '@/lib/chat-messages'
import type { ErrorSurface } from '@/lib/error-surface'
import { stableArray, stableRecord } from '@/lib/stable-array'
import type { SessionInfo } from '@/types/hermes'

import { adoptPendingRuntimeTabs, rekeyPreviewTabsSession } from './preview'
import { forgetPendingRuntimeTabs } from './preview-ownership'
import { $projectTree } from './project-tree'
import { clearAllProviderWaits, clearSessionProviderWait } from './provider-wait'
import {
  $activeSessionId,
  $cronSessions,
  $currentCwd,
  $lastReadAtBySessionId,
  $messagingSessions,
  $selectedStoredSessionId,
  $sessions,
  $unlistedSessionOwnerRows,
  $workspaceCwdOwner,
  clearReadBaseline,
  lineageAliases,
  ownerLookupSessionRows,
  sessionMatchesStoredId,
  setActiveSessionStoredIdRotation,
  setAwaitingResponse,
  setBusy,
  setTurnStartedAt
} from './session'
import { runtimeSessionOwner, sessionOwnerByRuntimeId, sessionScopeByRuntimeId } from './session-states-owners'
import { requestForOwnedSession } from './session-states-routing'
import {
  $focusedRuntimeId,
  $focusedStoredSessionId,
  $sessionTiles,
  isSessionInForeground,
  rekeySessionTile,
  sessionTileDelegate
} from './session-states-tiles-core'
import { markSessionUnreadFinished } from './session-unread'

// ---------------------------------------------------------------------------
// Reactive per-runtime session state (view mirror of the wiring cache).
// ---------------------------------------------------------------------------

export const $sessionStates = atom<Record<string, ClientSessionState>>({})

// A session's reported skill set by STORED id — the zone-strip skill chip's
// lookup. `state.skills` is already reference-stable per session (the ingest
// path swaps it only on change), so the `stableRecord` projection emits only
// when a set actually flips — not per message delta. Claimed under every
// lineage alias so a surface holding a pre-compression tip still resolves.
let skillsByStoredId: Readonly<Record<string, Record<string, string[]>>> = {}

export const $skillsByStoredId = computed([$sessionStates, $sessions], (states, sessions) => {
  const next: Record<string, Record<string, string[]>> = {}

  for (const state of Object.values(states)) {
    if (!state?.storedSessionId) {
      continue
    }

    for (const alias of lineageAliases(state.storedSessionId, sessions)) {
      next[alias] = state.skills
    }
  }

  return (skillsByStoredId = stableRecord(skillsByStoredId, next))
})

// Stored session ids whose authoritative state is still busy, but whose
// runtime has produced no state publish for the watchdog window. Silence is
// not completion: long tool calls can legitimately stay quiet, so this is a
// presentation hint and never mutates the backend-derived busy state.
export const $stalledSessionIds = atom<string[]>([])

// In-flight `reconcileBusyStatesOnReconnect` count. A reload or gateway switch
// starts with no busy claim at all, and the window only learns what the backend
// still runs from the snapshot — so between the session list leaving its
// loading state and that snapshot landing, an absent claim is ignorance, not
// "idle". The queue drains wait on this (a count, because a primary boot
// reconcile and a secondary socket's reopen can overlap): draining on ignorance
// submits a queued follow-up into a live run.
export const $busyClaimsPending = atom(0)

export function setSessionStalled(storedSessionId: string | null | undefined, stalled: boolean) {
  if (!storedSessionId) {
    return
  }

  const current = $stalledSessionIds.get()
  const present = current.includes(storedSessionId)

  if (stalled && !present) {
    $stalledSessionIds.set([...current, storedSessionId])
  } else if (!stalled && present) {
    $stalledSessionIds.set(current.filter(id => id !== storedSessionId))
  }
}

// --- Watchdog: marks busy sessions quiet after a long stream silence -------
// Tuned against what this app actually does rather than a round number: a
// typecheck or a full test run here goes quiet for minutes at a stretch and is
// perfectly healthy, so anything under ~4 min would paint normal work as
// suspect. Eight minutes was the other failure — longer than a user is willing
// to sit and wonder, so the hint arrived after they had already given up on it.
export const SESSION_WATCHDOG_TIMEOUT_MS = 5 * 60 * 1000

// A live turn that goes this long without a session event is checked against
// its backend. Silence alone proves nothing: a foreground tool emits nothing
// between tool.start and tool.complete, a local model can prefill for minutes,
// and the live-status poll that also resets this clock pauses while the window
// is not viewed and slows to 2 min on battery. Only the backend decides whether
// the turn is over (see onEventSilence).
export const LIVE_TURN_EVENT_SILENCE_MS = 45_000
// Bound on the status request itself; past it the check counts as unanswered.
export const LIVE_TURN_PROBE_TIMEOUT_MS = 15_000
const sessionEventSilenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
// One token per status check in flight: an event, a settle, or a newer check
// drops it, so a late answer cannot act on a turn that moved on.
const silentTurnChecks = new Map<string, object>()

type AmbientGatewayRequest = <R>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<R>

interface LiveTurnBackend {
  /** The window's gateway requester; the check routes through the session's
   *  owner, so this only answers for sessions it provably owns. */
  request: AmbientGatewayRequest
  /** Pull the stored transcript for an on-screen session whose turn the
   *  backend reported ended, so a reply that finished there shows up here. */
  refreshTranscript?: (runtimeId: string, storedSessionId: string) => Promise<unknown> | unknown
}

let liveTurnBackend: LiveTurnBackend | null = null

/** Register the backend a silent live turn is checked against. Returns the
 *  unregister function; with nothing registered, a silent turn is left alone. */
export function setLiveTurnBackend(backend: LiveTurnBackend): () => void {
  liveTurnBackend = backend

  return () => {
    if (liveTurnBackend === backend) {
      liveTurnBackend = null
    }
  }
}

function clearEventSilence(runtimeId: string) {
  const timer = sessionEventSilenceTimers.get(runtimeId)

  silentTurnChecks.delete(runtimeId)

  if (timer) {
    clearTimeout(timer)
    sessionEventSilenceTimers.delete(runtimeId)
  }
}

export function isLiveTurnAwaitingEvents(state: ClientSessionState | undefined): boolean {
  return Boolean(state && (state.busy || state.awaitingResponse || state.turnLive) && !state.needsInput)
}

export type LiveTurnVerdict = 'ended' | 'running' | 'unknown'

interface LiveTurnStatusResponse {
  sessions?: { id?: string; status?: string }[]
}

/** What one `session.active_list` snapshot says about `runtimeId`'s turn. A
 *  runtime missing from a well-formed list has been reaped: its turn is over.
 *  `starting` is an agent build for a turn the backend accepted. */
export function liveTurnVerdict(
  response: LiveTurnStatusResponse | null | undefined,
  runtimeId: string
): LiveTurnVerdict {
  if (!Array.isArray(response?.sessions)) {
    return 'unknown'
  }

  const status = response.sessions.find(session => session.id?.trim() === runtimeId)?.status

  if (status === undefined || status === 'idle') {
    return 'ended'
  }

  return status === 'starting' || status === 'waiting' || status === 'working' ? 'running' : 'unknown'
}

async function checkLiveTurn(runtimeId: string): Promise<LiveTurnVerdict> {
  const backend = liveTurnBackend

  if (!backend) {
    return 'unknown'
  }

  try {
    // Owner-routed: a turn in another profile's pane is answered by the
    // backend running it, not by whichever gateway this window shows. An
    // unresolved owner throws, which counts as no answer.
    const response = await requestForOwnedSession<LiveTurnStatusResponse>(
      runtimeId,
      backend.request,
      'session.active_list',
      {},
      LIVE_TURN_PROBE_TIMEOUT_MS
    )

    return liveTurnVerdict(response, runtimeId)
  } catch {
    return 'unknown'
  }
}

/** Write through the wiring cache when it holds the runtime, so the cache,
 *  the focused view, and tile mirrors agree (#93059); otherwise the mirror. */
function writeSessionState(runtimeId: string, updater: (state: ClientSessionState) => ClientSessionState) {
  if (sessionTileDelegate()?.updateHeldSession?.(runtimeId, updater)) {
    return
  }

  const current = $sessionStates.get()[runtimeId]

  if (current) {
    publishSessionState(runtimeId, updater(current))
  }
}

/** The backend reported the turn over and its end events never arrived. Settle
 *  it like the running=false edge: nothing is interrupted, the kept stream
 *  bubble is remembered so a late message.complete settles onto it. */
function settleEndedLiveTurn(runtimeId: string) {
  const occurredAt = Date.now() / 1000

  writeSessionState(runtimeId, state => {
    if (!isLiveTurnAwaitingEvents(state)) {
      return state
    }

    const messages = sealOpenToolParts(finalizeInterruptedMessages(state.messages, state.streamId, occurredAt))

    return {
      ...state,
      awaitingResponse: false,
      busy: false,
      heartbeatSettledStreamId:
        state.streamId && messages.some(message => message.id === state.streamId) ? state.streamId : null,
      messages,
      pendingBranchGroup: null,
      streamId: null,
      turnLive: false,
      turnStartedAt: null
    }
  })
}

// Raised only after the backend confirmed the turn is over and no reply reached
// this window, so Retry cannot run the prompt twice.
const NO_REPLY_SURFACE: ErrorSurface = { code: 'no_reply', layer: 'runtime', retryable: true }
const NO_REPLY_ERROR = 'Hermes ended this turn without a reply.'

function turnHasReply(messages: ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message.hidden) {
      continue
    }

    if (message.role === 'user') {
      return false
    }

    if (message.role === 'assistant' && (message.error || chatMessageText(message).trim())) {
      return true
    }
  }

  return false
}

function withNoReplyNotice(messages: ChatMessage[]): ChatMessage[] {
  const last = messages.findLast(message => !message.hidden)

  // A turn that ran tools but never wrote text carries the notice on its own bubble.
  if (last?.role === 'assistant') {
    return messages.map(message =>
      message === last ? { ...message, error: NO_REPLY_ERROR, errorSurface: NO_REPLY_SURFACE } : message
    )
  }

  const occurredAt = Date.now() / 1000

  return [
    ...messages,
    {
      completedAt: occurredAt,
      error: NO_REPLY_ERROR,
      errorSurface: NO_REPLY_SURFACE,
      id: `assistant-no-reply-${Date.now()}`,
      parts: [],
      pending: false,
      role: 'assistant',
      timestamp: occurredAt
    }
  ]
}

/** Stamp the retry card on an ended turn that has no reply. A newer turn the
 *  user started meanwhile is either live (skipped) or has its own reply. */
function markTurnWithoutReply(runtimeId: string) {
  writeSessionState(runtimeId, state =>
    state.interrupted || isLiveTurnAwaitingEvents(state) || turnHasReply(state.messages)
      ? state
      : { ...state, messages: withNoReplyNotice(state.messages) }
  )
}

async function recoverEndedLiveTurn(runtimeId: string) {
  const storedSessionId = $sessionStates.get()[runtimeId]?.storedSessionId ?? null
  const refreshTranscript = liveTurnBackend?.refreshTranscript

  // Only a session on screen reads its history now; a background session
  // reads it when the user opens it, like the running=false edge.
  if (refreshTranscript && storedSessionId && runtimeReferenced(runtimeId, storedSessionId)) {
    try {
      await refreshTranscript(runtimeId, storedSessionId)
    } catch {
      // The local transcript still decides whether a reply arrived.
    }
  }

  markTurnWithoutReply(runtimeId)
}

/** The silence window ran out: ask the backend. Running keeps the turn and
 *  restarts the clock; no answer (gateway down, request failed, owner unknown)
 *  also keeps it — the stall hint and Stop remain — and asks again next window.
 *  Only a backend that reports the turn over settles it. */
async function onEventSilence(runtimeId: string) {
  sessionEventSilenceTimers.delete(runtimeId)

  if (!isLiveTurnAwaitingEvents($sessionStates.get()[runtimeId])) {
    return
  }

  const check = {}
  silentTurnChecks.set(runtimeId, check)
  const verdict = await checkLiveTurn(runtimeId)

  if (silentTurnChecks.get(runtimeId) !== check) {
    return
  }

  silentTurnChecks.delete(runtimeId)

  if (verdict !== 'ended') {
    noteSessionEvent(runtimeId)

    return
  }

  settleEndedLiveTurn(runtimeId)
  await recoverEndedLiveTurn(runtimeId)
}

/** Record that this session just produced an event. A live turn that then goes
 *  silent is checked against its backend; a turn still receiving events, or
 *  waiting on the user, is not. */
export function noteSessionEvent(runtimeId: string) {
  if (!runtimeId) {
    return
  }

  const current = $sessionStates.get()[runtimeId]

  clearEventSilence(runtimeId)

  if (!isLiveTurnAwaitingEvents(current)) {
    return
  }

  sessionEventSilenceTimers.set(
    runtimeId,
    setTimeout(() => void onEventSilence(runtimeId), LIVE_TURN_EVENT_SILENCE_MS)
  )
}

const sessionWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()

function armWatchdog(runtimeId: string) {
  const existing = sessionWatchdogTimers.get(runtimeId)

  if (existing) {
    clearTimeout(existing)
  }

  sessionWatchdogTimers.set(
    runtimeId,
    setTimeout(() => {
      sessionWatchdogTimers.delete(runtimeId)
      const current = $sessionStates.get()[runtimeId]

      if (current?.busy) {
        setSessionStalled(current.storedSessionId, true)
      }
    }, SESSION_WATCHDOG_TIMEOUT_MS)
  )
}

function clearWatchdog(runtimeId: string) {
  const t = sessionWatchdogTimers.get(runtimeId)

  if (t) {
    clearTimeout(t)
    sessionWatchdogTimers.delete(runtimeId)
  }
}

// --- Settle grace: keeps a just-finished session in the sidebar merge set ---
const SESSION_SETTLE_GRACE_MS = 30 * 1000

const settledExpiry = new Map<string, number>()

function markSettled(storedId: string) {
  settledExpiry.set(storedId, Date.now() + SESSION_SETTLE_GRACE_MS)
}

function clearSettled(storedId: string) {
  settledExpiry.delete(storedId)
}

/** Stored ids whose turn ended within the grace window. Prunes expired. */
export function getRecentlySettledSessionIds(now: number = Date.now()): string[] {
  const live: string[] = []

  for (const [id, expiry] of settledExpiry) {
    if (expiry > now) {
      live.push(id)
    } else {
      settledExpiry.delete(id)
    }
  }

  return live
}

// --- Transition detection (called automatically from publishSessionState) ---
function handleTransition(previous: ClientSessionState | null, next: ClientSessionState, runtimeId: string) {
  // Compression id rotation: signal the route-follow effect with enough
  // provenance (previous id + runtime) that the consumer can reject the event
  // if the user navigated elsewhere before React handled it. A bare next id
  // could let a background session's delayed rotation steal the foreground
  // route. Re-validate against the current route/selection, not just the
  // runtime id, so a fast A -> B switch while A is still busy does not get
  // pulled back to A's new tip (#86106).
  if (previous?.storedSessionId && next.storedSessionId && previous.storedSessionId !== next.storedSessionId) {
    if (runtimeId === $activeSessionId.get() && isSessionInForeground(previous.storedSessionId)) {
      setActiveSessionStoredIdRotation({
        nextStoredSessionId: next.storedSessionId,
        previousStoredSessionId: previous.storedSessionId,
        runtimeSessionId: runtimeId
      })
    }

    // Re-home any open tile keyed on the pre-rotation id to the new tip so the
    // conversation keeps ONE pane (#98622). Not gated on the active runtime:
    // a background tile's conversation rotates too, and its pane would
    // otherwise keep the stale id forever (duplicate/differently-titled tabs).
    rekeySessionTile(previous.storedSessionId, next.storedSessionId, runtimeId)
    // The conversation's preview tabs follow it onto the new tip (#73890).
    rekeyPreviewTabsSession(previous.storedSessionId, next.storedSessionId)

    clearSettled(previous.storedSessionId)
    setSessionStalled(previous.storedSessionId, false)
  }

  // THIS runtime's stored id binding: the preview tabs it opened before then
  // are now its session's (#73890).
  if (!previous?.storedSessionId && next.storedSessionId) {
    adoptPendingRuntimeTabs(runtimeId, next.storedSessionId)
  }

  // Every busy publish is stream activity: clear the quiet hint and restart
  // the silence window. A real terminal transition clears both the timer and
  // any hint, but only that authoritative transition clears working/busy.
  if (next.busy) {
    setSessionStalled(next.storedSessionId, false)
    armWatchdog(runtimeId)
  } else {
    clearWatchdog(runtimeId)

    if (!isLiveTurnAwaitingEvents(next)) {
      clearEventSilence(runtimeId)
    }

    setSessionStalled(next.storedSessionId, false)
    setSessionStalled(previous?.storedSessionId, false)
  }

  const storedId = next.storedSessionId

  if (!storedId) {
    return
  }

  const wasWorking = previous?.busy ?? false

  if (next.busy && !wasWorking) {
    clearSettled(storedId)
    // The turn is live (or a new one starts): a reconnect downgrade that was
    // waiting for the snapshot's verdict was a socket blip, not a completion.
    unconfirmedReconnectSettles.delete(storedId)
    // A NEW turn is starting: the read baseline guarded the PREVIOUS
    // completion's re-asserts. Dropping it here means this turn's finish
    // re-lights even if it lands within the same millisecond as the last
    // read (same-tick submit → finish in tests and fast local models).
    clearReadBaseline(storedId)
  } else if (!next.busy && wasWorking) {
    markSettled(storedId)

    // A PRIMARY reconnect reconcile is not a terminal event: it downgrades
    // EVERY busy claim on the socket, live turns included, so lighting the dot
    // here is the false green of #113029. Park the completion until the
    // post-reconnect `session.active_list` snapshot confirms the turn is gone
    // (or a re-assert proves it alive). A SCOPED (secondary/background-profile)
    // reconcile lights immediately: the active profile's poll never lists that
    // socket's runtimes, so a parked completion there would have no confirm
    // producer and a turn that ended while the socket was down would never
    // earn its dot.
    if (deferringReconcileUnread) {
      unconfirmedReconnectSettles.set(storedId, runtimeId)

      return
    }

    lightUnreadCompletion(storedId, runtimeId)
  }
}

/** Mark a completed turn unread unless the user is already looking at it. */
function lightUnreadCompletion(storedId: string, runtimeId?: string) {
  // FOCUSED, not selected: a session finishing in the tile the user is
  // watching is already seen, and a tile is never the primary selection.
  if (storedId === $focusedStoredSessionId.get()) {
    return
  }

  // Re-light only genuinely new completions: if the user already viewed
  // this session (or its family) at or after this settle moment, a
  // re-assert of the same completion must not re-arm the dot. `-1` for
  // "never read" (not `0`) so fake-timer tests pinned to t=0 still light.
  const lastReadAt = $lastReadAtBySessionId.get()[storedId] ?? -1

  if (Date.now() > lastReadAt) {
    // Flags the transient atom AND persists a marker, so the green dot
    // survives an app restart (see session-unread.ts). The marker's profile
    // bucket comes from the loaded row when there is one; with no row, the
    // socket-proven owner profile keeps a background profile's finish out of
    // the ACTIVE profile's bucket — the per-profile rail unread (#91710)
    // would otherwise light the wrong square.
    const owner = runtimeId ? runtimeSessionOwner(runtimeId) : undefined

    const profileHint =
      typeof owner === 'string'
        ? owner
        : typeof owner?.profile === 'string' && owner.profile.trim()
          ? owner.profile
          : undefined

    markSessionUnreadFinished(storedId, profileHint)
  }
}

/** Stored ids whose busy claim a PRIMARY reconnect reconcile retired without
 *  any proof the turn ended — mapped to their runtime id so a later confirm
 *  can still consult the socket-proven owner (the unread marker's profile
 *  bucket). The authoritative post-reconnect snapshot settles each one:
 *  `confirmReconnectSettlesExcept` when the runtime is idle or gone, a busy
 *  re-assert (stream event or `working` row) when the turn is still live. */
const unconfirmedReconnectSettles = new Map<string, string>()

let deferringReconcileUnread = false

/** A fresh authoritative snapshot arrived: every parked completion whose
 *  session it does not report as still working is over and earns its unread
 *  dot. The parked set itself is the eligibility list — a turn that started
 *  just before the drop was never polled, so "seen live last poll" cannot be
 *  the gate. Pass an empty set when no snapshot can be had (old gateway): a
 *  parked completion with no confirm producer must fall back to lighting
 *  rather than never lighting. No-op when nothing is parked. */
export function confirmReconnectSettlesExcept(workingStoredIds: ReadonlySet<string>) {
  for (const [storedId, runtimeId] of unconfirmedReconnectSettles) {
    if (!workingStoredIds.has(storedId)) {
      unconfirmedReconnectSettles.delete(storedId)
      lightUnreadCompletion(storedId, runtimeId)
    }
  }
}

/** Is any surface on THIS window still holding the runtime — the primary view
 *  or an open tile? (A tile mid-resume references by stored id only; its
 *  runtime binding is patched in after `resumeTile` returns.) */
function runtimeReferenced(runtimeId: string, storedSessionId: null | string): boolean {
  if (runtimeId === $activeSessionId.get()) {
    return true
  }

  return $sessionTiles
    .get()
    .some(t => t.runtimeId === runtimeId || (storedSessionId !== null && t.storedSessionId === storedSessionId))
}

/** A state no surface needs anymore: its turn is over (not busy, not waiting
 *  on the user) and neither the primary view nor any tile holds the runtime.
 *  `needsInput` states stay — the sidebar's attention dot reads them. */
export function evictable(runtimeId: string, state: ClientSessionState): boolean {
  return (
    !state.busy && !state.needsInput && !state.awaitingResponse && !runtimeReferenced(runtimeId, state.storedSessionId)
  )
}

/** Publish one session's state. Automatically fires transition side-effects
 *  (watchdog arm/disarm, settle grace, unread marker, compression id rotation)
 *  by diffing previous vs next — callers never need to manually call a
 *  transition handler.
 *
 *  Skips the publish when the new state is identical to the existing one
 *  (same reference) to avoid churning `$sessionStates` on periodic
 *  `session.info` heartbeats that carry no change — otherwise every ~1/s
 *  heartbeat creates a new Record spread, triggering computed atoms
 *  ($workingSessionIds, $attentionSessionIds) and their subscribers
 *  unnecessarily. The runtime-id→state cache (sessionStateByRuntimeIdRef)
 *  is updated independently by the caller, so the visual path stays live
 *  without the store churn.
 *
 *  A settled state nothing references releases its transcript instead of
 *  republishing it. Gateway events keep flowing for sessions whose tile was
 *  closed mid-turn, and parking each one's full transcript here forever is the
 *  leak that made the app crawl after a day of tile use. Transition side
 *  effects still fire, so lightweight status and the unread dot survive. A
 *  FIRST publish always lands in full because a resume can publish its idle
 *  state a beat before `$activeSessionId` / the tile binding points at it. */
export function publishSessionState(runtimeId: string, state: ClientSessionState) {
  const current = $sessionStates.get()
  const prev = current[runtimeId] ?? null

  if (prev === state) {
    return
  }

  if (prev && evictable(runtimeId, state)) {
    handleTransition(prev, state, runtimeId)
    releaseSessionTranscript(runtimeId, state)

    return
  }

  $sessionStates.set({ ...current, [runtimeId]: state })
  handleTransition(prev, state, runtimeId)
}

/** Keep the cheap status projection for a cold session while releasing its
 * transcript. Unread completion is stored separately, so it survives too. */
export function releaseSessionTranscript(runtimeId: string, state?: ClientSessionState) {
  const current = $sessionStates.get()

  if (!(runtimeId in current)) {
    return
  }

  const retained = state ?? current[runtimeId]

  // Older persisted snapshots can contain an undefined state or omit the
  // messages field. Treat either shape as already cold instead of throwing
  // while memory pressure is being relieved.
  if (!retained) {
    return
  }

  const lightweight =
    Array.isArray(retained.messages) && retained.messages.length === 0 ? retained : { ...retained, messages: [] }

  $sessionStates.set({ ...current, [runtimeId]: lightweight })
}

export function dropSessionState(runtimeId: string) {
  // Disarm the watchdog — a dropped runtime must not fire a stale clear later.
  // Settle-grace entries are keyed by stored id and self-expire; leave them so
  // a just-finished session's row survives merge eviction even if its tile or
  // cached runtime is dropped in the meantime.
  clearWatchdog(runtimeId)
  clearEventSilence(runtimeId)
  clearSessionProviderWait(runtimeId)
  sessionScopeByRuntimeId.delete(runtimeId)
  sessionOwnerByRuntimeId.delete(runtimeId)
  // A runtime that never bound a stored id never will now (#73890).
  forgetPendingRuntimeTabs(runtimeId)

  const current = $sessionStates.get()
  setSessionStalled(current[runtimeId]?.storedSessionId, false)

  if (!(runtimeId in current)) {
    return
  }

  const { [runtimeId]: _dropped, ...rest } = current
  $sessionStates.set(rest)
}

/** Drop every cached session state — used on soft gateway-mode apply so the
 *  computed working / attention sets drain to empty alongside the session list.
 *  Also disarms every watchdog timer and drops all settle-grace entries: a
 *  wiped gateway's sessions must not fire stale clears or linger in the
 *  sidebar merge keep-set after the switch. */
export function clearAllSessionStates() {
  for (const timer of sessionWatchdogTimers.values()) {
    clearTimeout(timer)
  }

  sessionWatchdogTimers.clear()

  for (const timer of sessionEventSilenceTimers.values()) {
    clearTimeout(timer)
  }

  sessionEventSilenceTimers.clear()
  silentTurnChecks.clear()
  settledExpiry.clear()
  unconfirmedReconnectSettles.clear()
  clearAllProviderWaits()
  sessionScopeByRuntimeId.clear()
  sessionOwnerByRuntimeId.clear()
  forgetPendingRuntimeTabs()
  $stalledSessionIds.set([])
  $sessionStates.set({})
}

/** The live-run snapshot a reconnect reconcile trusts. `session.active_list`
 *  answers one row per live session: `id` is the runtime id (re-minted by a
 *  respawned backend) and `session_key` the durable id it is stored under. */
interface ActiveSessionRow {
  id?: unknown
  session_key?: unknown
  status?: unknown
}

interface RunningSession {
  needsInput: boolean
  runtimeId: string
  storedId: null | string
}

/** A request-only view of ONE socket, the one being reconnected. Kept
 *  non-generic so a caller can hand in a raw `gateway.request`: the snapshot
 *  is validated structurally below. */
type SessionStatusRequest = (
  method: string,
  params?: Record<string, unknown>,
  timeoutMs?: number
) => Promise<unknown>

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Does the snapshot still run this session, under either identity a cached
 *  state can answer to? A respawn re-mints the runtime id, never the durable
 *  stored key, so both are asked. */
const snapshotRuns = (running: ReadonlyMap<string, RunningSession>, ids: ReadonlyArray<null | string>): boolean =>
  ids.some(id => id !== null && running.has(id))

/** Which sessions the backend still runs, indexed under BOTH identities a
 *  cached state can answer to: the runtime id it was bound to and the durable
 *  stored key. `null` means no answer at all (a gateway without the method, an
 *  unreachable owner, a timeout) — silence is not proof that a turn ended. */
async function fetchRunningSessions(request: SessionStatusRequest): Promise<Map<string, RunningSession> | null> {
  try {
    const response = await request('session.active_list', {}, LIVE_TURN_PROBE_TIMEOUT_MS)
    const rows = (response as { sessions?: unknown } | null)?.sessions

    if (!Array.isArray(rows)) {
      return null
    }

    const running = new Map<string, RunningSession>()

    for (const row of rows as ActiveSessionRow[]) {
      const runtimeId = textValue(row?.id)
      const status = textValue(row?.status)

      // Only an explicit `idle` (or no status at all) is a finished turn: an
      // unrecognised status counts as running, the reading `liveTurnVerdict`
      // takes. Holding a claim the drain waits on is the safe direction to be
      // wrong in — a stale running arc corrects itself, an auto-drained send
      // into a live turn does not.
      if (!runtimeId || !status || status === 'idle') {
        continue
      }

      const live: RunningSession = {
        needsInput: status === 'waiting',
        runtimeId,
        storedId: textValue(row.session_key) || null
      }

      running.set(runtimeId, live)

      if (live.storedId) {
        running.set(live.storedId, live)
      }
    }

    return running
  } catch {
    return null
  }
}

/** Publish a busy claim for every session the snapshot still runs, under the
 *  runtime id the backend runs it as.
 *
 *  The mirror holds nothing for a session this window never opened, and
 *  nothing current after a reload (no mirror at all) or a respawn (its runtime
 *  ids are dead) — yet only a published state feeds $workingSessionIds, which
 *  is what the queue drains read before submitting a follow-up. A cached entry
 *  for the same durable session under an id the snapshot no longer lists is
 *  dropped first: it can never receive a settle event, so it would hold the
 *  session busy forever after the live claim cleared. */
async function claimRunningSessions(running: ReadonlyMap<string, RunningSession>) {
  const fresh = [...new Set(running.values())].filter(session => !$sessionStates.get()[session.runtimeId])

  if (fresh.length === 0) {
    return
  }

  // Loaded lazily: the state factory lives beside the chat runtime, and that
  // module's React component graph has no business in a store's import graph.
  const { createClientSessionState } = await import('@/lib/chat-runtime')
  const liveRuntimeIds = new Set([...running.values()].map(session => session.runtimeId))

  for (const session of fresh) {
    if (session.storedId) {
      for (const [cachedRuntimeId, cached] of Object.entries($sessionStates.get())) {
        // A scoped entry belongs to another socket's reconcile.
        if (
          cached?.storedSessionId === session.storedId &&
          !liveRuntimeIds.has(cachedRuntimeId) &&
          sessionScopeByRuntimeId.get(cachedRuntimeId) === undefined
        ) {
          dropSessionState(cachedRuntimeId)
        }
      }
    }

    publishSessionState(session.runtimeId, {
      ...createClientSessionState(session.storedId),
      busy: true,
      needsInput: session.needsInput,
      storedSessionId: session.storedId,
      turnLive: true
    })

    noteSessionEvent(session.runtimeId)
  }
}

/** Reconcile cached busy/awaiting states with the backend after a gateway
 *  reconnect, against the `session.active_list` snapshot taken through
 *  `request` (the socket being reconnected).
 *
 *  A respawned backend re-mints runtime ids (the same fact that drives
 *  resetTileRuntimeBindings), so a pre-reconnect `busy` can never receive its
 *  terminal `busy: false` publish — the runtime id it would arrive under is
 *  dead. Left alone, that state keeps its session in $workingSessionIds
 *  forever: the sidebar running arc and agents-panel "running" chrome lie for
 *  hours after the turn actually ended (#53902, #73082 — stale-flag half).
 *
 *  The opposite error costs just as much: a turn the backend STILL runs must
 *  keep its claim. A held, thinking, tool-waiting or non-streaming run emits
 *  no delta, so a blind retire would never be re-asserted — and the queue
 *  drains, which wake on the session list leaving its loading state and read
 *  $workingSessionIds, would submit a queued follow-up into the middle of the
 *  live run. So the snapshot decides per session, matched on BOTH identities:
 *  `working`/`waiting`/`starting` keep the claim (under the runtime id the
 *  backend reports, or the durable stored key when a respawn re-minted it),
 *  and only a session the snapshot omits or reports `idle` is downgraded.
 *
 *  `scope` picks which socket's sessions to reconcile, keyed by the event-
 *  source scope recorded at fan-in: a SECONDARY (registry or local secondary)
 *  reconnect passes its scope and touches only runtimes that arrived on that socket;
 *  the PRIMARY reconnect passes undefined and touches only scope-less
 *  runtimes (primary events record no scope). Neither can clear live
 *  work riding a different, still-healthy connection.
 *
 *  `needsInput` is only ever asserted here, never retired — a blocking prompt
 *  is the one claim the user must explicitly answer. Transition side-effects
 *  run through publishSessionState, so watchdogs disarm and stall hints drop —
 *  but the unread dot is deferred: a PRIMARY downgrade is blind, so the
 *  completion is parked until the post-reconnect `session.active_list` snapshot
 *  confirms the turn is gone (`confirmReconnectSettlesExcept`) or a busy
 *  re-assert proves it alive (#113029). A SCOPED downgrade lights it at once:
 *  no poll covers that socket.
 *
 *  The downgrade goes through the delegate's `retireBusyClaim` (the wiring
 *  cache's updateSessionState), not straight into this mirror: the claim has
 *  four holders — wiring cache, mirror, the focused view's draft latches,
 *  busyRef — and retiring only the mirror left Send silently no-oping behind
 *  a stale busy until restart (#93059). The mirror publish stays as the
 *  fallback for runtimes the cache never held (background-sync rows, no
 *  wiring mounted). A PRIMARY reconcile also clears the focused draft
 *  latches, which outlive the state they mirrored; a scoped one leaves them
 *  alone — a background socket says nothing about the primary composer.
 *
 *  With no `request` (a caller that has nobody to ask) the historic blind
 *  retire stands. With a `request` whose snapshot failed, NOTHING is retired:
 *  missing data is not a finished turn, and the ordinary settle path still
 *  clears a claim whose turn really ended.
 *
 *  While the snapshot is in flight the queue drains are held
 *  ($busyClaimsPending): the session list can leave its loading state — the
 *  edge they wake on — before this call publishes its claims, and a drain that
 *  read that gap as idle would submit a queued follow-up into the live run. */
export async function reconcileBusyStatesOnReconnect(
  scope?: string,
  request?: null | SessionStatusRequest
): Promise<void> {
  // Hold the drains while the snapshot is in flight (see $busyClaimsPending).
  $busyClaimsPending.set($busyClaimsPending.get() + 1)

  try {
    await reconcileBusyClaims(scope, request)
  } finally {
    $busyClaimsPending.set($busyClaimsPending.get() - 1)
  }
}

async function reconcileBusyClaims(scope?: string, request?: null | SessionStatusRequest): Promise<void> {
  const states = $sessionStates.get()

  // A SCOPED reconcile can only act on claims this mirror already holds for
  // that socket — a snapshot row cannot be attributed to a scope it did not
  // arrive on — so with none there is nothing to keep and nothing to retire.
  // A short-lived route (a relay lease reopening its socket every tick) must
  // not pay a round-trip for that.
  if (scope !== undefined && !Object.keys(states).some(runtimeId => sessionScopeByRuntimeId.get(runtimeId) === scope)) {
    return
  }

  const running = request ? await fetchRunningSessions(request) : null

  if (request && !running) {
    return
  }

  const focusedRuntimeId = $activeSessionId.get()
  const focusedStoredId = $selectedStoredSessionId.get()
  const focusedIsRunning = running !== null && snapshotRuns(running, [focusedRuntimeId, focusedStoredId])
  let retiredFocusedTurn = false

  // Only the primary socket has a confirm producer for a parked completion
  // (the active profile's `session.active_list` poll); a scoped reconcile
  // lights the dot immediately — see handleTransition.
  deferringReconcileUnread = scope === undefined

  try {
    for (const [runtimeId, state] of Object.entries(states)) {
      if (!state) {
        continue
      }

      const recorded = sessionScopeByRuntimeId.get(runtimeId)

      if (scope === undefined ? recorded !== undefined : recorded !== scope) {
        continue
      }

      const live = running?.get(runtimeId) ?? (state.storedSessionId ? running?.get(state.storedSessionId) : undefined)

      if (live) {
        // Still running: keep the claim, and re-assert it if this mirror lost
        // it, so no drain can read the reconnect as idle.
        if (!state.busy || !state.turnLive || (live.needsInput && !state.needsInput)) {
          publishSessionState(runtimeId, {
            ...state,
            busy: true,
            needsInput: state.needsInput || live.needsInput,
            turnLive: true
          })
        }

        // Only the runtime id the backend reports has events behind it; a
        // stored-key match against a re-minted runtime is the claim transfer's
        // job below. Noting a dead id would aim its silence probe at a
        // runtime the snapshot no longer lists.
        if (live.runtimeId === runtimeId) {
          noteSessionEvent(runtimeId)
        }

        continue
      }

      if (!state.busy && !state.awaitingResponse) {
        continue
      }

      if (runtimeId === focusedRuntimeId) {
        retiredFocusedTurn = true
      }

      sessionTileDelegate()?.retireBusyClaim?.(runtimeId)

      // Re-read — the write path may have republished (and released) this entry.
      const published = $sessionStates.get()[runtimeId]

      if (published?.busy || published?.awaitingResponse) {
        publishSessionState(runtimeId, {
          ...published,
          awaitingResponse: false,
          busy: false,
          turnLive: false,
          turnStartedAt: null
        })
      }
    }

    if (running && scope === undefined) {
      await claimRunningSessions(running)
    }
  } finally {
    deferringReconcileUnread = false
  }

  // The global clock mirrors the focused session, whichever socket owns it.
  // A reconnect for a different backend must not reset that session's timer,
  // and a focused turn the backend still runs keeps its clock with its claim.
  if (retiredFocusedTurn) {
    setTurnStartedAt(null)
  }

  if (scope === undefined) {
    // A focused turn the snapshot still lists keeps its busy latch: clearing
    // it here is what made Send no-op (and a queued prompt drain) into a run
    // that never emitted an event to re-assert it.
    if (focusedIsRunning) {
      setBusy(true)
    } else {
      setBusy(false)
      setAwaitingResponse(false)
    }
  }
}

// Derived per-session status sets — pure projections of `$sessionStates` (which
// holds `busy`/`needsInput` per runtime), keeping the data flow one-directional:
// gateway event → cache → $sessionStates → computed views.
//
// Perf: `$sessionStates` is republished on EVERY message delta (tens/sec during
// a turn), but these sets only change on busy/needsInput edges. `stableArray`
// keeps the prior reference when membership is unchanged so `computed` skips the
// emit — otherwise the whole sidebar + every row re-renders per token.
// Published under every id the conversation answers to, not just its current
// tip: consumers hold whichever id they were created with, and compression
// rotates the tip out from under them (see lineageAliases).
//
// A conversation that has not been persisted yet has no stored id at all, and
// dropping it here is what left the FIRST turn of a new chat with no running
// indicator anywhere — no dot, no row arc — for as long as it took the backend
// to hand one back. Its runtime id is the right fallback because until a stored
// id exists the two are the same value (submit.ts: "an unpersisted
// conversation's queue key IS its runtime id"), so the row matches; once a
// session is persisted its runtime id is nobody's key and the fallback is inert.
const storedIds = (
  states: Record<string, ClientSessionState>,
  sessions: readonly SessionInfo[],
  pred: (s: ClientSessionState) => boolean
) => {
  const ids = new Set<string>()

  for (const [runtimeId, state] of Object.entries(states)) {
    if (!pred(state)) {
      continue
    }

    for (const alias of lineageAliases(state.storedSessionId ?? runtimeId, sessions)) {
      ids.add(alias)
    }
  }

  return [...ids]
}

let workingIds: readonly string[] = []

export const $workingSessionIds = computed(
  [$sessionStates, $sessions],
  (states, sessions) =>
    (workingIds = stableArray(
      workingIds,
      storedIds(states, sessions, s => s.busy)
    ))
)

let attentionIds: readonly string[] = []

export const $attentionSessionIds = computed(
  [$sessionStates, $sessions],
  (states, sessions) =>
    (attentionIds = stableArray(
      attentionIds,
      storedIds(states, sessions, s => s.needsInput)
    ))
)

// An open session nothing has ever been sent to — the ⌘T tab whose backend
// session exists but is unlisted, or a tile still waiting on its first send.
// `blankDraftTile`'s predicate, read as a status rather than as a slot to spend.
//
// The row's own `message_count` is the tiebreaker, and it is load-bearing: a
// session RESUMING also holds an empty message list for the moment between
// binding its runtime and loading its transcript, and calling that a draft
// would flash the wrong mark on a conversation with years of history in it.
let draftIds: readonly string[] = []

export const $draftSessionIds = computed([$sessionStates, $sessions], (states, sessions) => {
  const unsent = (state: ClientSessionState) => {
    if (state.busy || state.messages.length > 0) {
      return false
    }

    const storedId = state.storedSessionId

    // No stored id is the ⌘T tab that hasn't reached the backend yet: a draft
    // by definition, and no row to consult. Asking anyway would match a row on
    // an empty lineage root.
    if (!storedId) {
      return true
    }

    const row = sessions.find(session => sessionMatchesStoredId(session, storedId))

    return !row || row.message_count === 0
  }

  return (draftIds = stableArray(draftIds, storedIds(states, sessions, unsent)))
})

/** The focused session's state slice (undefined while unresolved/unbound). */
export const $focusedSessionState = computed([$focusedRuntimeId, $sessionStates], (runtimeId, states) =>
  runtimeId ? states[runtimeId] : undefined
)

/** The best cached row for a stored session id, across every slice the sidebar
 *  has loaded (#76535): the owner-lookup rows (recents + cron + messaging +
 *  unlisted-draft/hidden stubs) and the project tree (a tile's session is
 *  often older than the paginated recents page, so the tree is the only
 *  loaded copy). Never a by-id fetch — a computed must stay synchronous. */
function focusedSessionRow(storedSessionId: string): SessionInfo | undefined {
  return (
    ownerLookupSessionRows().find(s => sessionMatchesStoredId(s, storedSessionId)) ??
    $projectTree
      .get()
      .flatMap(project => [
        ...(project.previewSessions ?? []),
        ...project.repos.flatMap(repo => repo.groups.flatMap(group => group.sessions))
      ])
      .find(s => sessionMatchesStoredId(s, storedSessionId))
  )
}

/** The workspace CWD of the currently focused session (the focused tile's cwd,
 *  else the primary session's confirmed workspace cwd, with fallback to historical session cwd). */
export const $focusedWorkspaceCwd = computed(
  [
    $focusedStoredSessionId,
    $selectedStoredSessionId,
    $focusedSessionState,
    $sessions,
    $currentCwd,
    $workspaceCwdOwner,
    $unlistedSessionOwnerRows,
    $projectTree,
    // focusedSessionRow reads the cron/messaging slices through the owner
    // lookup; listing them keeps a cron/messaging row landing reactive without
    // reading them eagerly in the computed body.
    $cronSessions,
    $messagingSessions
  ],
  (
    focusedStoredId,
    selectedStoredId,
    focusedSessionState,
    sessions: readonly SessionInfo[],
    currentCwd,
    workspaceCwdOwner
  ) => {
    const isTile = Boolean(focusedStoredId && focusedStoredId !== selectedStoredId)

    if (isTile && focusedStoredId) {
      const tileCwd = (
        focusedSessionState?.cwd ||
        sessions.find(s => sessionMatchesStoredId(s, focusedStoredId))?.cwd ||
        focusedSessionRow(focusedStoredId)?.cwd ||
        ''
      ).trim()

      return tileCwd
    }

    const hasPrimaryWorkspace = Boolean(currentCwd) && (workspaceCwdOwner ?? null) === (selectedStoredId ?? null)

    if (hasPrimaryWorkspace) {
      return currentCwd.trim()
    }

    if (selectedStoredId) {
      const fallbackCwd = (
        focusedSessionState?.cwd ||
        sessions.find(s => sessionMatchesStoredId(s, selectedStoredId))?.cwd ||
        focusedSessionRow(selectedStoredId)?.cwd ||
        ''
      ).trim()

      if (fallbackCwd) {
        return fallbackCwd
      }
    }

    return ''
  }
)
