import { atom, computed } from 'nanostores'

import type { ClientSessionState } from '@/app/types'
import type { ChatMessage } from '@/lib/chat-messages'
import type { ErrorSurface } from '@/lib/error-surface'
import { stableArray, stableRecord } from '@/lib/stable-array'
import type { SessionInfo } from '@/types/hermes'

import { clearAllProviderWaits, clearSessionProviderWait } from './provider-wait'
import {
  $activeSessionId,
  $lastReadAtBySessionId,
  $sessions,
  clearReadBaseline,
  lineageAliases,
  sessionMatchesStoredId,
  setActiveSessionStoredIdRotation,
  setAwaitingResponse,
  setBusy
} from './session'
import { runtimeSessionOwner, sessionOwnerByRuntimeId, sessionScopeByRuntimeId } from './session-states-owners'
import { $focusedRuntimeId, $focusedStoredSessionId, $sessionTiles, isSessionInForeground, rekeySessionTile, sessionTileDelegate } from './session-states-tiles-core'
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

// A live turn that stops producing events — including after a partial payload —
// must not wait out the presentation hint above. The clock resets on every
// session event and on a live-status poll that still reports the turn working,
// so a quiet tool call is left alone. The window outlasts the 30s live-status
// backstop: a dead backend stops both events and polls, and this settles it
// instead of leaving the spinner up. Not keyed on a model name or an error string.
export const LIVE_TURN_EVENT_SILENCE_MS = 45_000

const sessionEventSilenceTimers = new Map<string, ReturnType<typeof setTimeout>>()


function clearEventSilence(runtimeId: string) {
  const timer = sessionEventSilenceTimers.get(runtimeId)

  if (timer) {
    clearTimeout(timer)
    sessionEventSilenceTimers.delete(runtimeId)
  }
}


function isLiveTurnAwaitingEvents(state: ClientSessionState | undefined): boolean {
  return Boolean(state && (state.busy || state.awaitingResponse || state.turnLive) && !state.needsInput)
}


const SILENT_TURN_RETRY: ErrorSurface = { code: 'stream_drop', layer: 'streaming', retryable: true }


function withSilentTurnRetry(messages: ChatMessage[], streamId: string | null): ChatMessage[] {
  const occurredAt = Date.now() / 1000
  const error = 'The connection dropped before the reply finished.'

  const targetId =
    (streamId && messages.some(message => message.id === streamId) ? streamId : null) ??
    [...messages].reverse().find(message => message.role === 'assistant' && message.pending)?.id ??
    null

  const unpended = messages
    .filter(message => !(message.pending && message.parts.length === 0 && message.id !== targetId))
    .map(message =>
      message.pending || message.id === targetId ? { ...message, completedAt: occurredAt, pending: false } : message
    )

  if (targetId && unpended.some(message => message.id === targetId)) {
    return unpended.map(message =>
      message.id === targetId ? { ...message, error, errorSurface: SILENT_TURN_RETRY, pending: false } : message
    )
  }

  return [
    ...unpended,
    {
      completedAt: occurredAt,
      error,
      errorSurface: SILENT_TURN_RETRY,
      id: `assistant-interrupted-${Date.now()}`,
      parts: [],
      pending: false,
      role: 'assistant',
      timestamp: occurredAt
    }
  ]
}


function settleSilentLiveTurn(runtimeId: string) {
  const current = $sessionStates.get()[runtimeId]

  if (!current || !isLiveTurnAwaitingEvents(current)) {
    return
  }

  publishSessionState(runtimeId, {
    ...current,
    awaitingResponse: false,
    busy: false,
    interrupted: true,
    messages: withSilentTurnRetry(current.messages, current.streamId),
    pendingBranchGroup: null,
    streamId: null,
    turnLive: false,
    turnStartedAt: null
  })
}


/** Record that this session just produced an event. A live turn that then goes
 *  silent is force-settled; a turn still receiving events, or waiting on the
 *  user, is not. */
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
    setTimeout(() => {
      sessionEventSilenceTimers.delete(runtimeId)
      settleSilentLiveTurn(runtimeId)
    }, LIVE_TURN_EVENT_SILENCE_MS)
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

    clearSettled(previous.storedSessionId)
    setSessionStalled(previous.storedSessionId, false)
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
  settledExpiry.clear()
  unconfirmedReconnectSettles.clear()
  clearAllProviderWaits()
  sessionScopeByRuntimeId.clear()
  sessionOwnerByRuntimeId.clear()
  $stalledSessionIds.set([])
  $sessionStates.set({})
}


/** Downgrade cached busy/awaiting states after a gateway reconnect.
 *
 *  A respawned backend re-mints runtime ids (the same fact that drives
 *  resetTileRuntimeBindings), so a pre-reconnect `busy` can never receive its
 *  terminal `busy: false` publish — the runtime id it would arrive under is
 *  dead. Left alone, that state keeps its session in $workingSessionIds
 *  forever: the sidebar running arc and agents-panel "running" chrome lie for
 *  hours after the turn actually ended (#53902, #73082 — stale-flag half).
 *
 *  `scope` picks which socket's sessions to reconcile, keyed by the event-
 *  source scope recorded at fan-in: a SECONDARY (registry) reconnect passes
 *  its composite scope and touches only runtimes that arrived on that socket;
 *  the PRIMARY reconnect passes undefined and touches only scope-less
 *  runtimes (primary/local events record no scope). Neither can clear live
 *  work riding a different, still-healthy connection.
 *
 *  Direction of failure is deliberate: a turn that IS still live (transient
 *  socket blip, same backend) re-asserts busy on its next event or inflight
 *  snapshot within a beat, so at worst its arc blinks once. A dead turn's
 *  state, by contrast, would never clear on its own. `needsInput` is left
 *  untouched — a blocking prompt is the one claim the user must explicitly
 *  answer, and post-reconnect refresh re-asserts or retires it via its own
 *  path. Transition side-effects run through publishSessionState, so
 *  watchdogs disarm and stall hints drop — but the unread dot is deferred:
 *  a PRIMARY downgrade is blind, so the completion is parked until the
 *  post-reconnect `session.active_list` snapshot confirms the turn is gone
 *  (`confirmReconnectSettlesExcept`) or a busy re-assert proves it alive
 *  (#113029). A SCOPED downgrade lights it at once: no poll covers that socket.
 *
 *  The downgrade goes through the delegate's `retireBusyClaim` (the wiring
 *  cache's updateSessionState), not straight into this mirror: the claim has
 *  four holders — wiring cache, mirror, the focused view's draft latches,
 *  busyRef — and retiring only the mirror left Send silently no-oping behind
 *  a stale busy until restart (#93059). The mirror publish stays as the
 *  fallback for runtimes the cache never held (background-sync rows, no
 *  wiring mounted). A PRIMARY reconcile also clears the focused draft
 *  latches, which outlive the state they mirrored; a scoped one leaves them
 *  alone — a background socket says nothing about the primary composer. */
export function reconcileBusyStatesOnReconnect(scope?: string) {
  const states = $sessionStates.get()

  // Only the primary socket has a confirm producer for a parked completion
  // (the active profile's `session.active_list` poll); a scoped reconcile
  // lights the dot immediately — see handleTransition.
  deferringReconcileUnread = scope === undefined

  try {
    for (const [runtimeId, state] of Object.entries(states)) {
      if (!state || (!state.busy && !state.awaitingResponse)) {
        continue
      }

      const recorded = sessionScopeByRuntimeId.get(runtimeId)

      if (scope === undefined ? recorded !== undefined : recorded !== scope) {
        continue
      }

      sessionTileDelegate()?.retireBusyClaim?.(runtimeId)

      // Re-read — the write path may have republished (and released) this entry.
      const published = $sessionStates.get()[runtimeId]

      if (published?.busy || published?.awaitingResponse) {
        publishSessionState(runtimeId, { ...published, awaitingResponse: false, busy: false })
      }
    }
  } finally {
    deferringReconcileUnread = false
  }

  if (scope === undefined) {
    setBusy(false)
    setAwaitingResponse(false)
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
