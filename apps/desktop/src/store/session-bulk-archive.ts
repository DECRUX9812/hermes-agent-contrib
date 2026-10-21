/**
 * Bulk archive for the sessions rail (Industry 2.9): "file the whole drawer"
 * commands behind the palette and the sidebar filter menu. One confirmation,
 * then each row goes through the same `sessionTileDelegate().archiveSession`
 * path a row's own context menu uses — optimistic drop, tombstone, tile
 * close — so the sweep can't diverge from single-archive semantics.
 */
import { translateNow } from '@/i18n'

import { confirm } from './confirm'
import { $pinnedSessionIds } from './layout'
import { notify } from './notifications'
import { $cronSessions, $messagingSessions, $sessions, sessionPinId } from './session'
import { $sessionDotStateById, sessionStatusBucket } from './session-dot-state'
import { sessionTileDelegate } from './session-states'

const DAY_MS = 86_400_000

/**
 * A rail row archives when it is done AND seen: `idle` (not mid-turn, not
 * waiting on input, not an unsent draft) and read — an unread result keeps
 * its signal in the rail. Pinned rows are exempt on both sides of the pin
 * (the server flag and the local ordering hint); the backend's auto-archive
 * honors the same pins.
 */
function archivableIds(olderThanDays?: number, nowMs = Date.now()): string[] {
  const dots = $sessionDotStateById.get()
  const pinned = new Set($pinnedSessionIds.get())
  const cutoffSec = olderThanDays === undefined ? null : (nowMs - olderThanDays * DAY_MS) / 1000
  const seen = new Set<string>()
  const ids: string[] = []

  for (const pool of [$sessions.get(), $messagingSessions.get(), $cronSessions.get()]) {
    for (const session of pool) {
      if (seen.has(session.id)) {
        continue
      }

      seen.add(session.id)

      if (session.pinned === true || pinned.has(sessionPinId(session))) {
        continue
      }

      if (sessionStatusBucket(dots[session.id]) !== 'idle') {
        continue
      }

      if (cutoffSec !== null && (session.last_active || session.started_at || 0) >= cutoffSec) {
        continue
      }

      ids.push(session.id)
    }
  }

  return ids
}

/** The rail's finished sessions: idle, read, unpinned — safe to file away. */
export function finishedSessionIds(nowMs = Date.now()): string[] {
  return archivableIds(undefined, nowMs)
}

/** Idle/read/unpinned rows untouched for at least `days` days. */
export function idleOlderThanSessionIds(days: number, nowMs = Date.now()): string[] {
  return archivableIds(days, nowMs)
}

/**
 * Archive ids one at a time through the shared tile delegate. Sequential on
 * purpose: each archive fans out through optimistic store edits and a
 * session.patch RPC, and a burst of them would interleave those edits.
 */
export async function archiveSessions(ids: readonly string[]): Promise<number> {
  const delegate = sessionTileDelegate()

  if (!delegate) {
    return 0
  }

  let archived = 0

  for (const id of ids) {
    try {
      await delegate.archiveSession(id)
      archived += 1
    } catch {
      // archiveSession already notifies on failure — keep sweeping the rest.
    }
  }

  return archived
}

/**
 * The whole bulk-archive command: resolve candidates, confirm once, sweep,
 * report. Shared by the palette entries and the filter menu so both doors
 * run the identical flow.
 */
export async function runBulkArchive(olderThanDays?: number): Promise<void> {
  const ids = olderThanDays === undefined ? finishedSessionIds() : idleOlderThanSessionIds(olderThanDays)

  if (ids.length === 0) {
    notify({ kind: 'info', message: translateNow('sidebar.archive.none') })

    return
  }

  const ok = await confirm({
    confirmLabel: translateNow('sidebar.archive.confirmAction'),
    description: translateNow('sidebar.archive.confirmBody'),
    title: translateNow('sidebar.archive.confirmTitle', ids.length)
  })

  if (!ok) {
    return
  }

  const archived = await archiveSessions(ids)

  if (archived > 0) {
    notify({ kind: 'success', message: translateNow('sidebar.archive.done', archived) })
  }
}
