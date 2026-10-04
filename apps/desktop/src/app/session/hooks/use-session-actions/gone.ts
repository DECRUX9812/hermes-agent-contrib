import {useCallback} from 'react'

import {deleteSession} from '@/hermes'
import {useI18n} from '@/i18n'
import {purgeInFlightTurnJournals} from '@/lib/inflight-turn-journal'
import {clearClarifyRequest} from '@/store/clarify'
import {resetSessionBackground} from '@/store/composer-status'
import {clearQueuedPrompts} from '@/store/composer-queue'
import {clearSessionGoal} from '@/store/goals'
import {$pinnedSessionIds} from '@/store/layout'
import {clearNotifications, notifyError} from '@/store/notifications'
import {prunePreviewTabsForSession} from '@/store/preview'
import {$profiles} from '@/store/profile'
import {clearAllPrompts} from '@/store/prompts'
import {clearSessionSubagents} from '@/store/subagents'
import {$messages, sessionPinId, setActiveSessionId, setFreshDraftReady, setMessages, setSelectedStoredSessionId} from '@/store/session'
import {clearSessionControl} from '@/store/session-control'
import {beginSessionMutation, endSessionMutation, tombstoneSessions, untombstoneSessions} from '@/store/session-removal'
import {requestForSessionProfile, type SessionOwnerScope} from '@/store/session-request-router'
import {closeSessionTile, dropSessionState} from '@/store/session-states'
import {forgetSessionUnread} from '@/store/session-unread'
import {clearSessionTodos} from '@/store/todos'
import {$archivedSessions} from '@/store/sidebar-archive'
import {dropTranscriptTailEverywhere} from '@/store/transcript-tail-cache'

import {sessionRoute} from '../../../routes'
import type {ClientSessionState} from '../../../types'

import type { SessionActionHandles, SessionActionsOptions } from './options'
import { applyStoredUsage } from './resume'
import {dropListedSession, findListedSession, isSessionGoneError, resolveSessionProfile, restoreListedSession, sessionMatchesStoredId} from './utils'

export function useGoneActions(
  { activeSessionIdRef, navigate, requestGateway, runtimeIdByStoredSessionIdRef, selectedStoredSessionIdRef, sessionStateByRuntimeIdRef, updateSessionState }: SessionActionsOptions,
  { startFreshSessionDraft }: Pick<SessionActionHandles, 'startFreshSessionDraft'>
) {
  const { t } = useI18n()
  const copy = t.desktop

  const removeSession = useCallback(
    async (storedSessionId: string) => {
      clearNotifications()

      // The row may live in the main list, the messaging/cron sidebar slices,
      // OR the archived view's own store (archived rows are excluded from
      // $sessions by design). Resolve from all of them so deleting a
      // messaging/cron row (or from the Archived filter) evicts the row
      // instead of leaving a ghost that resumes into a dead id.
      const listed = findListedSession(storedSessionId)

      const removed =
        listed?.session ?? $archivedSessions.get().find(session => sessionMatchesStoredId(session, storedSessionId))

      // Messaging/cron rows frequently arrive without an inline profile; fall
      // back to the stored-session ownership lookup so their DELETE routes to
      // the owning profile instead of the ambient one.
      const stampedProfile = removed?.profile?.trim()
      const profile = stampedProfile || (await resolveSessionProfile(storedSessionId))

      // Listed profile-less row + multiple profiles + unresolved owner:
      // never fall through to the primary backend (fake already_absent).
      if (
        listed &&
        !stampedProfile &&
        !profile?.trim() &&
        $profiles.get().filter(item => item.name.trim()).length > 1
      ) {
        notifyError(new Error('Session ownership could not be resolved'), copy.deleteFailed)

        return
      }

      // Selection and runtime refs are updated synchronously at routing
      // boundaries. React props can still describe the previous render when a
      // delete lands in the same tick, which used to leave the doomed route in
      // place and let the generic 4001 recovery rebind it.
      const wasSelected = selectedStoredSessionIdRef.current === storedSessionId

      // Resolve the doomed session's live runtime from the SELECTION or the
      // stored→runtime map. Deleting a NON-selected (sidebar/background) session
      // used to skip this entirely, so its in-flight turn kept running and could
      // surface an approval/clarify prompt for a conversation that no longer
      // exists (#75587).
      const closingRuntimeId =
        (wasSelected ? activeSessionIdRef.current : null) ??
        runtimeIdByStoredSessionIdRef.current.get(storedSessionId) ??
        null

      const previousMessages = $messages.get()
      const previousPinned = $pinnedSessionIds.get()

      const removedOwner: SessionOwnerScope = removed?.connection_id
        ? {
            connectionId: removed.connection_id,
            profile: removed.profile || 'default'
          }
        : profile

      const previousArchived = $archivedSessions.get()
      // Pins are keyed on the durable lineage-root id; the stored id may be the
      // live tip after compression. Drop both so the pin can't linger.
      const removedPinId = removed ? sessionPinId(removed) : storedSessionId
      const removedIds = [storedSessionId, removed?.id, removed?._lineage_root_id]

      dropListedSession(storedSessionId)
      $archivedSessions.set(previousArchived.filter(session => !sessionMatchesStoredId(session, storedSessionId)))
      // Evict from the project tree's optimistic layer too (the backend snapshot
      // still lists it until its next refresh), so grouped + flat views drop the
      // row in lockstep. Pin the tombstone against the projects.tree prune while
      // the delete RPC is in flight, so a racing refresh can't flash it back.
      tombstoneSessions(removedIds)
      beginSessionMutation(removedIds)
      $pinnedSessionIds.set(previousPinned.filter(id => id !== storedSessionId && id !== removedPinId))

      // Tear down before awaiting so the route effect can't resume the
      // doomed session via the stale /<sid> URL.
      if (wasSelected) {
        startFreshSessionDraft(true)
      }

      try {
        if (closingRuntimeId) {
          // Deleting a session must END its turn, not just drop the row.
          // `session.close` tears down the runtime but does not walk the
          // interrupt path that releases approval / clarify / sudo / secret
          // waits, so a blocked run could outlive its sidebar row and surface a
          // blocking prompt (and native notification) for a conversation that is
          // gone (#75587). Mark the runtime interrupted first so a
          // blocking-input request already queued on the transport is dropped
          // instead of parking its overlay, then interrupt, then close.
          let previousInterruptState: Pick<ClientSessionState, 'interrupted' | 'needsInput'> | null = null

          updateSessionState(closingRuntimeId, state => {
            previousInterruptState = { interrupted: state.interrupted, needsInput: state.needsInput }

            return { ...state, interrupted: true, needsInput: false }
          })

          try {
            await requestForSessionProfile(removedOwner, requestGateway, 'session.interrupt', {
              session_id: closingRuntimeId
            })
          } catch (error) {
            // A missing runtime has no turn left to stop. Any other failure means
            // deletion cannot safely continue: restore the live state and let the
            // outer rollback put the conversation back in the sidebar.
            if (!isSessionGoneError(error)) {
              updateSessionState(closingRuntimeId, state =>
                previousInterruptState ? { ...state, ...previousInterruptState } : state
              )
              throw error
            }
          }

          // Catch a blocking-input request already queued before the interrupted
          // flag became visible to this renderer.
          clearAllPrompts(closingRuntimeId)
          clearClarifyRequest(undefined, closingRuntimeId)

          await requestForSessionProfile(removedOwner, requestGateway, 'session.close', {
            session_id: closingRuntimeId
          }).catch(() => undefined)
        }

        await deleteSession(storedSessionId, removedOwner)

        dropTranscriptTailEverywhere(storedSessionId)
        // Only after the RPC lands — the optimistic eviction above can roll
        // back, and a rolled-back row must keep its watermark/marker.
        forgetSessionUnread(removedIds, profile)
        clearQueuedPrompts(storedSessionId)
        // The journaled in-flight tail holds this session's prompt and tool
        // calls in localStorage; a deleted session must not leave that copy
        // behind to age out on its own. Purge after the RPC lands (same
        // rollback argument as the unread watermark above), passing every id
        // the delete holds: the stored tip, the row id, the lineage root, and
        // the closing runtime id — the journal keys on the stored id.
        purgeInFlightTurnJournals([...removedIds, closingRuntimeId])

        // Preview tabs are session-owned: drop them with the session (pinned
        // tabs survive — they belong to the workspace, not the session).
        for (const id of removedIds) {
          if (id) {
            prunePreviewTabsForSession(id)
          }
        }

        if (closingRuntimeId) {
          clearQueuedPrompts(closingRuntimeId)
          clearSessionControl(closingRuntimeId)
        }

        // A tiled copy of this session must not outlive it: collapse the pane
        // and evict its mirrored runtime state so nothing submits to (or renders)
        // a deleted session.
        const tiledRuntimeId = runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
        closeSessionTile(storedSessionId)

        if (tiledRuntimeId) {
          runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
          sessionStateByRuntimeIdRef.current.delete(tiledRuntimeId)
          dropSessionState(tiledRuntimeId)
        }

        // Live per-session stores (the same four the stop paths clear) key on
        // the gateway event's session_id, i.e. the runtime id. When the deleted
        // row is selected, closingRuntimeId is the foreground runtime, which can
        // differ from the stored→runtime mapping (cached/tiled runtime), so
        // clear the stored id and both runtime ids — once per distinct id.
        for (const sid of new Set([storedSessionId, closingRuntimeId, tiledRuntimeId].filter(Boolean) as string[])) {
          clearSessionSubagents(sid)
          clearSessionTodos(sid)
          clearSessionGoal(sid)
          resetSessionBackground(sid)
        }
      } catch (err) {
        if (listed?.session) {
          restoreListedSession(listed.session, listed.slice)
        }

        // Restore the archived-view row too (no-op when it wasn't archived).
        $archivedSessions.set(previousArchived)

        untombstoneSessions(removedIds)
        $pinnedSessionIds.set(previousPinned)

        if (wasSelected) {
          setFreshDraftReady(false)
          setSelectedStoredSessionId(storedSessionId)
          selectedStoredSessionIdRef.current = storedSessionId
          const stored = findListedSession(storedSessionId)?.session

          if (stored) {
            applyStoredUsage(stored)
          }

          setMessages(previousMessages)
          navigate(sessionRoute(storedSessionId), { replace: true })

          if (closingRuntimeId) {
            setActiveSessionId(closingRuntimeId)
            activeSessionIdRef.current = closingRuntimeId
          }
        }

        notifyError(err, copy.deleteFailed)
      } finally {
        // Release the tombstone to the normal projects.tree prune now the RPC has
        // settled (kept on success — the backend has deleted it; cleared on the
        // rollback above on failure).
        endSessionMutation(removedIds)
      }
    },
    [
      activeSessionIdRef,
      copy,
      navigate,
      requestGateway,
      runtimeIdByStoredSessionIdRef,
      selectedStoredSessionIdRef,
      sessionStateByRuntimeIdRef,
      startFreshSessionDraft,
      updateSessionState
    ]
  )

  return {
    removeSession,
  }
}
