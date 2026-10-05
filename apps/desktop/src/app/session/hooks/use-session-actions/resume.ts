import { useCallback, useRef } from 'react'

import {
  extendRefreshPageToOverlap,
  graftRefreshedTailOntoBackfill,
  olderPageReader
} from '@/app/chat/transcript-backfill'
import { fetchStoredTranscriptAcrossBackends, getLatestSessionMessages } from '@/hermes'
import { useI18n } from '@/i18n'
import {
  type ChatMessage,
  preserveLocalAssistantErrors,
  restorePendingClarifyToolCall,
  settlePendingClarifyToolCall,
  stripPendingClarifyProjectionForCache,
  toChatMessages
} from '@/lib/chat-messages'
import { markReasoningEffortPending } from '@/lib/chat-runtime'
import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import { recoverInFlightTurnJournal } from '@/lib/inflight-turn-journal'
import { latestSessionTodoSnapshot } from '@/lib/todos'
import { $clarifyRequests } from '@/store/clarify'
import { announceGoneSessionDraft } from '@/store/composer'
import { $connectionRequests } from '@/store/connection-request'
import { $gateway, isActivePrimary, openGatewayForAgent, openGatewayForProfile, pendingSessionReplay } from '@/store/gateway'
import { $gatewaySwitching } from '@/store/gateway-switch'
import { clearNotifications, notify, notifyError } from '@/store/notifications'
import {
  $activeGatewayProfile,
  $gatewaySwapTarget,
  $showAllProfiles,
  ensureGatewayAgent,
  ensureGatewayProfile,
  normalizeProfileKey
} from '@/store/profile'
import { receiveApprovalRequest, replayPendingApproval } from '@/store/prompts'
import { clearStoredTranscriptReadOnly, markStoredTranscriptReadOnly } from '@/store/read-only-transcript'
import {
  $connection,
  $messages,
  $sessions,
  getSessionOwnerHint,
  setActiveSessionId,
  setAwaitingResponse,
  setBusy,
  setCurrentBranch,
  setCurrentCwdTransient,
  setCurrentUsage,
  setFreshDraftReady,
  setMessages,
  setResumeExhaustedSessionId,
  setResumeFailedSessionId,
  setSelectedStoredSessionId,
  setSessionOwnerHint,
  setSessionStartedAt,
  setWorkspaceCwdOwner
} from '@/store/session'
import { isSessionOwnerResolutionError } from '@/store/session-owner-resolution'
import { isSessionRemovalPending } from '@/store/session-removal'
import {
  requestForSessionProfile,
  type SessionOwnerScope,
  type SessionProfileRoute
} from '@/store/session-request-router'
import { $sessionTiles, closeSessionTile, dropSessionState, publishSessionState } from '@/store/session-states'
import { restoreSessionTodosFromSnapshot } from '@/store/todos'
import { dropTranscriptTail, saveTranscriptTail } from '@/store/transcript-tail-cache'
import { isWatchWindow } from '@/store/windows'
import type { SessionMessage, SessionMessagesResponse, SessionResumeResult, UsageStats } from '@/types/hermes'

import type { ClientSessionState } from '../../../types'
import { singleFlightSessionResume } from '../use-prompt-actions/single-flight-resume'

import { sessionCreatedThisRun } from './created-this-run'
import { captureDisplayHydration } from './display-hydration'
import type { SessionActionHandles, SessionActionsOptions } from './options'
import { reconcilePersistedSessionTurn } from './persisted-live-turn'
import { provisionalTranscriptPaint, transcriptRestScope } from './provisional-transcript'
import { pendingClarifyToolPayload, restorePendingClarifyFromSnapshot } from './restore-pending-clarify'
import { projectPendingConnection, restorePendingConnectionFromSnapshot } from './restore-pending-connection'
import {
  createPersistedDisplayTranscriptProvenance,
  hasPersistedDisplayTranscriptProvenance,
  withoutTranscriptProvenance
} from './transcript-provenance'
import {
  appendLiveSessionProjection,
  applyRuntimeInfo,
  applyStoredSessionPreviewRuntimeInfo,
  chatMessageArraysEquivalent,
  dedupeInflightUserAgainstTranscript,
  goneSessionVerdict,
  isSessionGoneError,
  overlayConcurrentMessageChanges,
  patchSessionWorkspace,
  preserveEquivalentTranscript,
  preserveLocalPendingTurnMessages,
  reconcileDurableHistory,
  removeRepresentedLocalLiveProjection,
  resolveResumedBusy,
  resolveStoredSession,
  sessionMatchesStoredId,
  sessionShouldHaveTranscript
} from './utils'

// Reflect a stored row's persisted token counts into the live usage atom
// (total is derived, so callers can't drift it out of sync with input/output).
export function applyStoredUsage(stored: { input_tokens?: number | null; output_tokens?: number | null }) {
  const input = stored.input_tokens || 0
  const output = stored.output_tokens || 0

  setCurrentUsage(current => ({ ...current, input, output, total: input + output }))
}

/** Session-state patch for a restored blocking prompt row; the first non-null projection is used. */
function livePromptStreamId(
  ...projections: ({ streamId: string } | null)[]
): { awaitingResponse: false; sawAssistantPayload: true; streamId: string } | Record<string, never> {
  const live = projections.find(Boolean)

  return live ? { awaitingResponse: false, sawAssistantPayload: true, streamId: live.streamId } : {}
}

function reconcileAuthoritativeChatMessages(
  authoritativeMessages: ChatMessage[],
  previousMessages: ChatMessage[],
  liveProjection?: Pick<SessionResumeResult, 'inflight' | 'queued' | 'session_id' | 'turn_started_at'>,
  sourceRows?: SessionMessage[]
): ChatMessage[] {
  if (liveProjection && sourceRows) {
    const reconciled = reconcilePersistedSessionTurn(authoritativeMessages, previousMessages, sourceRows, liveProjection)

    if (reconciled) {
      return reconciled
    }
  }

  return reconcileDurableHistory(
    liveProjection ? appendLiveSessionProjection(authoritativeMessages, liveProjection) : authoritativeMessages,
    previousMessages
  )
}

function reconcileAuthoritativeMessages(
  authoritativeMessages: SessionResumeResult['messages'],
  previousMessages: ChatMessage[],
  liveProjection?: Pick<SessionResumeResult, 'inflight' | 'queued' | 'session_id' | 'turn_started_at'>
): ChatMessage[] {
  return reconcileAuthoritativeChatMessages(
    toChatMessages(authoritativeMessages),
    previousMessages,
    liveProjection,
    authoritativeMessages
  )
}

function restorePendingApproval(response: SessionResumeResult, sessionId: string): boolean {
  const pending = response.pending_approval

  if (!pending) {
    return false
  }

  // The live `approval` server request (re-delivered from `open_requests`
  // before this ran) already parked itself with the same queue id; don't
  // clobber it with a copy that can only answer through the RPC fallback.
  void receiveApprovalRequest(null, {
    allowPermanent: pending.allow_permanent !== false,
    choices: pending.choices,
    command: pending.command ?? '',
    description: pending.description ?? 'dangerous command',
    requestId: typeof pending.request_id === 'string' ? pending.request_id : undefined,
    sessionId,
    smartDenied: pending.smart_denied === true
  })
  void replayPendingApproval($gateway.get(), sessionId).catch(() => undefined)

  return true
}

/** Drop the pre-hydration request-id row without copying the other messages.
 *  A copied clarify row looks like a concurrent edit and hydration keeps both. */
function withoutEarlyClarifyProjection(messages: ChatMessage[], requestId: string): ChatMessage[] {
  let changed = false
  const next: ChatMessage[] = []

  for (const message of messages) {
    const parts = message.parts.filter(
      part =>
        !(
          part.type === 'tool-call' &&
          part.toolName === 'clarify' &&
          part.result === undefined &&
          part.toolCallId === requestId
        )
    )

    if (parts.length === message.parts.length) {
      next.push(message)

      continue
    }

    changed = true

    if (parts.length > 0) {
      next.push({ ...message, parts })
    }
  }

  return changed ? next : messages
}

export function useResumeActions(
  {
    activeSessionIdRef,
    busyRef,
    getRouteToken,
    holdSessionTranscriptView,
    requestGateway,
    resetViewSync,
    runtimeIdByStoredSessionIdRef,
    selectedStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    syncSessionStateToView,
    updateSessionState
  }: SessionActionsOptions,
  { startFreshSessionDraft }: Pick<SessionActionHandles, 'startFreshSessionDraft'>
) {
  const { t } = useI18n()
  const copy = t.desktop
  const resumeRequestRef = useRef(0)
  const transcriptHydrationByRuntimeRef = useRef(new Map<string, symbol>())
  const coldDisplayReadsRef = useRef(new Map<string, symbol>())

  const resumeSession = useCallback(
    async (storedSessionId: string, replaceRoute = false, capturedOwner?: SessionProfileRoute) => {
      // Delete/archive tombstones the durable id before the route flips, and
      // requestSessionResume already refuses to queue for a doomed id. This is
      // the actuator-side half of the same rule: a resume that was queued
      // BEFORE the tombstone (an idle-reap 4001 racing the delete) must not
      // re-select the chat and toast "Resume failed / Session not found".
      if (isSessionRemovalPending(storedSessionId)) {
        return
      }

      const requestId = resumeRequestRef.current + 1
      const routeToken = getRouteToken()
      resumeRequestRef.current = requestId
      const resumedSameSelectedSession = selectedStoredSessionIdRef.current === storedSessionId

      const isCurrentResume = () =>
        resumeRequestRef.current === requestId &&
        selectedStoredSessionIdRef.current === storedSessionId &&
        getRouteToken() === routeToken

      // A reconnect re-resumes the runtime this view is streaming. Let its
      // replay land while that runtime still owns the view. Otherwise the REST
      // read paints the finished turn first and the replayed rows are then
      // overlaid onto it as concurrent runtime changes: the turn shows twice.
      const viewRuntimeId = resumedSameSelectedSession ? activeSessionIdRef.current : null
      const viewReplay = viewRuntimeId ? pendingSessionReplay(viewRuntimeId) : undefined

      if (viewReplay) {
        await viewReplay

        if (!isCurrentResume()) {
          return
        }
      }

      const resumeStartMessages = resumedSameSelectedSession ? $messages.get() : []

      // Paint the click before the profile-resolve / gateway-swap awaits below,
      // so there's zero dead air: highlight the row instantly (the sidebar reads
      // $selectedStoredSessionId) and drop the previous session's transcript so
      // the thread shows this session's proven warm transcript or its loader
      // instead of the old session lingering until resume lands. Setting the
      // ref here is also what use-route-resume's self-heal assumes ("set
      // synchronously at resume entry").
      setFreshDraftReady(false)
      clearNotifications()
      resetViewSync()
      setSelectedStoredSessionId(storedSessionId)
      selectedStoredSessionIdRef.current = storedSessionId

      // A session is EITHER the main thread OR a tile — never both. openSessionTile
      // enforces this from the tile side (it refuses to tile the selected session);
      // this enforces it from the main side. Loading an existing session into main
      // (cold-start restore, a pasted/⌘K route, a notification jump) while it's also
      // an open tile would paint the same transcript twice — the workspace pane from
      // the route and the tile pane in parallel, both fighting one runtime. Drop the
      // now-redundant tile so main owns it. Runs before the async awaits below (and
      // before the selection listener homes focus) so the tile is gone the same tick
      // the route takes over; the warm cache/runtime binding survives for main to reuse.
      if ($sessionTiles.get().some(t => t.storedSessionId === storedSessionId)) {
        closeSessionTile(storedSessionId)
      }

      // Optimistically clear any prior resume-failure latch for this session:
      // we're attempting a fresh resume, so the self-heal in use-route-resume
      // must not keep treating it as stranded. It's re-armed below only if THIS
      // attempt fails terminally (RPC reject + REST fallback failure).
      setResumeFailedSessionId(current => (current === storedSessionId ? null : current))
      // Also clear the exhausted-latch: a fresh attempt (manual Retry, reconnect,
      // reselect) gives the bounded auto-retry counter a clean cycle, so the
      // chat view drops the error state and shows the loader again.
      setResumeExhaustedSessionId(current => (current === storedSessionId ? null : current))

      // A warm cache entry is only trustworthy when it still BELONGS to the
      // session being resumed. A pooled profile backend that gets idle-reaped
      // and respawned (pruneSecondaryGateways) re-mints runtime ids, so a
      // recycled id can resolve to a live-but-DIFFERENT session's cache entry.
      // The session.activate 404 guard below only catches a fully-DEAD id — a
      // recycled-live id 200s, so an unchecked hit paints the wrong transcript
      // under the current route (the "open chat A, chat B loads" bug). On a
      // mismatch the mapping is cross-wired: purge both sides and report a miss
      // so the caller falls through to a full resume that rebinds a correct id.
      const takeWarmCache = (): { runtimeId: string; state: ClientSessionState } | null => {
        const runtimeId = runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
        const state = runtimeId ? sessionStateByRuntimeIdRef.current.get(runtimeId) : undefined

        if (!runtimeId || !state) {
          return null
        }

        if (state.storedSessionId !== storedSessionId) {
          runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
          sessionStateByRuntimeIdRef.current.delete(runtimeId)
          dropSessionState(runtimeId)

          return null
        }

        return { runtimeId, state }
      }

      // The selection moved above, but a warm runtime is only (re)bound after
      // the awaits below. Until then the foreground may stay on a runtime only
      // if it already IS this session's own warm runtime (a same-session
      // re-resume). Leaving another chat's runtime bound is #89696: the primary
      // view reads the active runtime's slice and the view sync admits only the
      // active runtime, so a turn still streaming there keeps painting under
      // this session's route, and a re-entrant resume of this target would
      // snapshot it as this session's local pending turn (resumeStartMessages).
      const warmAtEntry = takeWarmCache()
      const foregroundIsTarget = warmAtEntry !== null && warmAtEntry.runtimeId === activeSessionIdRef.current

      if (!foregroundIsTarget) {
        setActiveSessionId(null)
        activeSessionIdRef.current = null
        // History load is not turn-busy. Drop the previous session's leftover
        // lock so focusing this session cannot inherit another chat's run.
        busyRef.current = false
        setBusy(false)

        if (!resumedSameSelectedSession) {
          setMessages([])
        }
      }

      // Swap the single live gateway to this session's profile before any
      // gateway call (no-op when it's already on that profile / single-profile).
      // resolveStoredSession finds the row by id (cheap), so an uncached pasted
      // id loads as fast as a sidebar click instead of hanging on a list scan.
      const ownerRoute = capturedOwner || getSessionOwnerHint(storedSessionId)
      // A connection switch clears/reloads the session rows before this path
      // runs, so an untagged row belongs to the connection that supplied the
      // current list. Capture that source before the async metadata lookup. If
      // we reduce it to the profile string `default`, requestForSessionProfile
      // resolves the local default socket and sends an SSH session id to the
      // wrong machine ("resume failed: session not found").
      const ambientConnection = $connection.get()

      // Keep the legacy primary-local profile door: main may resolve a named
      // profile to its own remote override (#94166). A registry secondary is
      // already an explicit source, even when it is This device under Home.
      const ambientConnectionId =
        ambientConnection?.mode === 'remote' || (ambientConnection?.registryScoped && !isActivePrimary())
          ? ambientConnection.connectionId?.trim() || ''
          : ''

      const provisional = provisionalTranscriptPaint(
        storedSessionId,
        () => isCurrentResume() && !resumedSameSelectedSession && !takeWarmCache()
      )

      const listedStored = $sessions.get().find(session => sessionMatchesStoredId(session, storedSessionId))

      if (ownerRoute || listedStored?.profile) {
        provisional.paint(transcriptRestScope(ownerRoute, listedStored, ambientConnectionId))
      }

      // An unbound warm target whose transcript is already persisted-display
      // authority paints now, display-only, instead of waiting out the awaits
      // below; the fast path re-proves it against the resolved owner before
      // binding. An unproven warm cache can be a compressed runtime tail, so it
      // keeps the loader (#73646).
      if (warmAtEntry && !foregroundIsTarget && listedStored) {
        const entryProvenance = createPersistedDisplayTranscriptProvenance({
          lineageRootId: listedStored._lineage_root_id ?? null,
          scope: transcriptRestScope(ownerRoute, listedStored, ambientConnectionId),
          storedSessionId
        })

        if (hasPersistedDisplayTranscriptProvenance(warmAtEntry.state, entryProvenance)) {
          setMessages(warmAtEntry.state.messages)
        }
      }

      const storedForProfile = await resolveStoredSession(storedSessionId, ownerRoute)
      const sessionProfile = storedForProfile?.profile

      if (!isCurrentResume()) {
        return
      }

      const resolvedConnectionId = ownerRoute?.connectionId || storedForProfile?.connection_id || ambientConnectionId

      // A row spliced from a CONNECTED registry gateway (#88880) carries its
      // owning connection. A row fetched directly after activating a registry
      // gateway can be untagged, so retain the captured ambient connection too.
      // Either way, route by the composite (connection, profile), never by a
      // same-named profile alone.
      const sessionOwner: SessionOwnerScope =
        ownerRoute ||
        (resolvedConnectionId
          ? {
              connectionId: resolvedConnectionId,
              profile: sessionProfile || 'default'
            }
          : sessionProfile)

      // Preserve this resolved source for later prompt/approval RPCs too;
      // otherwise an untagged row falls back to its bare profile after resume.
      // Only for a row the ambient source actually returned: an id that did not
      // resolve (deep link, routed restore) proves nothing about its owner, and
      // a persisted hint would pin it to whichever source was in front.
      if (
        !ownerRoute &&
        storedForProfile &&
        !storedForProfile.connection_id &&
        sessionOwner &&
        typeof sessionOwner === 'object'
      ) {
        setSessionOwnerHint(storedSessionId, sessionOwner)
      }

      const sessionRestScope = transcriptRestScope(ownerRoute, storedForProfile, ambientConnectionId)
      provisional.paint(sessionRestScope)

      // All-profiles / plugin navigation must not steal chrome API-home:
      // dial the owning backend without moving $activeGatewayProfile.
      if ($showAllProfiles.get()) {
        if (resolvedConnectionId) {
          await openGatewayForAgent(resolvedConnectionId, ownerRoute?.profile || sessionProfile || 'default', {
            spawnPriority: 'foreground'
          })
        } else if (sessionProfile) {
          await openGatewayForProfile(normalizeProfileKey(sessionProfile), { spawnPriority: 'foreground' })
        }
      } else if (resolvedConnectionId) {
        await ensureGatewayAgent(resolvedConnectionId, ownerRoute?.profile || sessionProfile || 'default')
      } else {
        await ensureGatewayProfile(sessionProfile)
      }

      // Request-time routing guard for every session-scoped RPC below. The
      // await above REQUESTS the swap, but by dispatch time the active gateway
      // can be back on another profile: a concurrent switch won the
      // gatewaySwitch mutex, an eviction path (idle reap, connection edit,
      // profile delete) re-pointed the active route at the primary, or the
      // target's dial failed and scheduleReconnect left the previous socket
      // active. Sending this session's resume/activate on whatever socket
      // happens to be active then lands it on a backend that has never heard
      // of the session — the backend boots, sits idle, and the renderer burns
      // its bounded retries into the "retries gave up" screen while the bot's
      // own backend is healthy one port over (#89206: local pool AND SSH).
      // requestForSessionProfile re-resolves the route at each call.
      const requestForSession = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
        requestForSessionProfile<T>(sessionOwner, requestGateway, method, params)

      if (!isCurrentResume()) {
        return
      }

      // Re-check after the profile-resolve / gateway-swap awaits above: the
      // cache may have changed, and takeWarmCache re-validates belongs-to and
      // purges a cross-wired mapping before we trust the fast-path.
      const warmHit = takeWarmCache()

      if (warmHit) {
        const cachedRuntimeId = warmHit.runtimeId
        const cachedState = warmHit.state

        const stored =
          $sessions.get().find(session => sessionMatchesStoredId(session, storedSessionId)) ?? storedForProfile

        let cachedViewState =
          !cachedState.model && stored?.model != null
            ? {
                ...cachedState,
                model: stored.model || ''
              }
            : cachedState

        if (resumedSameSelectedSession) {
          const messages = preserveLocalPendingTurnMessages(cachedViewState.messages, resumeStartMessages)

          if (messages !== cachedViewState.messages) {
            cachedViewState = { ...cachedViewState, messages }
          }
        }

        if (cachedViewState !== cachedState) {
          sessionStateByRuntimeIdRef.current.set(cachedRuntimeId, cachedViewState)
          publishSessionState(cachedRuntimeId, cachedViewState)
        }

        const expectedProvenance = stored
          ? createPersistedDisplayTranscriptProvenance({
              lineageRootId: stored._lineage_root_id ?? null,
              scope: sessionRestScope,
              storedSessionId
            })
          : null

        const hasValidProvenance = Boolean(
          expectedProvenance && hasPersistedDisplayTranscriptProvenance(cachedViewState, expectedProvenance)
        )

        if (!hasValidProvenance) {
          cachedViewState = withoutTranscriptProvenance(cachedViewState)
        }

        if (sessionShouldHaveTranscript(stored) && cachedViewState.messages.length === 0) {
          runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
          sessionStateByRuntimeIdRef.current.delete(cachedRuntimeId)
          dropSessionState(cachedRuntimeId)
        } else {
          // Bind the warm runtime immediately so cwd/workspace ownership don't
          // wait on session.activate (#71254). The armed transcript gate is the
          // single suppression authority: it hides only the unproven cached
          // prefix (rows captured at arm time, including a compressed runtime
          // tail — exactly the session-switch flicker, #73646) while rows that
          // arrive live during the hold still paint (#117867). Proven caches
          // and same-session re-resumes never arm the gate, so they paint
          // immediately. The persisted refresh itself still starts after
          // activate reattaches the live transport, so a turn finishing
          // between snapshot and reattach cannot leave a stale partial on
          // screen.
          const shouldRefreshPersistedTranscript = !isWatchWindow()

          const suppressUnprovenWarmTranscript =
            !resumedSameSelectedSession && shouldRefreshPersistedTranscript && !hasValidProvenance

          let releaseHeldTranscriptView = suppressUnprovenWarmTranscript
            ? holdSessionTranscriptView?.(cachedRuntimeId)
            : undefined

          const releaseTranscriptView = () => {
            releaseHeldTranscriptView?.()
            releaseHeldTranscriptView = undefined
          }

          const publishDegradedWarmCache = () => {
            releaseTranscriptView()
            syncSessionStateToView(cachedRuntimeId, cachedViewState)
          }

          setFreshDraftReady(false)
          clearNotifications()
          setSelectedStoredSessionId(storedSessionId)
          selectedStoredSessionIdRef.current = storedSessionId
          setActiveSessionId(cachedRuntimeId)
          activeSessionIdRef.current = cachedRuntimeId
          syncSessionStateToView(cachedRuntimeId, cachedViewState)
          setCurrentCwdTransient(cachedViewState.cwd)
          // The warm cache IS this conversation's own workspace truth, so the
          // switch is already re-homed here. This claim cannot wait for
          // `session.activate`: its missing-RPC compat branch returns before
          // `applyRuntimeInfo` runs, which would leave the workspace marked
          // un-owned for the life of the session (#71254).
          setWorkspaceCwdOwner(storedSessionId)
          setCurrentBranch(cachedViewState.branch)
          setSessionStartedAt(cachedViewState.runtimeStartedAt)

          try {
            const replay = pendingSessionReplay(cachedRuntimeId)

            // Only ordering matters here. A lost socket (false) still goes on
            // to session.activate so its existing branches own the outcome:
            // degraded warm cache on a transport error, cold resume when the
            // runtime is gone, or a normal rebind on a redialed socket (whose
            // history publication is re-gated after the REST read below).
            if (replay) {
              await replay

              if (!isCurrentResume()) {
                return
              }
            }

            let activated: SessionResumeResult | null = null
            const activateStartedAt = Date.now() / 1000
            const activateBaselineState = sessionStateByRuntimeIdRef.current.get(cachedRuntimeId) ?? cachedViewState
            const clarifyRequestIdAtActivateStart = $clarifyRequests.get()[cachedRuntimeId]?.requestId
            const connectionOpIdAtActivateStart = $connectionRequests.get()[cachedRuntimeId]?.opId

            try {
              activated = await requestForSession<SessionResumeResult>('session.activate', {
                session_id: cachedRuntimeId,
                cols: 96,
                omit_messages: true
              })
            } catch (error) {
              // Compatibility for older backends. Modern backends require
              // session.activate here because it rebinds the live session's
              // event transport to this newly-opened WebSocket.
              if (!isMissingRpcMethod(error)) {
                throw error
              }

              const usage = await requestForSession<UsageStats>('session.usage', { session_id: cachedRuntimeId })

              if (!isCurrentResume()) {
                return
              }

              if (usage) {
                setCurrentUsage(current => ({ ...current, ...usage, compressions: usage.compressions }))
              }

              publishDegradedWarmCache()

              return
            }

            if (!isCurrentResume()) {
              return
            }

            if (activated.session_key && activated.session_key !== storedSessionId) {
              runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
              sessionStateByRuntimeIdRef.current.delete(cachedRuntimeId)
              dropSessionState(cachedRuntimeId)
            } else {
              const pendingApproval = restorePendingApproval(activated, cachedRuntimeId)

              const pendingClarifyState = restorePendingClarifyFromSnapshot(
                activated,
                cachedRuntimeId,
                activateStartedAt,
                clarifyRequestIdAtActivateStart
              )

              const pendingClarify = pendingClarifyState.request

              const pendingConnection = restorePendingConnectionFromSnapshot(
                activated,
                cachedRuntimeId,
                activateStartedAt,
                connectionOpIdAtActivateStart
              ).request

              const clarifyAuthoritativelyAbsent =
                pendingClarifyState.authoritativeAbsent && !$clarifyRequests.get()[cachedRuntimeId]

              const staleClarifyAtActivateStart = clarifyAuthoritativelyAbsent
                ? Boolean(settlePendingClarifyToolCall(cachedViewState.messages, {}, false).streamId)
                : false

              const runtimeInfo = applyRuntimeInfo(activated.info)

              // `omit_messages` means the response carries NO transcript, not
              // an empty one — the cache is the base and the live projection is
              // a tail to graft onto it. Reconciling against the empty list
              // instead rebuilds the thread out of the projection alone, so
              // activating a session that is mid-turn somewhere else (leaving
              // HUD mode is exactly that) collapsed the whole conversation down
              // to the in-flight prompt until the turn finished and the
              // post-turn hydrate restored it.
              let activatedMessages = activated.messages_omitted
                ? appendLiveSessionProjection(cachedViewState.messages, activated)
                : activated.messages.length || activated.inflight || activated.queued
                  ? reconcileAuthoritativeMessages(activated.messages, cachedViewState.messages, activated)
                  : cachedViewState.messages

              // #70449: never let the activate snapshot's stale running:false
              // rewind a turn that started while the RPC was in flight — read
              // the freshest cache entry, not the pre-await cachedViewState.
              const latestCachedState = sessionStateByRuntimeIdRef.current.get(cachedRuntimeId)

              const busyChangedWhileActivating = Boolean(
                latestCachedState?.busy &&
                (latestCachedState.turnStartedAt !== activateBaselineState.turnStartedAt ||
                  (latestCachedState.turnLive && !activateBaselineState.turnLive))
              )

              const running =
                (pendingClarifyState.cleared || staleClarifyAtActivateStart) &&
                activated.running === false &&
                !busyChangedWhileActivating
                  ? false
                  : resolveResumedBusy(activated.running ?? cachedViewState.busy, Boolean(latestCachedState?.busy))

              restoreSessionTodosFromSnapshot(cachedRuntimeId, activated.todo_state, running)

              const activatedTurnStartedAt =
                typeof activated.turn_started_at === 'number' && activated.turn_started_at > 0
                  ? activated.turn_started_at * 1000
                  : null

              // Settle the activation snapshot before transcript hydration.
              // Once the attached transport reports a later terminal event,
              // that live state is authoritative and must not be overwritten
              // by the older `running` value after the REST request resolves.
              // The activate snapshot is enough to answer a still-pending clarify.
              // Publish that row in the same view update as needsInput, before
              // transcript REST. An armed hold still hides unproven history, so
              // the question rides a new row the hold cannot swallow by grafting
              // it onto a cutoff assistant. Hydration strips that synthetic id
              // and re-derives one authoritative row.
              const clarifyPayload = pendingClarify ? pendingClarifyToolPayload(pendingClarify) : null

              const earlyClarifyProjection = clarifyPayload
                ? restorePendingClarifyToolCall(suppressUnprovenWarmTranscript ? [] : activatedMessages, clarifyPayload)
                : null

              const projectedTail = earlyClarifyProjection?.messages.at(-1)

              const earlyClarifyMessages =
                earlyClarifyProjection && suppressUnprovenWarmTranscript && projectedTail
                  ? [...activatedMessages, projectedTail]
                  : earlyClarifyProjection?.messages

              const activatedLivenessState = updateSessionState(
                cachedRuntimeId,
                state => ({
                  ...state,
                  ...(runtimeInfo ?? {}),
                  busy: running,
                  awaitingResponse: running && !pendingClarify,
                  // Resumed onto an already-running turn — that IS backend
                  // proof the turn is live (no message.start will replay).
                  turnLive: state.turnLive || running,
                  needsInput:
                    pendingApproval ||
                    Boolean(pendingClarify) ||
                    Boolean(pendingConnection) ||
                    (clarifyAuthoritativelyAbsent ? false : state.needsInput),
                  // Adopting someone else's turn: we'll stream its reply
                  // without ever having received its prompt, so the settle
                  // path must not take the "I saw it all" shortcut.
                  adoptedRunningTurn: state.adoptedRunningTurn || running,
                  turnStartedAt: running ? (activatedTurnStartedAt ?? state.turnStartedAt ?? Date.now()) : null,
                  ...(earlyClarifyProjection
                    ? {
                        messages: earlyClarifyMessages ?? state.messages,
                        ...livePromptStreamId(null, earlyClarifyProjection)
                      }
                    : {})
                }),
                storedSessionId
              )

              busyRef.current = running
              setBusy(running)
              setAwaitingResponse(running && !pendingClarify)
              syncSessionStateToView(cachedRuntimeId, activatedLivenessState)

              // session.activate is the ordering barrier for reconnect recovery:
              // it atomically rebinds a running turn before returning. If the
              // turn is already terminal, this post-barrier REST read sees its
              // durable final row; if it is still running, later deltas/finish
              // events arrive on the newly attached transport. Hydration below
              // reconciles only messages, so those events also retain liveness
              // authority while the request is pending.
              const hydration = captureDisplayHydration({
                flights: transcriptHydrationByRuntimeRef.current,
                key: cachedRuntimeId,
                runtimeIdByStoredSessionIdRef,
                sessionStateByRuntimeIdRef,
                stored,
                storedSessionId
              })

              const persistedTranscriptPromise = shouldRefreshPersistedTranscript
                ? getLatestSessionMessages(storedSessionId, sessionRestScope).catch(() => null)
                : null

              // The persisted REST transcript is the display authority: a live
              // runtime may carry only the agent's compressed context projection,
              // which is intentionally smaller than the user-visible conversation.
              // Reconcile its in-flight/queued tail onto the complete transcript
              // instead of replacing durable history while the turn is running.
              let acceptedPersistedDisplayTranscript = false
              let reconciledCurrentLiveTurn = false

              if (persistedTranscriptPromise) {
                const persisted = await persistedTranscriptPromise
                const replayAtReturn = pendingSessionReplay(cachedRuntimeId)

                if (replayAtReturn && !(await replayAtReturn)) {
                  hydration.release()

                  return
                }

                // Navigation only revokes foreground publication, not this
                // runtime's display read. Edits/rebinds revoke both.
                if (!hydration.owns()) {
                  hydration.release()

                  return
                }

                const activatedStoredSessionId = activated.session_key || activated.resumed

                const persistedMatchesActivatedSession =
                  !persisted?.session_id ||
                  !activatedStoredSessionId ||
                  persisted.session_id === activatedStoredSessionId

                // An empty REST page is not proof the transcript is empty — it's
                // also what a backend respawn returns while its state.db read
                // races the activate response. Reconciling against it anyway
                // wipes the just-restored activate/cache transcript (the same
                // wipe the `activated.messages.length || ...` guard above
                // already prevents for the activate payload itself).
                if (
                  persisted &&
                  persistedMatchesActivatedSession &&
                  (persisted.messages.length || !activatedMessages.length)
                ) {
                  acceptedPersistedDisplayTranscript = Boolean(expectedProvenance)

                  // The REST hydration is a newest-tail page; graft it onto any
                  // older pages the previous view already backfilled so
                  // re-activating a scrolled-back session keeps its history.
                  // A long turn can push every rendered row off the newest page;
                  // read older pages until they overlap so the graft keeps history.
                  const persistedTail = await extendRefreshPageToOverlap(
                    toChatMessages(persisted.messages),
                    cachedViewState.messages,
                    olderPageReader(storedSessionId, sessionRestScope, persisted)
                  )

                  // The extra page reads await; re-check ownership like the read above.
                  if (!hydration.owns()) {
                    hydration.release()

                    return
                  }

                  const persistedMessages = graftRefreshedTailOntoBackfill(persistedTail, cachedViewState.messages)

                  const runtimeMessages = toChatMessages(activated.messages)
                  const previousMessages = removeRepresentedLocalLiveProjection(cachedViewState.messages, activated)

                  const liveProjection = dedupeInflightUserAgainstTranscript(
                    persistedMessages,
                    runtimeMessages,
                    activated,
                    cachedViewState.messages
                  )

                  const latestCachedMessages = sessionStateByRuntimeIdRef.current.get(cachedRuntimeId)?.messages

                  const cachedWithoutEarlyClarify =
                    latestCachedMessages && pendingClarify
                      ? withoutEarlyClarifyProjection(latestCachedMessages, pendingClarify.requestId)
                      : latestCachedMessages

                  const currentLiveTurn = reconcilePersistedSessionTurn(
                    persistedMessages,
                    cachedWithoutEarlyClarify ?? previousMessages,
                    persisted.messages,
                    liveProjection
                  )

                  // `null` does not depend on `previous`; retrying the live-turn
                  // reconcile inside the fallback would return `null` again.
                  reconciledCurrentLiveTurn = currentLiveTurn !== null
                  activatedMessages =
                    currentLiveTurn ??
                    reconcileAuthoritativeChatMessages(persistedMessages, previousMessages, liveProjection)
                }
              }

              const currentMessages = sessionStateByRuntimeIdRef.current.get(cachedRuntimeId)?.messages

              // The early publish may have appended a synthetic request-id row so
              // the hold could not hide the question. Drop it before overlaying
              // concurrent edits; the projection below re-derives one row.
              const currentForOverlay =
                currentMessages && pendingClarify
                  ? withoutEarlyClarifyProjection(currentMessages, pendingClarify.requestId)
                  : currentMessages

              // The occurrence-aware path already read the latest cache. An
              // additional identity overlay would restore its consumed tools.
              if (currentForOverlay && !reconciledCurrentLiveTurn) {
                activatedMessages = overlayConcurrentMessageChanges(
                  activatedMessages,
                  cachedViewState.messages,
                  currentForOverlay
                )
              }

              const pendingClarifyProjection = pendingClarify
                ? restorePendingClarifyToolCall(activatedMessages, pendingClarifyToolPayload(pendingClarify))
                : null

              const clearedClarifyProjection = clarifyAuthoritativelyAbsent
                ? settlePendingClarifyToolCall(
                    activatedMessages,
                    pendingClarifyState.cleared ? pendingClarifyToolPayload(pendingClarifyState.cleared) : {},
                    running
                  )
                : null

              const pendingConnectionProjection = projectPendingConnection(
                pendingClarifyProjection?.messages ?? clearedClarifyProjection?.messages ?? activatedMessages,
                pendingConnection
              )

              const visibleActivatedMessages =
                pendingConnectionProjection?.messages ??
                pendingClarifyProjection?.messages ??
                clearedClarifyProjection?.messages ??
                activatedMessages

              if (!running) {
                restoreSessionTodosFromSnapshot(
                  cachedRuntimeId,
                  latestSessionTodoSnapshot(visibleActivatedMessages),
                  false
                )
              }

              releaseTranscriptView()

              const reconcileActivatedState = (state: ClientSessionState): ClientSessionState => {
                // #95595: the reconcilers above always produce fresh
                // message objects, so an unconditional publish replaces the
                // warm-cached array with new-object equivalents and every
                // visible row re-normalizes + remounts (markdown re-parse +
                // shiki re-highlight per row, seconds of main-thread work).
                // Keep the existing array when the content is unchanged —
                // same guard the cold-resume path uses below.
                const messages = preserveEquivalentTranscript(state.messages, visibleActivatedMessages)

                return {
                  ...state,
                  messages,
                  transcriptProvenance:
                    acceptedPersistedDisplayTranscript || hasValidProvenance
                      ? (expectedProvenance ?? undefined)
                      : undefined,
                  ...livePromptStreamId(pendingConnectionProjection, pendingClarifyProjection),
                  ...(clearedClarifyProjection
                    ? {
                        streamId: state.busy ? (clearedClarifyProjection.streamId ?? state.streamId) : null
                      }
                    : {})
                }
              }

              if (isCurrentResume()) {
                const activatedState = updateSessionState(cachedRuntimeId, reconcileActivatedState, storedSessionId)
                syncSessionStateToView(cachedRuntimeId, activatedState)
              } else {
                // updateSessionState stages a view sync based on active runtime,
                // which can lag a newer route intent. Background hydration only
                // publishes the cache; it cannot stage that foreground write.
                const latestState = sessionStateByRuntimeIdRef.current.get(cachedRuntimeId)!
                const activatedState = reconcileActivatedState(latestState)
                sessionStateByRuntimeIdRef.current.set(cachedRuntimeId, activatedState)
                publishSessionState(cachedRuntimeId, activatedState)
              }

              hydration.release()
              // Cache backend transcript truth only. The pending/running bit and
              // any synthetic clarify row are a live resume projection and must
              // not survive after the server-side request expires.
              saveTranscriptTail(
                storedSessionId,
                stripPendingClarifyProjectionForCache(
                  activatedMessages,
                  pendingClarify?.requestId ??
                    pendingClarifyState.cleared?.requestId ??
                    $clarifyRequests.get()[cachedRuntimeId]?.requestId
                ),
                sessionRestScope
              )

              return
            }
          } catch (error) {
            // The cached runtime id was minted by a prior backend instance. A
            // pooled profile backend that gets idle-reaped (pruneSecondaryGateways)
            // and respawned across a profile swap mints fresh ids, so this mapping
            // now 404s ("session not found"). Drop it and fall through to a full
            // resume that rebinds a live runtime id. A transient timeout or
            // transport error is NOT proof that the session is dead: keep the
            // cache and optimistic turn intact for the next reconnect attempt.
            if (!isCurrentResume()) {
              return
            }

            if (!isSessionGoneError(error)) {
              publishDegradedWarmCache()

              return
            }

            runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
            sessionStateByRuntimeIdRef.current.delete(cachedRuntimeId)
            dropSessionState(cachedRuntimeId)
          } finally {
            releaseTranscriptView()
          }
        }
      }

      setFreshDraftReady(false)
      setActiveSessionId(null)
      activeSessionIdRef.current = null

      // A warm-cache hit at entry skipped the cold-path transcript clear, but the
      // warm path can still bail down to here — an empty-transcript drop, or the
      // cache getting purged during the profile-swap await — so the PREVIOUS
      // session's transcript would leak into this cold resume ("switching
      // sessions shows the same messages"). Clear it so the loader/prefetch
      // paints fresh; guarded so the normal cold path (already cleared) no-ops.
      if (!resumedSameSelectedSession && $messages.get().length > 0 && $messages.get() !== provisional.messages) {
        setMessages([])
      }

      // Retry after a warm runtime was discarded, without clearing a cold
      // tail that already painted before metadata/dial. This remains display-
      // only: REST replaces it rather than grafting onto stale cached history.
      provisional.paint(sessionRestScope)
      const cachedTailPaint = provisional.messages

      // The reconciler's notion of "what was already on screen": a durable
      // cached paint is provisional, not history — report empty so the
      // authoritative transcript replaces it wholesale.
      const viewMessagesForReconcile = (): ChatMessage[] => {
        const current = $messages.get()

        return cachedTailPaint !== null && current === cachedTailPaint ? [] : current
      }

      // A history load is not a live turn. Do not mark the incoming session
      // busy — running ≠ loading, and a leftover true locked the composer.
      busyRef.current = false
      setBusy(false)
      setAwaitingResponse(false)
      clearNotifications()
      setSelectedStoredSessionId(storedSessionId)
      selectedStoredSessionIdRef.current = storedSessionId
      const runtimeStartedAt = Date.now()
      setSessionStartedAt(runtimeStartedAt)

      const stored =
        $sessions.get().find(session => sessionMatchesStoredId(session, storedSessionId)) ?? storedForProfile

      applyStoredSessionPreviewRuntimeInfo(stored, storedSessionId)

      if (stored) {
        applyStoredUsage(stored)
      }

      const displayRead = captureDisplayHydration({
        flights: coldDisplayReadsRef.current,
        key: JSON.stringify([sessionRestScope, storedSessionId]),
        runtimeIdByStoredSessionIdRef,
        sessionStateByRuntimeIdRef,
        stored,
        storedSessionId
      })

      let resumedRunning = false
      // A recovered in-flight tail means the turn already produced output, so
      // it resumes into the streaming state rather than the "awaiting first
      // token" spinner.
      let recoveredInFlightTail = false

      try {
        const watchWindow = isWatchWindow()

        let localSnapshot = resumedSameSelectedSession
          ? preserveLocalPendingTurnMessages(viewMessagesForReconcile(), resumeStartMessages)
          : viewMessagesForReconcile()

        let prefetchApplied = false
        let prefetchedStoredSessionId: string | null = null
        let prefetchedTranscriptMessages: ChatMessage[] | null = null

        // REST transcript prefetch and the gateway resume RPC are independent
        // — run them concurrently so a big session's wall time is
        // max(prefetch, resume) instead of their sum. The prefetch paints the
        // transcript as soon as it lands; the RPC binds the runtime id.
        // Watch windows skip the prefetch — lazy resume attaches the live mirror.
        const prefetchPromise = watchWindow ? null : getLatestSessionMessages(storedSessionId, sessionRestScope)

        let resumeRuntimeBaselineMessages: ChatMessage[] = []
        const resumeStartedAt = Date.now() / 1000

        const resumePromise = singleFlightSessionResume(storedSessionId, () =>
          requestForSession<SessionResumeResult>('session.resume', {
            session_id: storedSessionId,
            cols: 96,
            source: 'desktop',
            defer_history: !watchWindow,
            // REST is the transcript authority for Desktop. Avoid duplicating a
            // potentially huge compression lineage in the WebSocket response.
            // Watch windows attach lazily (live mirror). Every other cold resume
            // gets the gateway's default deferred build: the RPC returns the
            // transcript immediately instead of blocking the switch on _make_agent
            // (MCP discovery / prompt build), and the agent pre-warms in the
            // background while the prefetch above paints the transcript.
            ...(watchWindow ? { lazy: true } : { omit_messages: true }),
            ...(sessionProfile ? { profile: sessionProfile } : {})
          })
        ).then(resumed => {
          resumeRuntimeBaselineMessages =
            sessionStateByRuntimeIdRef.current.get(resumed.session_id)?.messages ?? resumeRuntimeBaselineMessages

          return resumed
        })

        // The rejection is consumed by the `await` below; this guard only
        // keeps it from surfacing as unhandled while the prefetch settles.
        resumePromise.catch(() => undefined)

        let prefetchedResult: SessionMessagesResponse | null = null

        try {
          if (prefetchPromise) {
            prefetchedResult = await prefetchPromise
          }
        } catch {
          // Non-fatal: gateway resume below can still hydrate the session.
        }

        // The socket can drop and redial while REST is in flight. Painting now
        // would let the new socket's replay append the same turn again; a lost
        // socket (false) drops this read and the resume below binds without it.
        const viewReplayAtReturn = viewRuntimeId ? pendingSessionReplay(viewRuntimeId) : undefined

        if (prefetchedResult && viewReplayAtReturn && !(await viewReplayAtReturn)) {
          prefetchedResult = null
        }

        // A completed read still warms its exact durable scope after navigation.
        // It must not adopt a runtime or touch the foreground on that path.
        if (
          prefetchedResult &&
          stored &&
          displayRead.owns() &&
          (!prefetchedResult.session_id || prefetchedResult.session_id === stored.id)
        ) {
          saveTranscriptTail(storedSessionId, toChatMessages(prefetchedResult.messages), sessionRestScope)
        }

        // Paint the persisted transcript as soon as REST returns instead of
        // holding it until the runtime resume settles. A cold profile build
        // (skills, MCP, memory) can keep `session.resume` pending far longer
        // than the hydration budget while the complete history is already in
        // hand — holding it stranded Bot Chats on the loader (#90130). The
        // runtime path below grafts only its live projection onto this same
        // snapshot, so an unchanged acknowledgement keeps reference identity
        // and never rebuilds the transcript a second time.
        if (prefetchedResult && isCurrentResume()) {
          const previousMessages = resumedSameSelectedSession
            ? preserveLocalPendingTurnMessages(viewMessagesForReconcile(), resumeStartMessages)
            : viewMessagesForReconcile()

          // Tail page + previously backfilled prefix (same-session re-resume).
          // A long turn can push every rendered row off the newest page; read
          // older pages until they overlap so the graft keeps earlier history.
          const prefetchedTail = await extendRefreshPageToOverlap(
            toChatMessages(prefetchedResult.messages),
            previousMessages,
            olderPageReader(storedSessionId, sessionRestScope, prefetchedResult)
          )

          const graftedPrefetch = graftRefreshedTailOntoBackfill(prefetchedTail, previousMessages)

          prefetchedTranscriptMessages = graftedPrefetch
          localSnapshot = reconcileAuthoritativeChatMessages(graftedPrefetch, previousMessages)
          prefetchApplied = true
          prefetchedStoredSessionId = prefetchedResult.session_id || storedSessionId

          // The overlap reads await; skip painting if this resume went stale.
          if (isCurrentResume() && !chatMessageArraysEquivalent($messages.get(), localSnapshot)) {
            setMessages(localSnapshot)
          }
        }

        const resumed = await resumePromise

        if (!isCurrentResume()) {
          return
        }

        const currentMessages = viewMessagesForReconcile()

        // Keep the local snapshot when resume would only reshuffle runtime
        // projection. When the REST prefetch already hydrated the transcript,
        // skip converting/reconciling the resume payload entirely — on a
        // 1000+-message session that second conversion plus the deep
        // equivalence compare costs over a second of main-thread time.
        const resumedStoredSessionId = resumed.session_key || resumed.resumed

        const prefetchMatchesResumedSession =
          !prefetchedStoredSessionId || !resumedStoredSessionId || prefetchedStoredSessionId === resumedStoredSessionId

        const hasLiveProjection = Boolean(resumed.inflight || resumed.queued)

        const preferredMessages = (() => {
          if (prefetchApplied && prefetchMatchesResumedSession) {
            if (hasLiveProjection && prefetchedTranscriptMessages) {
              const runtimeMessages = toChatMessages(resumed.messages)
              const previousMessages = removeRepresentedLocalLiveProjection(currentMessages, resumed)

              // Omitted-messages resumes stay safe here: when runtime history
              // is empty, the dedupe helper can prove the current turn from an
              // exact local optimistic-user + stream pair and anchor the
              // remaining committed prefix in the REST transcript. Without
              // either proof it leaves the projection unchanged.
              const liveProjection = dedupeInflightUserAgainstTranscript(
                prefetchedTranscriptMessages,
                runtimeMessages,
                resumed,
                currentMessages
              )

              const resumedMessages = reconcileAuthoritativeChatMessages(
                prefetchedTranscriptMessages,
                previousMessages,
                liveProjection,
                prefetchedResult?.messages
              )

              const withConcurrentChanges = overlayConcurrentMessageChanges(
                resumedMessages,
                localSnapshot,
                currentMessages
              )

              return chatMessageArraysEquivalent(currentMessages, withConcurrentChanges)
                ? currentMessages
                : withConcurrentChanges
            }

            if (!hasLiveProjection) {
              return localSnapshot
            }
          }

          const previousMessages = resumedSameSelectedSession
            ? preserveLocalPendingTurnMessages(currentMessages, resumeStartMessages)
            : currentMessages

          const resumedMessages = reconcileAuthoritativeMessages(resumed.messages, previousMessages, resumed)

          return chatMessageArraysEquivalent(currentMessages, resumedMessages) ? currentMessages : resumedMessages
        })()

        const currentRuntimeMessages =
          sessionStateByRuntimeIdRef.current.get(resumed.session_id)?.messages ?? resumeRuntimeBaselineMessages

        const preferredWithRuntimeChanges = overlayConcurrentMessageChanges(
          preferredMessages,
          resumeRuntimeBaselineMessages,
          currentRuntimeMessages
        )

        // #70449: same stale-snapshot guard as the warm path — a turn that
        // started while the resume RPC was in flight has already marked the
        // rebound runtime busy via gateway events; the snapshot must not
        // rewind it to idle just because the user opened the chat.
        resumedRunning = resolveResumedBusy(
          (resumed as { running?: boolean }).running,
          Boolean(sessionStateByRuntimeIdRef.current.get(resumed.session_id)?.busy)
        )

        restoreSessionTodosFromSnapshot(resumed.session_id, resumed.todo_state, resumedRunning)

        if (!resumedRunning && prefetchApplied && prefetchMatchesResumedSession && prefetchedTranscriptMessages) {
          restoreSessionTodosFromSnapshot(
            resumed.session_id,
            latestSessionTodoSnapshot(prefetchedTranscriptMessages),
            false
          )
        }

        // Crash-survivable turn progress: fold a journaled in-flight tail
        // (persisted by use-session-state-cache while the turn streamed;
        // survives renderer/app death) back onto the restored transcript. The
        // backend's own inflight projection is already inside
        // `preferredWithRuntimeChanges`, so this merge only adds the locally
        // recorded structure that the backend's text-only snapshot cannot carry.
        const inFlightRecovery = recoverInFlightTurnJournal(storedSessionId, preferredWithRuntimeChanges, {
          keepPending: resumedRunning
        })

        recoveredInFlightTail = inFlightRecovery.applied

        // Prefetch-hit fast path: reuse the live array when neither runtime
        // changes nor in-flight recovery changed the reconciled transcript.
        const messagesForView =
          inFlightRecovery.messages === currentMessages
            ? currentMessages
            : preserveLocalAssistantErrors(inFlightRecovery.messages, currentMessages)

        // Fail-latch on the PRE-recovery transcript: an orphan journal tail
        // must not mask a lost transcript (a retry that reloads real history
        // is safer than surfacing the in-flight turn alone). Recovery only
        // ever appends, so this matches the final transcript's emptiness.
        //
        // "Should have a transcript" is not the cached sessions-list row alone.
        // That row is a cache of backend truth and lags the two flows that
        // report a vanished thread: after a wake/reconnect the list can still
        // carry the respawned backend's session at message_count 0, and a
        // compression tip can show 0 rows while the stored transcript is
        // intact. Conditioning the latch on it alone paints a blank thread
        // UNLATCHED — no retry, no error, just an empty chat that looks like
        // lost history. The resume RPC is authoritative and always reports the
        // stored size (`message_count`, filled from state.db even when
        // `messages_omitted`), so treat it — and a non-empty REST page — as the
        // other rungs of the same ladder.
        const saidToHaveTranscript =
          sessionShouldHaveTranscript(stored) ||
          (resumed.message_count || 0) > 0 ||
          Boolean(prefetchedResult?.messages.length)

        if (saidToHaveTranscript && preferredMessages.length === 0) {
          // Roll back a provisional cached-tail paint and drop its entry: the
          // latched attempt painted no history from any source, so the
          // display-only cache must not survive to mask the retry (or the next
          // wake) as a transcript that loaded.
          if (cachedTailPaint !== null && $messages.get() === cachedTailPaint) {
            setMessages([])
            dropTranscriptTail(storedSessionId, sessionRestScope)
          }

          setActiveSessionId(null)
          activeSessionIdRef.current = null
          setResumeFailedSessionId(storedSessionId)
          resumedRunning = false

          return
        }

        setActiveSessionId(resumed.session_id)
        activeSessionIdRef.current = resumed.session_id
        // A live resume proves the owner routed — retire any read-only latch
        // a previous no-owner open left behind (#94724: the backfill stamped
        // the row, or a topology change made the owner resolvable again).
        clearStoredTranscriptReadOnly(storedSessionId)
        const pendingApproval = restorePendingApproval(resumed, resumed.session_id)
        const pendingClarifyState = restorePendingClarifyFromSnapshot(resumed, resumed.session_id, resumeStartedAt)
        const pendingClarify = pendingClarifyState.request

        const pendingConnection = restorePendingConnectionFromSnapshot(
          resumed,
          resumed.session_id,
          resumeStartedAt
        ).request

        const clarifyAuthoritativelyAbsent =
          pendingClarifyState.authoritativeAbsent && !$clarifyRequests.get()[resumed.session_id]

        const runtimeInfo = applyRuntimeInfo(resumed.info)

        patchSessionWorkspace(storedSessionId, runtimeInfo?.cwd)

        // Preserve the turn-elapsed timer across cold resume: the gateway
        // reports when the in-flight turn started so the desktop can restore
        // the clock instead of resetting it to 0:00.
        const resumedTurnStartedAt =
          typeof resumed.turn_started_at === 'number' && resumed.turn_started_at > 0
            ? resumed.turn_started_at * 1000
            : null

        const pendingClarifyProjection = pendingClarify
          ? restorePendingClarifyToolCall(messagesForView, pendingClarifyToolPayload(pendingClarify))
          : null

        const clearedClarifyProjection = clarifyAuthoritativelyAbsent
          ? settlePendingClarifyToolCall(
              messagesForView,
              pendingClarifyState.cleared ? pendingClarifyToolPayload(pendingClarifyState.cleared) : {},
              resumedRunning
            )
          : null

        const pendingConnectionProjection = projectPendingConnection(
          pendingClarifyProjection?.messages ?? clearedClarifyProjection?.messages ?? messagesForView,
          pendingConnection
        )

        const visibleMessagesForView =
          pendingConnectionProjection?.messages ??
          pendingClarifyProjection?.messages ??
          clearedClarifyProjection?.messages ??
          messagesForView

        // The eagerly painted REST page is persisted-display authority: stamp
        // its provenance so the next warm switch to this session paints it
        // immediately instead of holding it as an unproven runtime tail.
        const transcriptProvenance =
          prefetchApplied && prefetchMatchesResumedSession && stored
            ? createPersistedDisplayTranscriptProvenance({
                lineageRootId: stored._lineage_root_id ?? null,
                scope: sessionRestScope,
                storedSessionId
              })
            : undefined

        updateSessionState(
          resumed.session_id,
          state => ({
            // The deferred build reports the session's own effort later (#79807).
            ...markReasoningEffortPending({ ...state, ...(runtimeInfo ?? {}) }),
            runtimeStartedAt,
            messages: visibleMessagesForView,
            transcriptProvenance,
            busy: resumedRunning,
            awaitingResponse: resumedRunning && !recoveredInFlightTail,
            // Backend reported this turn running at resume time — live proof.
            turnLive: state.turnLive || resumedRunning,
            needsInput:
              pendingApproval ||
              Boolean(pendingClarify) ||
              Boolean(pendingConnection) ||
              (clarifyAuthoritativelyAbsent ? false : state.needsInput),
            adoptedRunningTurn: state.adoptedRunningTurn || resumedRunning,
            ...(inFlightRecovery.applied
              ? {
                  sawAssistantPayload: true,
                  // Point live deltas at the recovered row when the backend is
                  // still mid-turn; a settled recovery keeps the stream idle.
                  streamId: resumedRunning ? inFlightRecovery.streamId : null,
                  turnStartedAt: resumedRunning ? (inFlightRecovery.turnStartedAt ?? resumedTurnStartedAt) : null
                }
              : {
                  turnStartedAt: resumedRunning && resumedTurnStartedAt !== null ? resumedTurnStartedAt : null
                }),
            ...livePromptStreamId(pendingConnectionProjection, pendingClarifyProjection),
            ...(clearedClarifyProjection
              ? {
                  streamId: resumedRunning ? (clearedClarifyProjection.streamId ?? state.streamId) : null
                }
              : {})
          }),
          storedSessionId
        )

        // updateSessionState stages its view sync through requestAnimationFrame.
        // Commit the final, already-reconciled transcript now so resume has one
        // additive DOM build instead of an eager prefetch build plus a later
        // runtime projection build.
        if (!chatMessageArraysEquivalent($messages.get(), visibleMessagesForView)) {
          setMessages(visibleMessagesForView)
        }

        // Refresh the durable tail cache with backend transcript truth only;
        // the live pending clarify projection expires with the server request.
        saveTranscriptTail(
          storedSessionId,
          stripPendingClarifyProjectionForCache(
            messagesForView,
            pendingClarify?.requestId ??
              pendingClarifyState.cleared?.requestId ??
              $clarifyRequests.get()[resumed.session_id]?.requestId
          ),
          sessionRestScope
        )
      } catch (err) {
        if (!isCurrentResume()) {
          return
        }

        // The gateway resume RPC failed. Try the REST transcript as a fallback
        // so the window at least shows history. CRITICAL: this fallback must be
        // wrapped in its own try — if it ALSO throws (wedged/unreachable backend,
        // the common case when resume failed in the first place), an unguarded
        // throw here skips setMessages AND leaves activeSessionId null with an
        // empty transcript. That is the exact state the thread loader latches on
        // forever (messagesEmpty && !activeSessionId) with no recovery path —
        // the "open in new window stays stuck loading, even after a nap" bug.
        let fallbackError: unknown = null

        try {
          const fallback = await getLatestSessionMessages(storedSessionId, sessionRestScope)

          if (!isCurrentResume()) {
            return
          }

          const previousMessages = resumedSameSelectedSession
            ? preserveLocalPendingTurnMessages(viewMessagesForReconcile(), resumeStartMessages)
            : viewMessagesForReconcile()

          // Resume failed, so there is no live projection — the journal is the
          // only carrier of a crashed turn's progress on this path.
          const fallbackRecovery = recoverInFlightTurnJournal(
            storedSessionId,
            reconcileAuthoritativeMessages(fallback.messages, previousMessages)
          )

          // The eager prefetch paint above may already show this transcript.
          if (!chatMessageArraysEquivalent($messages.get(), fallbackRecovery.messages)) {
            setMessages(fallbackRecovery.messages)
          }
        } catch (e) {
          // Fallback also failed: nothing to paint. Leave whatever messages are
          // already shown and fall through to arm the resume-failure latch so
          // use-route-resume re-attempts the resume on the next render / window
          // focus / gateway reconnect instead of stranding the loader.
          fallbackError = e
        }

        if (!isCurrentResume()) {
          return
        }

        // #94724 no-owner recovery: the owner ladder failed closed — which is
        // CORRECT under registry topology — but the stored transcript may be
        // fully intact in some backend's state.db. If the ambient REST
        // fallback above didn't already paint it, probe the registered
        // backends READ-ONLY (id-only GET; no live session is routed or
        // minted anywhere). When history is reachable, open the session
        // read-only instead of dead-ending on the resolution error: writes
        // stay blocked, and a later resume (after the single-match owner
        // backfill stamps the row) upgrades it back to a live session.
        if (isSessionOwnerResolutionError(err)) {
          let painted = !fallbackError && viewMessagesForReconcile().length > 0

          if (!painted) {
            const stored = await fetchStoredTranscriptAcrossBackends(storedSessionId).catch(() => null)

            if (!isCurrentResume()) {
              return
            }

            if (stored && stored.messages.length > 0) {
              const previousMessages = resumedSameSelectedSession
                ? preserveLocalPendingTurnMessages(viewMessagesForReconcile(), resumeStartMessages)
                : viewMessagesForReconcile()

              setMessages(reconcileAuthoritativeMessages(stored.messages, previousMessages))
              painted = true
            }
          }

          if (painted) {
            markStoredTranscriptReadOnly(storedSessionId)
            notify({
              kind: 'info',
              title: copy.readOnlyTranscriptTitle,
              message: copy.readOnlyTranscriptBody
            })

            return
          }
        }

        // The session is genuinely gone (deleted, or a stale id from a wiped /
        // rotated backend): the resume RPC and the authoritative REST transcript
        // both 404. There's nothing to recover — silently drop to a fresh draft
        // instead of toasting an error and hot-looping the bounded retry on a
        // permanently-dead id. (Booting straight into a no-longer-existent
        // last-session id is the common trigger.)
        if (viewMessagesForReconcile().length === 0 && isSessionGoneError(fallbackError)) {
          // A 404 is only trustworthy from the backend that OWNS the session.
          // A cross-profile open (Bots pane) races the gateway swap, so both
          // lookups can land on a backend that never heard of the id (#88540).
          // Re-resolve before discarding: a row still listed on any profile —
          // or a swap in flight — means "retry once things settle", not gone.
          let stillListed = false

          try {
            stillListed = Boolean(await resolveStoredSession(storedSessionId))
          } catch {
            // Resolution itself failed — inconclusive, treat as not listed.
          }

          if (!isCurrentResume()) {
            return
          }

          const verdict = goneSessionVerdict({
            createdThisRun: sessionCreatedThisRun(storedSessionId),
            stillListed,
            switchInFlight:
              $gatewaySwitching.get() ||
              Boolean($gatewaySwapTarget.get()) ||
              // Known owner ≠ active gateway: the 404 came from the wrong
              // backend. An UNKNOWN owner must not count — it would block the
              // draft fallback for genuinely dead ids on secondary profiles.
              Boolean(
                sessionProfile?.trim() &&
                normalizeProfileKey(sessionProfile) !== normalizeProfileKey($activeGatewayProfile.get())
              )
          })

          if (verdict === 'retry') {
            setResumeFailedSessionId(storedSessionId)

            return
          }

          // The id is verifiably dead, but the text the user typed into it is
          // still stashed under that key (#111868). Announce it so the
          // composer's swap onto the fresh draft carries it over with an
          // inline, undoable notice instead of leaving it stranded.
          announceGoneSessionDraft(storedSessionId)
          startFreshSessionDraft(true)

          return
        }

        if (viewMessagesForReconcile().length === 0) {
          // Arm the self-heal ONLY when the window is still empty: the gateway
          // resume rejected AND the REST fallback failed to paint a transcript.
          // A durable cached-tail paint counts as EMPTY here — it's provisional
          // display, not proof of a live transcript, and must not mask the
          // stranded state from the retry machinery.
          // That is the exact stranded state the loader latches on
          // (messagesEmpty && !activeSessionId), and matches $resumeFailedSessionId's
          // documented contract. If the REST fallback DID paint history, the
          // window is readable — arming here would needlessly auto-retry and,
          // once retries exhaust, blank that visible transcript behind the
          // exhausted-state error overlay (a regression vs. plain fallback success).
          setResumeFailedSessionId(storedSessionId)
        }

        notifyError(err, copy.resumeFailed)
      } finally {
        displayRead.release()

        if (isCurrentResume()) {
          busyRef.current = resumedRunning
          setBusy(resumedRunning)
          setAwaitingResponse(resumedRunning && !recoveredInFlightTail)
        }
      }
    },
    [
      activeSessionIdRef,
      busyRef,
      copy,
      getRouteToken,
      holdSessionTranscriptView,
      requestGateway,
      resetViewSync,
      runtimeIdByStoredSessionIdRef,
      selectedStoredSessionIdRef,
      sessionStateByRuntimeIdRef,
      startFreshSessionDraft,
      syncSessionStateToView,
      updateSessionState
    ]
  )

  return {
    resumeSession
  }
}
