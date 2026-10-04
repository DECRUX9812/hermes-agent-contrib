import {useCallback} from 'react'

import {setSessionArchived} from '@/hermes'
import {useI18n} from '@/i18n'
import {$pinnedSessionIds} from '@/store/layout'
import {clearNotifications, notify, notifyError} from '@/store/notifications'
import {$profiles} from '@/store/profile'
import {sessionPinId} from '@/store/session'
import {beginSessionMutation, endSessionMutation, tombstoneSessions, untombstoneSessions} from '@/store/session-removal'
import {closeSessionTile, dropSessionState} from '@/store/session-states'
import {forgetSessionUnread} from '@/store/session-unread'
import {$archivedSessions} from '@/store/sidebar-archive'

import type { SessionActionHandles, SessionActionsOptions } from './options'
import {dropListedSession, findListedSession, resolveSessionProfile, restoreListedSession, sessionMatchesStoredId} from './utils'

export function useArchiveActions(
  { runtimeIdByStoredSessionIdRef, selectedStoredSessionIdRef, sessionStateByRuntimeIdRef }: SessionActionsOptions,
  { startFreshSessionDraft }: Pick<SessionActionHandles, 'startFreshSessionDraft'>
) {
  const { t } = useI18n()
  const copy = t.desktop

  const archiveSession = useCallback(
    async (storedSessionId: string) => {
      clearNotifications()

      const listed = findListedSession(storedSessionId)
      const archived = listed?.session
      const stampedProfile = archived?.profile?.trim()
      const profile = stampedProfile || (await resolveSessionProfile(storedSessionId))

      if (
        listed &&
        !stampedProfile &&
        !profile?.trim() &&
        $profiles.get().filter(item => item.name.trim()).length > 1
      ) {
        notifyError(new Error('Session ownership could not be resolved'), copy.archiveFailed)

        return
      }

      const wasSelected = selectedStoredSessionIdRef.current === storedSessionId
      const previousPinned = $pinnedSessionIds.get()
      // Pins are keyed on the durable lineage-root id; the stored id may be the
      // live tip after compression. Drop both so the pin can't linger.
      const archivedPinId = archived ? sessionPinId(archived) : storedSessionId
      const archivedIds = [storedSessionId, archived?.id, archived?._lineage_root_id]

      // Soft-hide: drop from every sidebar slice immediately, keep the data.
      dropListedSession(storedSessionId)
      tombstoneSessions(archivedIds)
      beginSessionMutation(archivedIds)
      $pinnedSessionIds.set(previousPinned.filter(id => id !== storedSessionId && id !== archivedPinId))

      if (wasSelected) {
        startFreshSessionDraft(true)
      }

      try {
        await setSessionArchived(storedSessionId, true, profile)
        // Archived rows never reach the sidebar, so their persisted unread can
        // only rot. Dropped after the RPC so a failed archive keeps it.
        forgetSessionUnread(archivedIds, profile)
        // An archived session is hidden from the sidebar; its tile must go too.
        const tiledRuntimeId = runtimeIdByStoredSessionIdRef.current.get(storedSessionId)
        closeSessionTile(storedSessionId)

        if (tiledRuntimeId) {
          runtimeIdByStoredSessionIdRef.current.delete(storedSessionId)
          sessionStateByRuntimeIdRef.current.delete(tiledRuntimeId)
          dropSessionState(tiledRuntimeId)
        }

        notify({ durationMs: 2_000, kind: 'success', message: copy.archived })
      } catch (err) {
        if (archived) {
          restoreListedSession(archived, listed?.slice)
        }

        untombstoneSessions(archivedIds)
        $pinnedSessionIds.set(previousPinned)
        notifyError(err, copy.archiveFailed)
      } finally {
        endSessionMutation(archivedIds)
      }
    },
    [
      copy,
      runtimeIdByStoredSessionIdRef,
      selectedStoredSessionIdRef,
      sessionStateByRuntimeIdRef,
      startFreshSessionDraft
    ]
  )

  // The Archived view reuses the sidebar row menu; its already-archived rows
  // dispatch here through the same archive verb (#98813). Mirrors the Settings
  // → Archived Chats restore (sessions-settings.tsx): flip the persisted flag
  // back off, drop the archived-view row, and resurface the session in the
  // sidebar without waiting for a full refresh.
  const unarchiveSession = useCallback(
    async (storedSessionId: string) => {
      clearNotifications()

      const archived = $archivedSessions.get().find(session => sessionMatchesStoredId(session, storedSessionId))
      const profile = archived?.profile?.trim() || undefined

      try {
        await setSessionArchived(storedSessionId, false, profile)

        // Drop the archived-view row first so the view reflects the restore
        // even when the session cannot be re-listed below (e.g. it belongs to
        // a profile the current query does not cover).
        $archivedSessions.set(
          $archivedSessions.get().filter(session => !sessionMatchesStoredId(session, storedSessionId))
        )

        if (archived) {
          // Lift any optimistic eviction so the grouped tree shows it again,
          // and re-list through the slice router so a messaging/cron row lands
          // back in its own list, not the sessions one.
          untombstoneSessions([storedSessionId, archived._lineage_root_id])
          restoreListedSession({ ...archived, archived: false })
        }

        notify({ durationMs: 2_000, kind: 'success', message: copy.restored })
      } catch (err) {
        notifyError(err, copy.unarchiveFailed)
      }
    },
    [copy]
  )

  return {
    archiveSession,
    unarchiveSession,
  }
}
