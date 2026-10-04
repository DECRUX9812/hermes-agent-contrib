import {useCallback} from 'react'

import {NO_PROJECT_ID} from '@/app/chat/sidebar/projects/workspace-groups'
import {revealTreePane} from '@/components/pane-shell/tree/store'
import {setSessionYolo} from '@/lib/yolo-session'
import {announceNewSessionDraftKey} from '@/store/composer'
import {requestGatewayForAgent, retainGatewayForAgent} from '@/store/gateway'
import {clearNotifications} from '@/store/notifications'
import {adoptDraftPreviewTabs} from '@/store/preview'
import {$activeGatewayProfile, $newChatProfile, ensureGatewayAgent, ensureGatewayProfile, isLegacyNewChatProfile, normalizeProfileKey, resolveNewChatOwnerRoute} from '@/store/profile'
import {$projectScope} from '@/store/project-scope'
import {resolveNewSessionCwd} from '@/store/projects'
import {$currentCwd, $currentCwdExplicit, $currentFastMode, $currentModel, $currentProvider, $currentReasoningEffort, $currentServiceTier, $newChatWorkspaceTarget, $yoloActive, getCurrentModelSource, type NewChatWorkspaceTarget, rotateFreshDraftKey, setActiveSessionId, setAwaitingResponse, setBusy, setCurrentBranch, setCurrentCwd, setCurrentCwdExplicit, setCurrentCwdTransient, setCurrentUsage, setFreshDraftReady, setIntroSeed, setMessages, setNewChatWorkspaceTarget, setSelectedStoredSessionId, setSessionOwnerHint, setSessionStartedAt, setTurnStartedAt, setWorkspaceCwdOwner, setYoloActive} from '@/store/session'
import {holdSessionOwnerUntilForeground, releaseSessionOwnerHold} from '@/store/session-states'
import {broadcastSessionsChanged} from '@/store/session-sync'
import type {SessionCreateResponse} from '@/types/hermes'

import {NEW_CHAT_ROUTE, sessionRoute} from '../../../routes'
import {pinStoredSessionForOwner, releaseStoredSessionPins, sessionContextDrift} from '../session-context-drift'

import type {CreateGuard} from './create-guard'
import {sessionCreateOverrideParams, type SessionCreateOverrides, type SessionSeedMessage} from './create-overrides'
import { markSessionCreatedThisRun } from './created-this-run'
import type { FreshSessionDraftOptions, SessionActionsOptions } from './options'
import { createGatewaySession } from './session-create-request'
import {applyRuntimeInfo, upsertOptimisticSession} from './utils'

// `session.create` params from the current profile + sticky-UI model/effort/fast,
// ensuring the gateway is on that profile first. Shared by the primary send path
// and the "open in split" tile path; `cwd` is the one thing that differs (the
// live composer cwd for a send, the resolved new-session cwd for a fresh tile).
//
// Resolving null profile to the active gateway's is load-bearing: in global-remote
// mode one backend serves every profile, so an omitted profile silently lands the
// chat on the launch (default) profile — the "rubberbands back to default" bug.
// A no-op for single-profile/local-pooled users (a backend resolves its own launch
// profile to None). Effort/fast still ride as per-session overrides. Model and
// provider only ride when the composer source is 'manual' — a default-sourced
// value is a mirror of Settings → Model and must not pin the new chat.
export async function desktopSessionCreateParams(
  cwd: string,
  capturedRoute = resolveNewChatOwnerRoute(),
  requestedProfile?: string,
  legacyProfileIntent = false,
  includeComposerSelection = true
): Promise<Record<string, unknown>> {
  // Treat Send as the linearization point for the visible selector state. The
  // profile handshake below can yield long enough for background config/model
  // refreshes to finish; reading atoms afterward would silently create the
  // session with a different selection than the one the user submitted.
  // Settings → Model while a session is live leaves $currentModel painted with
  // the live agent (applySavedMainModel) and only flips the source to 'default'.
  // Shipping that stale value as an override pins every new chat to the old
  // model. Omit model/provider unless the source is 'manual'.
  const isManualSelection = getCurrentModelSource() === 'manual'

  const selection = {
    effort: $currentReasoningEffort.get().trim(),
    fast: $currentFastMode.get(),
    model: isManualSelection ? $currentModel.get().trim() : '',
    provider: isManualSelection ? $currentProvider.get().trim() : '',
    serviceTier: $currentServiceTier.get().trim()
  }

  const profile =
    capturedRoute?.profile ||
    requestedProfile ||
    $newChatProfile.get() ||
    normalizeProfileKey($activeGatewayProfile.get())

  if (capturedRoute) {
    await ensureGatewayAgent(capturedRoute.connectionId, profile)
  } else if (legacyProfileIntent) {
    await ensureGatewayProfile(profile, { forceLegacyRoute: true })
  } else {
    await ensureGatewayProfile(profile)
  }

  return {
    cols: 96,
    source: 'desktop',
    ...(cwd && { cwd }),
    // #52589: explicit provenance for the shipped cwd — an inherited app-global
    // workspace must not override the target profile's configured terminal.cwd.
    ...(cwd && { cwd_explicit: $currentCwdExplicit.get() }),
    ...(profile ? { profile: capturedRoute?.targetProfile || profile } : {}),
    ...(includeComposerSelection
      ? {
          ...(selection.model
            ? { model: selection.model, ...(selection.provider ? { provider: selection.provider } : {}) }
            : {}),
          ...(selection.effort ? { reasoning_effort: selection.effort } : {}),
          fast: selection.fast,
          // Only Ultrafast needs the tier: `fast` already pins Priority/normal, and a
          // pre-Ultrafast backend rejects the field (createGatewaySession drops it).
          ...(selection.serviceTier === 'ultrafast' ? { service_tier: 'ultrafast' } : {})
        }
      : {})
  }
}

function normalizeNewChatWorkspaceTarget(target: NewChatWorkspaceTarget): NewChatWorkspaceTarget {
  return typeof target === 'string' ? target.trim() || null : target
}

export function useCreateActions(
  { activeSessionIdRef, busyRef, creatingSessionRef, ensureSessionState, getRouteToken, navigate, onFreshDraftRouteIntent, requestGateway, resetViewSync, runtimeIdByStoredSessionIdRef, selectedStoredSessionIdRef, updateSessionState }: SessionActionsOptions,
  { createGuard }: { createGuard: CreateGuard }
) {
  const startFreshSessionDraft = useCallback(
    (options: boolean | FreshSessionDraftOptions = false) => {
      const draftOptions = typeof options === 'boolean' ? { replaceRoute: options } : options
      const preserveRoute = draftOptions.preserveRoute ?? false
      const replaceRoute = draftOptions.replaceRoute ?? false

      const hasWorkspaceTarget =
        Object.hasOwn(draftOptions, 'workspaceTarget') && draftOptions.workspaceTarget !== undefined

      const workspaceTarget = hasWorkspaceTarget
        ? normalizeNewChatWorkspaceTarget(draftOptions.workspaceTarget)
        : undefined

      if (draftOptions.rotateFreshDraftKey !== false) {
        rotateFreshDraftKey()
      }

      resetViewSync()
      busyRef.current = false
      setBusy(false)
      setAwaitingResponse(false)
      clearNotifications()
      setIntroSeed(seed => seed + 1)
      // A fresh chat takes the screen. Front the workspace — and ONLY that:
      // `$terminalTakeover` is the terminal's open/closed state in every
      // layout, not a Focus-only overlay flag, so clearing it here would close
      // a terminal sitting harmlessly in its own zone (Default, Terminal deck,
      // Quad) and would persist a `false` that leaves the Focus tab unable to
      // mount its workspace on the next boot. Behind another tab the terminal
      // is hidden, not closed: it keeps its PTYs and the overlay stops
      // painting on the pane-hidden marker, which is what actually cleared the
      // chat.
      revealTreePane('workspace')
      // Clear the durable route intent synchronously, before React Router
      // publishes /new. Submit uses that intent to heal an existing-session
      // rebind race, so leaving the old id here could revive it on a very fast
      // New Chat -> Enter sequence.
      onFreshDraftRouteIntent?.()

      if (!preserveRoute) {
        navigate(NEW_CHAT_ROUTE, { replace: replaceRoute })
      }

      setActiveSessionId(null)
      activeSessionIdRef.current = null
      setSelectedStoredSessionId(null)
      selectedStoredSessionIdRef.current = null
      setMessages([])
      setCurrentUsage({
        calls: 0,
        input: 0,
        output: 0,
        total: 0
      })
      setSessionStartedAt(null)
      setTurnStartedAt(null)
      // The composer's model/effort/fast is sticky UI state (persisted in
      // localStorage) — a new chat FOLLOWS your last pick instead of snapping
      // back to the profile default, so we deliberately don't reset it here. The
      // profile default still owns first-run seeding and profile switches (see
      // refreshCurrentModel). Keep the canonical service tier too: clearing
      // it while retaining fast=true would silently downgrade Ultrafast.
      setYoloActive(false)
      setNewChatWorkspaceTarget(hasWorkspaceTarget ? workspaceTarget : undefined)
      // #52589 provenance: only a deliberate string workspace target is an explicit
      // cwd choice. A plain new chat (or a detached `null`) is not — its inherited
      // launch/project workspace must yield to a named profile's configured cwd.
      setCurrentCwdExplicit(typeof workspaceTarget === 'string')

      if (!hasWorkspaceTarget) {
        // In a project → the repo's default-branch checkout; not in a project →
        // detached. So cmd-n does not inherit an unrelated linked worktree.
        // Transient: a resolved default is not the user naming a workspace, and
        // remembering it here would make the NEXT new chat inherit it.
        setCurrentCwdTransient(resolveNewSessionCwd())
      } else if (workspaceTarget === null) {
        setCurrentCwdTransient('')
      } else if (typeof workspaceTarget === 'string') {
        setCurrentCwd(workspaceTarget)
      }

      // A fresh draft resolves its own workspace right here, so it owns it. The
      // selected stored id is null for a draft, and so is the owner — they match,
      // which keeps workspace surfaces live on a new chat instead of treating the
      // draft as an un-re-homed switch (#71254).
      setWorkspaceCwdOwner(null)
      setCurrentBranch('')
      // Never clear the composer here — ChatBar's per-thread draft swap owns it.
      setFreshDraftReady(true)
    },
    [activeSessionIdRef, busyRef, navigate, onFreshDraftRouteIntent, resetViewSync, selectedStoredSessionIdRef]
  )

  const createBackendSessionForSend = useCallback(
    async (
      preview: string | null = null,
      seedMessages?: SessionSeedMessage[],
      // Create the session titled or at a pinned reasoning effort (guided
      // onboarding mints its welcome chat this way). The owning profile is NOT
      // an override — point $newChatProfile at it first (selectProfile-style)
      // so the create lands on that profile's own backend and every later
      // ambient RPC follows.
      createOverrides?: SessionCreateOverrides
    ): Promise<string | null> => {
      const startingStoredSessionId = selectedStoredSessionIdRef.current
      const startingRouteToken = getRouteToken()

      creatingSessionRef.current = true

      try {
        // An explicit one-shot workspace target (null → detached, string → that
        // folder) wins; otherwise the live cwd, then the project-aware default
        // (resolveNewSessionCwd — a project's new session keeps its repo cwd).
        // Home is an explicit detached scope: do not let a stale live cwd from
        // the previously selected project leak into this new session (#84220).
        const workspaceTarget = $newChatWorkspaceTarget.get()
        const homeScope = $projectScope.get() === NO_PROJECT_ID

        const cwd =
          workspaceTarget === null || (workspaceTarget === undefined && homeScope)
            ? ''
            : typeof workspaceTarget === 'string'
              ? workspaceTarget.trim()
              : $currentCwd.get().trim() || resolveNewSessionCwd()

        // The EXACT owner for this create: an explicit agent route, else the
        // (registry source, profile) pair the draft was made on. Read ONCE at
        // the send linearization point and threaded through the create RPC,
        // the owner hint, the optimistic row and the failure cleanup, so the
        // profile-rail path (selectProfile clears $newChatRoute) can no longer
        // reduce the owner to a bare profile name that later RPCs dial on a
        // different socket than the one that minted the runtime.
        const capturedRoute = resolveNewChatOwnerRoute()
        const capturedProfile = $newChatProfile.get() || normalizeProfileKey($activeGatewayProfile.get())
        const legacyProfileIntent = isLegacyNewChatProfile(capturedProfile)

        const params = {
          ...(await desktopSessionCreateParams(cwd, capturedRoute, capturedProfile, legacyProfileIntent)),
          ...sessionCreateOverrideParams(createOverrides, seedMessages)
        }

        // Lease the owner socket for the whole create → owner-publication
        // sequence (#93602 primitive). The per-request lease inside
        // requestGatewayForAgent ends when session.create returns; the
        // foreground hold below takes over from that point until the created
        // chat is selected. Between the two, nothing may close the socket
        // that just minted the runtime.
        //
        // 'foreground' spawn priority (#102281 primitive): this is the user
        // hitting send on a fresh chat, so a cold spawn must not queue behind
        // background roster hydration on a saturated pool. The retain is the
        // first dial, so it carries the tag as well as the create RPC.
        const releaseCreateLease = capturedRoute
          ? await retainGatewayForAgent(capturedRoute.connectionId, capturedRoute.profile, {
              spawnPriority: 'foreground'
            })
          : () => undefined

        let created: SessionCreateResponse
        let stored: null | string

        try {
          created = await createGatewaySession(capturedRoute, params, requestGateway)

          stored = created.stored_session_id ?? null

          // Record the EXACT owner the moment a routed create returns a stored
          // id — before the drift check, the optimistic row, navigation, or any
          // session-scoped RPC can resolve this session's owner. The route is
          // the only authority: in All-profiles / Bot routing the ambient
          // $activeGatewayProfile stays on `default` while the session lives on
          // `capturedRoute` (e.g. local::omar). Without this hint the optimistic
          // row (stamped from ambient) was the only owner record, so the first
          // turn ran on omar and every later session-scoped RPC resolved the row
          // as `default` and 4001'd "session not found".
          if (stored && capturedRoute) {
            setSessionOwnerHint(stored, capturedRoute)
            // Pin the owner socket until the foreground publication (route →
            // $selectedStoredSessionId) covers it, so a prune or lease release
            // in that gap cannot close the runtime before the first prompt.
            holdSessionOwnerUntilForeground(stored, capturedRoute)
          }
        } finally {
          releaseCreateLease()
        }

        // Only a genuine move to a DIFFERENT chat mid-create should orphan the
        // session we just minted. The active runtime ref is deliberately not a
        // prong: background gateway events retarget it while other sessions
        // stream (#47709 class), and the seconds-long session.create round-trip
        // (server-side agent + MCP init) makes that churn near-certain — every
        // genuine user switch retargets selection AND route synchronously
        // anyway. submitTargetStoredId is the just-created stored session, so
        // our own upcoming re-home onto it never reads as drift.
        const drift = sessionContextDrift({
          startRouteToken: startingRouteToken,
          nowRouteToken: getRouteToken(),
          startSelectedStoredId: startingStoredSessionId,
          nowSelectedStoredId: selectedStoredSessionIdRef.current,
          submitTargetStoredId: stored
        })

        if (drift) {
          console.warn('[submit-drift-abort]', drift, { phase: 'mid-create' })

          // Close on the backend that minted the session: the ambient socket
          // is a different machine/profile for a routed create and would
          // 4001 while the orphan lives on (and later ws-orphan-reaps) there.
          const closeCreated = capturedRoute
            ? requestGatewayForAgent(capturedRoute.connectionId, capturedRoute.profile, 'session.close', {
                session_id: created.session_id
              })
            : requestGateway('session.close', { session_id: created.session_id })

          await closeCreated.catch(() => undefined)

          if (stored) {
            releaseSessionOwnerHold(stored)
          }

          return null
        }

        resetViewSync()
        activeSessionIdRef.current = created.session_id
        selectedStoredSessionIdRef.current = stored
        ensureSessionState(created.session_id, stored)

        if (stored) {
          markSessionCreatedThisRun(stored)
          // Seed the sidebar preview with the user's first message so the row
          // reads meaningfully while the turn is in flight, instead of flashing
          // "Untitled session" until the turn persists and auto-title runs. The
          // server later returns its own preview/title and supersedes this.
          // The row carries the create route's exact owner (backend profile +
          // connection), never the ambient profile — see upsertOptimisticSession.
          upsertOptimisticSession(created, stored, null, preview?.trim() || null, null, undefined, capturedRoute)
          // Anything still parked under the pre-session draft bucket belongs
          // to this chat now (#114122); the composer moves it on scope swap.
          announceNewSessionDraftKey(stored)
          // The draft's preview tabs follow it the same way (#73890).
          adoptDraftPreviewTabs(stored)
          createOverrides?.onComposerScopeAssigned?.(stored)
          // Hold creatingSessionRef until the route lands on `stored` (release
          // effect in create-guard). setTimeout(0) raced use-route-resume back
          // onto the previous session (#66057).
          createGuard.armPendingCreatedSession(stored)

          try {
            navigate(sessionRoute(stored), { replace: true })
          } catch {
            createGuard.releaseCreatingSessionGuard()
          }

          // Other windows (e.g. the main window when this is the pop-out) can't
          // see this session until they re-pull the shared list.
          broadcastSessionsChanged()
        }

        setFreshDraftReady(false)
        setNewChatWorkspaceTarget(undefined)
        setActiveSessionId(created.session_id)
        setSelectedStoredSessionId(stored)
        const runtimeStartedAt = Date.now()
        setSessionStartedAt(runtimeStartedAt)
        const yoloArmed = $yoloActive.get()
        const runtimeInfo = applyRuntimeInfo(created.info)

        updateSessionState(
          created.session_id,
          state => ({ ...state, ...(runtimeInfo ?? {}), runtimeStartedAt }),
          stored
        )

        // User may have armed YOLO on the new-chat draft before the runtime
        // session existed — apply it to the freshly created session.
        if (yoloArmed) {
          await setSessionYolo(requestGateway, created.session_id, true).catch(() => undefined)
        }

        return created.session_id
      } finally {
        // Keep the guard up while a navigate to the new stored id is pending;
        // otherwise clear immediately (abort, error, or create without stored id).
        if (!createGuard.pendingCreatedStoredSessionIdRef.current) {
          creatingSessionRef.current = false
        }
      }
    },
    [
      activeSessionIdRef,
      createGuard,
      creatingSessionRef,
      ensureSessionState,
      getRouteToken,
      navigate,
      requestGateway,
      resetViewSync,
      selectedStoredSessionIdRef,
      updateSessionState
    ]
  )

  const submitTextToNewSession = useCallback(
    async (text: string, owner?: string): Promise<{ runtimeSessionId: string; sessionId: string }> => {
      // IPC delivers the quick-entry submit as one task, and the drift guard
      // classifies by route/selection tokens. Capture them BEFORE the create:
      // the session.create round-trip is seconds long, and this call's own
      // re-home onto the created session must never read as user drift
      // (same contract as createBackendSessionForSend's starting tokens).
      const startingRouteToken = getRouteToken()
      const startingSelectedStoredId = selectedStoredSessionIdRef.current
      const params = await desktopSessionCreateParams(resolveNewSessionCwd())
      const created = await requestGateway<SessionCreateResponse>('session.create', params)
      const stored = created.stored_session_id

      if (!stored) {
        throw new Error('The new session did not return a stored id.')
      }

      // Only a genuine user move to a DIFFERENT chat mid-create orphans the
      // minted session; our own re-home below names it, so it is not drift.
      const drift = sessionContextDrift({
        startRouteToken: startingRouteToken,
        nowRouteToken: getRouteToken(),
        startSelectedStoredId: startingSelectedStoredId,
        nowSelectedStoredId: selectedStoredSessionIdRef.current,
        submitTargetStoredId: stored
      })

      if (drift) {
        console.warn('[submit-drift-abort]', drift, { phase: 'quick-entry-new' })
        throw new Error(`Quick Entry destination changed mid-create: ${drift}`)
      }

      // The owner is the requesting submit's correlation when the caller knows
      // it (quick entry); otherwise this call owns its own generation.
      const pinOwner = owner ?? `new-session-${created.session_id}`
      pinStoredSessionForOwner(pinOwner, stored)

      try {
        markSessionCreatedThisRun(stored)
        runtimeIdByStoredSessionIdRef.current.set(stored, created.session_id)
        ensureSessionState(created.session_id, stored)
        upsertOptimisticSession(created, stored, null, text.trim())
        // Submit the exact runtime id returned by session.create so this
        // atomic path cannot fall back to a route token (#85590).
        await requestGateway('prompt.submit', { session_id: created.session_id, text })
        navigate(sessionRoute(stored), { replace: true })

        return { runtimeSessionId: created.session_id, sessionId: stored }
      } finally {
        // Terminal transition for this owner: accepted, failed, or cancelled.
        // Owner-scoped pins cannot strand another request, so no tick budget is
        // needed to force-release.
        releaseStoredSessionPins(pinOwner)
      }
    },
    [
      ensureSessionState,
      getRouteToken,
      navigate,
      requestGateway,
      runtimeIdByStoredSessionIdRef,
      selectedStoredSessionIdRef
    ]
  )

  return {
    startFreshSessionDraft,
    createBackendSessionForSend,
    submitTextToNewSession,
  }
}
