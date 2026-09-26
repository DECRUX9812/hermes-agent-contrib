import { connectionScopedAtom } from '@/lib/connection-scoped'
import { Codecs } from '@/lib/persisted'

import { $sessions, lineageAliases, sessionMatchesStoredId, sessionPinId } from './session'

// Per-session notification mute (Industry 2.10): the quiet set is persisted
// per profile via the same connection scope as pins — remote connections key
// it `.remote.<base>.<profile>`, local profiles share the bare key because a
// stored id only exists in one home's database. Muted sessions still emit to
// the in-app history (mute silences the interruption, not the record).
const MUTED_SESSIONS_STORAGE_KEY = 'sidebar.mutedSessionIds'

/** Durable stored ids whose notifications are silenced. */
export const $mutedSessionIds = connectionScopedAtom(MUTED_SESSIONS_STORAGE_KEY, [] as string[], Codecs.stringArray)

/** Accepts any stored/lineage id — compression rotates live ids, so the check
 *  resolves through lineage aliases and the durable pin id. Callers holding a
 *  runtime id should translate via `storedSessionIdForRuntimeId` first. */
export function isSessionMuted(sessionId: string): boolean {
  const muted = $mutedSessionIds.get()

  if (muted.length === 0) {
    return false
  }

  if (muted.includes(sessionId)) {
    return true
  }

  const sessions = $sessions.get()
  const session = sessions.find(s => sessionMatchesStoredId(s, sessionId))

  if (session && muted.includes(sessionPinId(session))) {
    return true
  }

  return lineageAliases(sessionId, sessions).some(alias => muted.includes(alias))
}

/** Returns the new muted state. Stores the durable (pin) id so the mute
 *  survives auto-compression's id rotation. */
export function toggleSessionMuted(storedSessionId: string): boolean {
  const sessions = $sessions.get()
  const session = sessions.find(s => sessionMatchesStoredId(s, storedSessionId))
  const durableId = session ? sessionPinId(session) : storedSessionId
  const muted = new Set($mutedSessionIds.get())

  if (muted.delete(durableId)) {
    $mutedSessionIds.set([...muted])

    return false
  }

  muted.add(durableId)
  $mutedSessionIds.set([...muted])

  return true
}
