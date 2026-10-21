/**
 * Watched sessions — the desktop's answer to Linear's "subscribe": a small,
 * user-pinned set of sessions rendered as compact live chips at the top of the
 * Sessions rail so a long-running conversation stays one click away however
 * far down the list it scrolls.
 *
 * Purely renderer-side state (like pins, mutes, and session tags): keyed by
 * the DURABLE lineage id so a watch survives auto-compression's session-id
 * rotation, and by profile so the islands never bleed into each other. The
 * atom is connection-scoped (`connectionScopedAtom`): remote connections
 * persist under `<key>.remote.<baseUrl>.<profile>`, the local connection keeps
 * the bare key — scope is declared in the key itself.
 *
 * Profile renames/deletes re-home or drop this map's local entries through
 * {@link migrateWatchedSessionsForProfile} / {@link dropWatchedSessionsForProfile},
 * both hung off `migrateTilesForProfile` / `dropTilesForProfile` like every
 * other profile-keyed localStorage family.
 */
import { connectionScopedAtom } from '@/lib/connection-scoped'
import { Codecs } from '@/lib/persisted'
import { normalizeProfileKey } from '@/store/profile'

import { $sessions, sessionMatchesStoredId, sessionPinId } from './session'

/** Same `["profile","durableId"]` JSON-pair convention as the session tags. */
export const sessionWatchKey = (profile: null | string | undefined, durableId: string): string =>
  JSON.stringify([normalizeProfileKey(profile), durableId])

type SessionWatchMap = Record<string, true>

function sanitizeWatchMap(value: unknown): SessionWatchMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const out: SessionWatchMap = {}

  for (const key of Object.keys(value)) {
    if (value[key as keyof typeof value] === true) {
      out[key] = true
    }
  }

  return out
}

export const $watchedSessionKeys = connectionScopedAtom<SessionWatchMap>(
  'hermes.desktop.sessionWatch',
  {},
  Codecs.json(sanitizeWatchMap)
)

export function isSessionWatched(profile: null | string | undefined, durableId: string): boolean {
  return watchLookup($watchedSessionKeys.get(), profile, durableId)
}

function watchLookup(map: SessionWatchMap, profile: null | string | undefined, durableId: string): boolean {
  return map[sessionWatchKey(profile, durableId)] === true
}

/**
 * The row-facing variant: accepts any stored/lineage id and resolves the
 * durable pin id through the sessions list, exactly like `isSessionMuted`.
 * A session that has left the loaded page still answers — fall back to a
 * suffix scan so the chip strip never desyncs from the menu check.
 */
export function isWatchedSessionId(storedSessionId: string): boolean {
  const map = $watchedSessionKeys.get()
  const session = $sessions.get().find(s => sessionMatchesStoredId(s, storedSessionId))

  if (session) {
    return watchLookup(map, session.profile, sessionPinId(session))
  }

  // Unresolvable row (older than the recents page): match on the id half of
  // the key — a durable id is unique within a connection, so a profile-agnostic
  // scan is safe.
  const suffix = `,${JSON.stringify(storedSessionId)}]`

  return Object.keys(map).some(key => key.endsWith(suffix))
}

/** Toggle by any stored/lineage id; returns the new watched state. */
export function toggleSessionWatched(storedSessionId: string): boolean {
  const session = $sessions.get().find(s => sessionMatchesStoredId(s, storedSessionId))
  const durableId = session ? sessionPinId(session) : storedSessionId
  const profile = session?.profile
  const map = $watchedSessionKeys.get()
  const key = sessionWatchKey(profile, durableId)

  if (map[key]) {
    const next = { ...map }
    delete next[key]
    $watchedSessionKeys.set(next)

    return false
  }

  $watchedSessionKeys.set({ ...map, [key]: true })

  return true
}

/** Exact-key remove — the chip strip's unwatch button. Unlike the toggle it
 *  never resolves through `$sessions`: the chip already knows the precise
 *  (profile, durableId) pair, including for a session off the loaded page. */
export function unwatchSession(profile: null | string | undefined, durableId: string): void {
  const map = $watchedSessionKeys.get()
  const key = sessionWatchKey(profile, durableId)

  if (!map[key]) {
    return
  }

  const next = { ...map }
  delete next[key]
  $watchedSessionKeys.set(next)
}

/** Every watched (profile, durableId) pair, decoded for the chip strip. */
export function watchedSessionEntries(): { durableId: string; profile: string }[] {
  const entries: { durableId: string; profile: string }[] = []

  for (const key of Object.keys($watchedSessionKeys.get())) {
    try {
      const [profile, durableId] = JSON.parse(key) as [string, string]

      if (typeof durableId === 'string' && durableId) {
        entries.push({ durableId, profile: normalizeProfileKey(profile) })
      }
    } catch {
      // A malformed legacy entry simply drops out of the strip.
    }
  }

  return entries
}

/** Local profile rename re-homes watch entries; remote profiles keep their
 *  own storage key (same contract as `migrateSessionTagsForProfile`). */
export function migrateWatchedSessionsForProfile(from: string, to: string): void {
  const map = $watchedSessionKeys.get()
  const fromPrefix = `[${JSON.stringify(normalizeProfileKey(from))},`
  const toPrefix = `[${JSON.stringify(normalizeProfileKey(to))},`
  let changed = false
  const next: SessionWatchMap = {}

  for (const [key, watched] of Object.entries(map)) {
    if (key.startsWith(fromPrefix)) {
      next[toPrefix + key.slice(fromPrefix.length)] = watched
      changed = true
    } else {
      next[key] = watched
    }
  }

  if (changed) {
    $watchedSessionKeys.set(next)
  }
}

/** Only a LOCAL profile delete reaches these keys — a remote connection's
 *  watches persist under a different storage key entirely. */
export function dropWatchedSessionsForProfile(
  profile: string,
  route?: { connectionId?: string; profile?: string; targetProfile?: string }
): void {
  if ((String(route?.connectionId ?? '').trim() || 'local') !== 'local') {
    return
  }

  const map = $watchedSessionKeys.get()
  const prefix = `[${JSON.stringify(normalizeProfileKey(profile))},`
  let changed = false
  const next: SessionWatchMap = {}

  for (const [key, watched] of Object.entries(map)) {
    if (key.startsWith(prefix)) {
      changed = true
    } else {
      next[key] = watched
    }
  }

  if (changed) {
    $watchedSessionKeys.set(next)
  }
}
