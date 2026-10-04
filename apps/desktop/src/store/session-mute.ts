import { connectionScopedAtom } from '@/lib/connection-scoped'
import { Codecs, persistentAtom } from '@/lib/persisted'

import { $sessions, knownSessionOwner, lineageAliases, sessionMatchesStoredId, sessionPinId } from './session'

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

// ── Owner-scoped notification modes (Bot Mode A4) ──────────────────────────
// A bot's sessions — its canonical Bot Chat, side-chats, and cron runs — all
// share one owner: `${connectionId}::${profile}`. Muting that key silences the
// whole profile, including sessions minted after the toggle. The key carries
// its own connection scope, so the map lives under one flat storage key.

export type OwnerNotifyMode = 'muted' | 'quiet'

const OWNER_NOTIFY_MODES_KEY = 'sidebar.ownerNotifyModes'

export const $ownerNotifyModes = persistentAtom<Record<string, OwnerNotifyMode>>(
  OWNER_NOTIFY_MODES_KEY,
  {},
  Codecs.json<Record<string, OwnerNotifyMode>>(value =>
    Object.fromEntries(
      Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value : {}).filter(
        (entry): entry is [string, OwnerNotifyMode] => entry[1] === 'muted' || entry[1] === 'quiet'
      )
    )
  )
)

/** `connectionId` may be empty/'local' for the local connection; `profile`
 *  falls back to 'default' so bare names and explicit 'default' collide. */
export function ownerNotifyKey(connectionId: null | string | undefined, profile: null | string | undefined): string {
  return `${String(connectionId ?? '').trim() || 'local'}::${String(profile ?? '').trim() || 'default'}`
}

/** The owner keys a session could be muted under: its backend profile, and —
 *  for remote-override routes — the Desktop-side alias the roster shows. */
function sessionOwnerNotifyKeys(sessionId: string): string[] {
  const owner = knownSessionOwner($sessions.get(), sessionId)

  if (!owner) {
    return []
  }

  if (typeof owner === 'string') {
    return [ownerNotifyKey('local', owner)]
  }

  const keys = [ownerNotifyKey(owner.connectionId, owner.profile)]

  if (owner.targetProfile && owner.targetProfile !== owner.profile) {
    keys.push(ownerNotifyKey(owner.connectionId, owner.targetProfile))
  }

  return keys
}

/** The mode recorded for the session's owner, if any. */
export function ownerNotifyModeForSession(sessionId: null | string | undefined): OwnerNotifyMode | undefined {
  if (!sessionId) {
    return undefined
  }

  const modes = $ownerNotifyModes.get()

  for (const key of sessionOwnerNotifyKeys(sessionId)) {
    const mode = modes[key]

    if (mode) {
      return mode
    }
  }

  return undefined
}

export function ownerNotifyMode(ownerKey: string): OwnerNotifyMode | undefined {
  return $ownerNotifyModes.get()[ownerKey]
}

export function setOwnerNotifyMode(ownerKey: string, mode: OwnerNotifyMode | null): void {
  const next = { ...$ownerNotifyModes.get() }

  if (mode) {
    next[ownerKey] = mode
  } else {
    delete next[ownerKey]
  }

  $ownerNotifyModes.set(next)
}

/** Session mute OR a hard owner mute. Quiet mode is excluded — it only gates
 *  native dispatch while the quiet-hours window is open. */
export function isSessionNotificationMuted(sessionId: string): boolean {
  return isSessionMuted(sessionId) || ownerNotifyModeForSession(sessionId) === 'muted'
}

/** Rename counterpart: `local::<old>` modes move to `local::<new>`, matching
 *  the local-connection-only rule of the other profile-keyed families. */
export function migrateOwnerNotifyModesForProfile(oldProfile: string, newProfile: string): void {
  const modes = $ownerNotifyModes.get()
  const from = ownerNotifyKey('local', oldProfile)

  if (!modes[from]) {
    return
  }

  const next = { ...modes }
  next[ownerNotifyKey('local', newProfile)] = next[from]!
  delete next[from]
  $ownerNotifyModes.set(next)
}

/** Delete counterpart: drop the deleted profile's key under its owning
 *  connection only — a same-named bot on another connection keeps its mode. */
export function dropOwnerNotifyModesForProfile(
  profile: string,
  route?: { connectionId?: string; profile?: string; targetProfile?: string }
): void {
  const connectionId = String(route?.connectionId ?? '').trim() || 'local'

  const names = new Set(
    [route?.profile, route?.targetProfile, profile].map(value => String(value ?? '').trim()).filter(Boolean)
  )

  const next = Object.fromEntries(
    Object.entries($ownerNotifyModes.get()).filter(([key]) => {
      const [conn, name] = key.split('::')

      return !(conn === connectionId && names.has(name))
    })
  )

  if (Object.keys(next).length !== Object.keys($ownerNotifyModes.get()).length) {
    $ownerNotifyModes.set(next)
  }
}
