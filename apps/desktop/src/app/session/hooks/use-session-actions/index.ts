import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { migrateSessionDraft } from '@/store/composer'
import { migrateQueuedPrompts } from '@/store/composer-queue'
import {
  $activeSessionStoredIdRotation,
  $sessions,
  idsShareLineage,
  resolveComposerSessionKey,
  setActiveSessionStoredIdRotation,
  setSelectedStoredSessionId
} from '@/store/session'
import { $focusedStoredSessionId, isSessionInForeground } from '@/store/session-states'

import { sessionRoute } from '../../../routes'

import { useArchiveActions } from './archive'
import { useCreateActions } from './create'
import { useCreateGuard } from './create-guard'
import { useForkActions } from './fork'
import { useGoneActions } from './gone'
import { useOpenActions } from './open'
import type { SessionActionsOptions } from './options'
import { useResumeActions } from './resume'
import { useTileRoutingActions } from './tile-routing'

export type { BranchLoadedSessionOptions, SessionActionsOptions } from './options'

export function useSessionActions(options: SessionActionsOptions) {
  const {
    activeSessionId,
    activeSessionIdRef,
    getRoutedStoredSessionId,
    navigate,
    selectedStoredSessionId,
    selectedStoredSessionIdRef
  } = options

  // Follow auto-compression's stored-id rotation only while the exact runtime,
  // selection, and route intent still belong to the rotating conversation.
  // The previous implementation carried only the next stored id and navigated
  // unconditionally; a fast A → B → C switch could therefore be overwritten
  // by A's delayed session.info event and visibly jump back to A.
  const storedIdRotation = useStore($activeSessionStoredIdRotation)
  const storedSessions = useStore($sessions)
  const focusedStoredSessionId = useStore($focusedStoredSessionId)
  const routedStoredSessionId = getRoutedStoredSessionId()

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    if (!storedIdRotation) {
      return
    }

    const selectedAtEffect = selectedStoredSessionIdRef.current
    const previousId = storedIdRotation.previousStoredSessionId
    const nextId = storedIdRotation.nextStoredSessionId

    // A tile can adopt the exact successor before the refreshed sessions list
    // contains it. The rotation itself proves that this focus is the same live
    // runtime; unrelated focused chats still fail the foreground check.
    const focusedOnRotatedLineage = Boolean(
      focusedStoredSessionId &&
      (focusedStoredSessionId === nextId || idsShareLineage(focusedStoredSessionId, nextId, storedSessions))
    )

    const rotationIsStale =
      activeSessionIdRef.current !== storedIdRotation.runtimeSessionId ||
      selectedAtEffect !== previousId ||
      (routedStoredSessionId !== null && routedStoredSessionId !== previousId)

    if (rotationIsStale) {
      // The user moved to another conversation, so this proof must not replay.
      setActiveSessionStoredIdRotation(current => (current === storedIdRotation ? null : current))

      return
    }

    if (!isSessionInForeground(previousId) && !focusedOnRotatedLineage) {
      // Focus moved to an unrelated tile, but route and selection still name
      // this conversation. Keep the proof so steering can use it until focus
      // or the session list catches up.
      return
    }

    // Consume only once the successor can safely take over the visible session.
    setActiveSessionStoredIdRotation(current => (current === storedIdRotation ? null : current))

    // Park unsent draft/queue on the durable lineage key (not the new tip).
    // ChatBar scopes composer state on resolveComposerSessionKey(); migrating
    // onto the tip while the composer is still bound to the root can lose newer
    // live editor text on a brief remount. If the new tip row is not in
    // $sessions yet, resolveComposerSessionKey falls back to the tip id — prefer
    // the previous id (usually the lineage root) in that gap.
    const resolvedNext = resolveComposerSessionKey(nextId, storedSessions)

    const durableKey =
      resolvedNext && resolvedNext !== nextId
        ? resolvedNext
        : (resolveComposerSessionKey(previousId, storedSessions) ?? previousId)

    migrateSessionDraft(previousId, durableKey)
    migrateSessionDraft(nextId, durableKey)
    migrateQueuedPrompts(previousId, durableKey)
    migrateQueuedPrompts(nextId, durableKey)

    setSelectedStoredSessionId(nextId)
    selectedStoredSessionIdRef.current = nextId

    // A route overlay/page has no routed session id, but the underlying selected
    // chat still needs to follow the continuation. Update that selection in
    // place without navigating out of the surface the user deliberately opened.
    if (routedStoredSessionId === previousId) {
      navigate(sessionRoute(nextId), { replace: true })
    }
  }, [
    activeSessionId,
    activeSessionIdRef,
    focusedStoredSessionId,
    getRoutedStoredSessionId,
    navigate,
    routedStoredSessionId,
    selectedStoredSessionId,
    selectedStoredSessionIdRef,
    storedIdRotation,
    storedSessions
  ])

  const createGuard = useCreateGuard(options)
  const { startFreshSessionDraft, createBackendSessionForSend, submitTextToNewSession } = useCreateActions(options, {
    createGuard
  })
  const { openNewSessionTile } = useTileRoutingActions(options)
  const { selectSidebarItem, openSettings, closeSettings } = useOpenActions(options, { startFreshSessionDraft })
  const { resumeSession } = useResumeActions(options, { startFreshSessionDraft })
  const { removeSession } = useGoneActions(options, { startFreshSessionDraft })
  const { archiveSession, unarchiveSession } = useArchiveActions(options, { startFreshSessionDraft })
  const { forkBranch, branchCurrentSession, branchLoadedSession, branchStoredSession } = useForkActions(options, {
    createGuard,
    resumeSession
  })

  return {
    archiveSession,
    branchCurrentSession,
    branchLoadedSession,
    branchStoredSession,
    closeSettings,
    createBackendSessionForSend,
    openNewSessionTile,
    openSettings,
    removeSession,
    resumeSession,
    selectSidebarItem,
    startFreshSessionDraft,
    submitTextToNewSession,
    unarchiveSession
  }
}
