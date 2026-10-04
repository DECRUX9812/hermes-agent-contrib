import { connectionScopedAtom } from '@/lib/connection-scoped'
import { Codecs } from '@/lib/persisted'

import { $sessions, lineageAliases, sessionMatchesStoredId, sessionPinId } from './session'

// "Where it left off" recap dismissal (#13): per-session, persisted per
// profile via the same connection scope as mutes/pins — remote connections
// key it `.remote.<base>.<profile>`, local profiles share the bare key because
// a stored id only exists in one home's database.
const RECAP_DISMISSED_STORAGE_KEY = 'chat.recapDismissedSessionIds'

/** Durable stored ids whose recap card was dismissed. */
export const $sessionRecapDismissedIds = connectionScopedAtom(
  RECAP_DISMISSED_STORAGE_KEY,
  [] as string[],
  Codecs.stringArray
)

/** Accepts any stored/lineage id — compression rotates live ids, so the check
 *  resolves through lineage aliases and the durable pin id (same contract as
 *  isSessionMuted). */
export function isSessionRecapDismissed(sessionId: string): boolean {
  const dismissed = $sessionRecapDismissedIds.get()

  if (dismissed.length === 0) {
    return false
  }

  if (dismissed.includes(sessionId)) {
    return true
  }

  const sessions = $sessions.get()
  const session = sessions.find(s => sessionMatchesStoredId(s, sessionId))

  if (session && dismissed.includes(sessionPinId(session))) {
    return true
  }

  return lineageAliases(sessionId, sessions).some(alias => dismissed.includes(alias))
}

/** Stores the durable (pin) id so the dismissal survives auto-compression's
 *  id rotation. */
export function dismissSessionRecap(storedSessionId: string): void {
  const sessions = $sessions.get()
  const session = sessions.find(s => sessionMatchesStoredId(s, storedSessionId))
  const durableId = session ? sessionPinId(session) : storedSessionId
  const dismissed = $sessionRecapDismissedIds.get()

  if (dismissed.includes(durableId)) {
    return
  }

  $sessionRecapDismissedIds.set([...dismissed, durableId])
}
