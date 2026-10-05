import { useCallback, useRef } from 'react'

import { revealTreePane } from '@/components/pane-shell/tree/store'
import { getAllSessionMessages } from '@/hermes'
import { useI18n } from '@/i18n'
import { type ChatMessage, toChatMessages } from '@/lib/chat-messages'
import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import { requestGatewayForAgent } from '@/store/gateway'
import { clearNotifications, notify, notifyError } from '@/store/notifications'
import { ensureGatewayAgent, ensureGatewayProfile } from '@/store/profile'
import { $currentCwd, $messages, $sessions, setFreshDraftReady, setSessionOwnerHint } from '@/store/session'
import { type SessionOwnerRoute, sessionOwnerRouteFromRow } from '@/store/session-request-router'
import { holdSessionOwnerUntilForeground, openSessionTile, patchSessionTile } from '@/store/session-states'
import { broadcastSessionsChanged } from '@/store/session-sync'
import type { SessionCreateResponse } from '@/types/hermes'

import { sessionRoute } from '../../../routes'
import { sessionContextDrift } from '../session-context-drift'

import type { CreateGuard } from './create-guard'
import type { BranchLoadedSessionOptions, SessionActionHandles, SessionActionsOptions } from './options'
import {
  applyRuntimeInfo,
  type BranchMessage,
  cachedSessionRow,
  patchSessionWorkspace,
  resolveSessionProfile,
  resolveStoredSession,
  selectBranchMessages,
  sessionMatchesStoredId,
  toBranchMessages,
  upsertOptimisticSession
} from './utils'

// Identity of one branch create, so a re-entered branch action (a retried
// renderer transition, a double right-click) rides the create already in
// flight instead of minting a second child. The OWNER is part of the identity:
// the same parent id served by two connections is two different sessions.
function branchCreateKey({
  branchCount,
  branchMessages,
  cwd,
  ownerRoute,
  parentStoredId,
  profile,
  sourceSessionId
}: {
  branchCount?: number
  branchMessages: BranchMessage[]
  cwd?: string
  ownerRoute?: SessionOwnerRoute
  parentStoredId: null | string
  profile?: null | string
  sourceSessionId: null | string
}): string {
  return JSON.stringify({
    branchCount: branchCount ?? null,
    connectionId: ownerRoute?.connectionId || null,
    cwd: cwd?.trim() || null,
    messages: sourceSessionId ? null : branchMessagesFingerprint(branchMessages),
    ownerProfile: ownerRoute?.profile || null,
    parentStoredId,
    profile: profile?.trim() || null,
    sourceSessionId
  })
}

const branchMessagesFingerprint = (messages: BranchMessage[]): string =>
  JSON.stringify(messages.map(({ content, role }) => [role, content]))

export function useForkActions(
  {
    activeSessionIdRef,
    busyRef,
    creatingSessionRef,
    ensureSessionState,
    getRouteToken,
    navigate,
    requestGateway,
    selectedStoredSessionIdRef,
    updateSessionState
  }: SessionActionsOptions,
  { createGuard, resumeSession }: Pick<SessionActionHandles, 'resumeSession'> & { createGuard: CreateGuard }
) {
  const { t } = useI18n()
  const copy = t.desktop
  const branchCreateFlightsRef = useRef(new Map<string, Promise<SessionCreateResponse>>())

  // Shared fork: create a child session seeded with `branchMessages`, linked to
  // `parentStoredId` so it nests under its parent, then open it as its own tab
  // and switch to it — the parent chat stays put (mirrors openNewSessionTile).
  // `idempotencyKey` lets a caller-driven retry reuse the SAME key so the
  // backend can dedupe (without it, every call generates a fresh key and a
  // response-lost retry would spawn a duplicate child).
  const forkBranch = useCallback(
    async (
      branchMessages: BranchMessage[],
      sourceSessionId: null | string,
      parentStoredId: null | string,
      cwd?: string,
      profile?: null | string,
      branchCount?: number,
      ownerRoute?: SessionOwnerRoute,
      idempotencyKey?: string
    ): Promise<boolean> => {
      creatingSessionRef.current = true

      // Stable per-attempt key so a backend retry after a lost response returns
      // the SAME child session instead of spawning a duplicate. Generated here
      // for first-time calls; supplied by the retry action on subsequent tries.
      const key = idempotencyKey ?? `branch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

      try {
        // A branch belongs to its parent's OWNING backend. Two facets, and both
        // matter once more than one connection is configured:
        //
        // 1. PROFILE — passing `profile` on the create mirrors
        //    desktopSessionCreateParams/resumeSession: in app-global remote mode
        //    one backend serves every profile, so an omitted profile silently
        //    lands the branch on the launch (default) profile — the "session
        //    jumps between profiles after branching" bug.
        // 2. CONNECTION — a profile name alone does not identify a backend when
        //    several connections expose the same name. Routing on profile only
        //    sends session.create to whatever socket happens to be active, so
        //    branching a remote-owned parent from another connection creates the
        //    child on the wrong backend (or nowhere), while the optimistic
        //    sidebar row below still points at an id no backend owns — the
        //    "Couldn't load this session" strand. removeSession already routes
        //    by (connection, profile); this is the same ownership contract.
        //
        // An untagged parent keeps the historic profile-only path exactly.
        if (ownerRoute) {
          await ensureGatewayAgent(ownerRoute.connectionId, ownerRoute.profile)
        } else {
          await ensureGatewayProfile(profile)
        }

        const requestBranchGateway = <T>(method: string, params: Record<string, unknown>): Promise<T> =>
          ownerRoute
            ? requestGatewayForAgent<T>(ownerRoute.connectionId, ownerRoute.profile, method, params)
            : requestGateway<T>(method, params)

        // The owner is part of the identity: the same parent id on two
        // connections is two different sessions, so a route-blind key would
        // coalesce them onto one create.
        const createKey = branchCreateKey({
          branchCount,
          branchMessages,
          cwd,
          ownerRoute,
          parentStoredId,
          profile,
          sourceSessionId
        })

        let createFlight = branchCreateFlightsRef.current.get(createKey)

        // No title: the backend auto-names the branch from its parent's lineage.
        if (!createFlight) {
          const branchParams = {
            session_id: sourceSessionId,
            // Stable per-attempt key: a lost-response retry of session.branch /
            // session.branch_whole returns the SAME child (#65410).
            idempotency_key: key,
            ...(branchCount !== undefined ? { count: branchCount } : {})
          }

          const createParams = {
            cols: 96,
            source: 'desktop',
            ...(cwd && { cwd }),
            ...(profile ? { profile } : {}),
            ...(parentStoredId && { parent_session_id: parentStoredId }),
            // Stable per-attempt key: a backend retry after a lost response
            // returns the SAME child instead of spawning a duplicate (#65410).
            idempotency_key: key
          }

          createFlight = (
            sourceSessionId
              ? requestBranchGateway<SessionCreateResponse>(
                  branchCount === undefined ? 'session.branch_whole' : 'session.branch',
                  branchParams
                ).catch(err => {
                  if (!isMissingRpcMethod(err)) {
                    throw err
                  }

                  return requestBranchGateway<SessionCreateResponse>('session.branch', branchParams)
                })
              : branchMessages.length
                ? requestBranchGateway<SessionCreateResponse>('session.create', {
                    ...createParams,
                    messages: branchMessages.map(({ content, role }) => ({ content, role }))
                  })
                : requestBranchGateway<SessionCreateResponse>('session.branch_stored', createParams).catch(
                    async err => {
                      if (!isMissingRpcMethod(err)) {
                        throw err
                      }

                      const { messages } = await getAllSessionMessages(parentStoredId ?? '', ownerRoute ?? profile)

                      if (!messages.length) {
                        throw new Error('nothing to branch — send a message first')
                      }

                      return requestBranchGateway<SessionCreateResponse>('session.create', {
                        ...createParams,
                        messages: messages.map(({ content, role }) => ({ content, role }))
                      })
                    }
                  )
          ).catch(err => {
            // Drop the flight so a genuine retry re-issues the create; a
            // resolved flight is cleared once the child is fully published.
            branchCreateFlightsRef.current.delete(createKey)
            throw err
          })
          branchCreateFlightsRef.current.set(createKey, createFlight)
        }

        const branched = await createFlight

        const responseBranchMessages =
          sourceSessionId && branched.messages?.length ? toBranchMessages(toChatMessages(branched.messages)) : []

        const effectiveBranchMessages = responseBranchMessages.length ? responseBranchMessages : branchMessages
        const routedSessionId = branched.stored_session_id ?? branched.session_id
        const runtimeStartedAt = Date.now()
        const preview = effectiveBranchMessages.map(({ content }) => content).find(Boolean) ?? null

        // Record the exact owner and pin its socket THE MOMENT the create
        // returns, before the optimistic row / tile publication can lose a
        // race with the gateway pruner. A draft branch child exists only as a
        // runtime on the owning backend (the stored row lands on first turn),
        // so a prune in this gap orphan-reaps it and the tile enters the
        // resume→reclaim flicker loop (#93892 shape). Mirrors the two routed
        // creates at the top of this file.
        if (ownerRoute) {
          setSessionOwnerHint(routedSessionId, ownerRoute)
          holdSessionOwnerUntilForeground(routedSessionId, ownerRoute)
        }

        // Draft until submit: nest under the parent at the parent's recency so it
        // doesn't bubble to the top until a real message lands (backend persists
        // + auto-names it then). The selected row survives refreshes (sessionsToKeep).
        const rows = $sessions.get()
        const parent = parentStoredId ? rows.find(session => sessionMatchesStoredId(session, parentStoredId)) : null

        const siblings = parentStoredId
          ? rows.filter(session => session.parent_session_id?.trim() === parentStoredId).length
          : 0

        setFreshDraftReady(false)
        // Stamp the optimistic row with the branch's EXACT owner. Without it the
        // row inherits $activeGatewayProfile and carries no connection_id, so a
        // child correctly created on the parent's remote backend is listed as
        // belonging to whichever backend happens to be active. Every later
        // owner lookup off that row (resume, hydrate, prompt) then routes to the
        // wrong machine and the chat pane spins on a session that backend never
        // had — the create is right, the row is a lie. Mirrors the routed
        // creates at the top of this file, which already pass their route here.
        upsertOptimisticSession(
          branched,
          routedSessionId,
          copy.branchTitle(siblings + 1).toLowerCase(),
          preview,
          parentStoredId,
          parent ? parent.last_active || parent.started_at : undefined,
          ownerRoute ?? null
        )
        ensureSessionState(branched.session_id, routedSessionId)
        updateSessionState(
          branched.session_id,
          state => ({
            ...state,
            runtimeStartedAt,
            messages: effectiveBranchMessages.map(({ source }) => source),
            busy: false,
            awaitingResponse: false
          }),
          routedSessionId
        )

        const runtimeInfo = applyRuntimeInfo(branched.info, { foreground: false })
        patchSessionWorkspace(routedSessionId, runtimeInfo?.cwd)

        if (runtimeInfo) {
          updateSessionState(branched.session_id, state => ({ ...state, ...runtimeInfo }), routedSessionId)
        }

        // Only take over the main pane when the chat being branched is the one
        // already open there — branching a background/sidebar session must
        // not yank the user's current view away from what they're looking at
        // (the #69750 focus-stealing bug, reintroduced if this fires
        // unconditionally). resumeSession reuses the runtime warm-cached above
        // (ensureSessionState/updateSessionState) instead of an extra resume RPC.
        if (parentStoredId !== null && selectedStoredSessionIdRef.current === parentStoredId) {
          navigate(sessionRoute(routedSessionId), { replace: true })
          await resumeSession(routedSessionId)
        } else {
          // Carry the exact owner onto the tile: its persisted ownerRoute is
          // what pins the owning backend's socket in the gateway keep-set
          // (openTileGatewayScopes) for the tile's whole lifetime. Without it
          // a remote-owned branch child's tile pinned nothing, the pruner
          // closed the owner socket, the backend reaped the draft runtime,
          // and the tile looped resume→reclaim until the storm breaker
          // latched "Couldn't open this session".
          openSessionTile(routedSessionId, 'center', undefined, null, {
            ownerRoute,
            workspaceMode: 'sessions'
          })
          patchSessionTile(routedSessionId, { runtimeId: branched.session_id })
          revealTreePane(`session-tile:${routedSessionId}`)
        }

        branchCreateFlightsRef.current.delete(createKey)
        broadcastSessionsChanged()

        return true
      } catch (err) {
        // Navigate throw or earlier failure after arming pending — never leave
        // creatingSessionRef stuck true.
        createGuard.releaseCreatingSessionGuard()
        // Backend restart / WS drop mid-RPC leaves the branch uncreated with no
        // recovery path. Surface a persistent error with a retry action so the
        // user can re-attempt without re-doing the whole branch flow. The retry
        // passes the SAME idempotency key so the backend can dedupe if the
        // first create actually committed but its response was lost.
        notifyError(err, copy.branchFailed, {
          action: {
            label: t.common.retry,
            onClick: () => {
              void forkBranch(
                branchMessages,
                sourceSessionId,
                parentStoredId,
                cwd,
                profile,
                branchCount,
                ownerRoute,
                key
              )
            }
          }
        })

        return false
      } finally {
        if (!createGuard.pendingCreatedStoredSessionIdRef.current) {
          creatingSessionRef.current = false
        }
      }
    },
    [
      copy,
      createGuard,
      creatingSessionRef,
      ensureSessionState,
      navigate,
      requestGateway,
      resumeSession,
      selectedStoredSessionIdRef,
      t,
      updateSessionState
    ]
  )

  // Branch a session whose live transcript is already loaded in this renderer.
  // Both the main chat and session tiles use this path so a clicked message id
  // is resolved against the exact message array that rendered the action bar.
  const branchLoadedSession = useCallback(
    async ({
      busy,
      contextDrift,
      cwd,
      messageId,
      messages,
      runtimeId,
      storedSessionId
    }: BranchLoadedSessionOptions) => {
      if (!runtimeId) {
        notify({ kind: 'warning', title: copy.nothingToBranch, message: copy.branchNeedsChat })

        return false
      }

      if (busy) {
        notify({ kind: 'warning', title: copy.sessionBusy, message: copy.branchStopCurrent })

        return false
      }

      // Message-level branches still need the local message id to choose their
      // prefix. Whole-chat branches send only the parent identity below; the
      // backend reads the durable display projection without materializing it in
      // the renderer.
      let authoritativeMessages: ChatMessage[] | null = null
      const profile = await resolveSessionProfile(storedSessionId)

      // The open chat's exact owner, when its row carries a connection tag.
      // Same contract as branchStoredSession: the transcript read and the
      // branch RPC must both land on the backend that owns the parent, not on
      // whichever socket is active.
      const ownerRoute = storedSessionId ? sessionOwnerRouteFromRow(cachedSessionRow(storedSessionId)) : undefined

      if (messageId && storedSessionId) {
        try {
          const persisted = await getAllSessionMessages(storedSessionId, ownerRoute ?? profile)
          const hydrated = toChatMessages(persisted.messages)

          if (hydrated.length) {
            authoritativeMessages = hydrated
          }
        } catch {
          // The branch RPC has a backend-side display projection fallback.
        }
      }

      const drift = contextDrift?.()

      if (drift) {
        console.warn('[branch-drift-abort]', drift, {
          phase: 'transcript-hydration'
        })

        return false
      }

      const branchMessages = messageId ? selectBranchMessages(messages, authoritativeMessages, messageId) : []

      if (messageId && !branchMessages.length) {
        notify({ kind: 'warning', title: copy.nothingToBranch, message: copy.branchNoText })

        return false
      }

      clearNotifications()

      return forkBranch(
        branchMessages,
        runtimeId,
        storedSessionId,
        cwd?.trim(),
        profile,
        messageId ? branchMessages.length : undefined,
        ownerRoute
      )
    },
    [copy, forkBranch]
  )

  // Branch the open chat — optionally from a specific message — off its live transcript.
  const branchCurrentSession = useCallback(
    (messageId?: string): Promise<boolean> => {
      const runtimeId = activeSessionIdRef.current
      const storedSessionId = selectedStoredSessionIdRef.current
      const routeToken = getRouteToken()

      return branchLoadedSession({
        busy: busyRef.current,
        contextDrift: () => {
          const drift = sessionContextDrift({
            startRouteToken: routeToken,
            nowRouteToken: getRouteToken(),
            startSelectedStoredId: storedSessionId,
            nowSelectedStoredId: selectedStoredSessionIdRef.current
          })

          if (drift) {
            return drift
          }

          if (activeSessionIdRef.current !== runtimeId) {
            return 'runtime-changed'
          }

          return selectedStoredSessionIdRef.current === storedSessionId ? null : 'selection-changed'
        },
        cwd: $currentCwd.get(),
        messageId,
        messages: $messages.get(),
        runtimeId,
        storedSessionId
      })
    },
    [activeSessionIdRef, branchLoadedSession, busyRef, getRouteToken, selectedStoredSessionIdRef]
  )

  // Branch any listed session, not just the open one. Reads the target's stored
  // transcript directly (no resume/active-session dependency), so it works on
  // right-click and nests under its parent.
  const branchStoredSession = useCallback(
    async (storedSessionId: string, sessionProfile?: string | null): Promise<boolean> => {
      clearNotifications()

      // Right-clicking a session outside the paginated sidebar window is a cache
      // miss: resolve it (cache → active backend → cross-profile) so the branch
      // is created on the parent's OWNING profile, not whichever is live (#67603).
      // cachedSessionRow spans Recents, cron/messaging and the profile-scoped
      // project tree, and prefers the self-describing row — an ownerless legacy
      // Recents copy of the same id must not mask the row carrying the owner.
      const stored =
        cachedSessionRow(storedSessionId) ?? (sessionProfile ? undefined : await resolveStoredSession(storedSessionId))

      const profile = sessionProfile ?? stored?.profile

      // An exact owner from the parent row — connection AND profile. Undefined
      // for an untagged row, which keeps the ambient/profile-only path.
      const ownerRoute = sessionOwnerRouteFromRow(stored)

      try {
        if (ownerRoute) {
          await ensureGatewayAgent(ownerRoute.connectionId, ownerRoute.profile)
        } else {
          await ensureGatewayProfile(profile)
        }

        // Ask the owning backend to read and copy the parent transcript. The
        // renderer deliberately does not materialize the complete history.
        return await forkBranch(
          [],
          null,
          stored?.id ?? storedSessionId,
          stored?.cwd?.trim(),
          profile,
          undefined,
          ownerRoute
        )
      } catch (err) {
        notifyError(err, copy.branchFailed)

        return false
      }
    },
    [copy, forkBranch]
  )

  return {
    forkBranch,
    branchCurrentSession,
    branchLoadedSession,
    branchStoredSession
  }
}
