/**
 * COMPANION THREAD — the "Ask about this session" side channel (roadmap #44).
 * The backend `session.ask` RPC answers a question from the session's STORED
 * transcript with a one-shot utility-model call — it never touches the live
 * conversation, so the live context cache stays intact.
 *
 * The thread itself is CLIENT-owned: completed Q/A turns persist under
 * `connectionScopedAtom` keyed `${profile}:${sessionId}` (the islands rule —
 * a same-named session in another profile keeps its own thread), and each
 * call replays the last few pairs as `history` so follow-ups stay coherent
 * without the server keeping companion state. In-flight asks live in a
 * separate ephemeral atom — a pending turn never persists (a reload would
 * strand it).
 *
 * Profile renames/deletes re-home or drop this map's local entries through
 * {@link migrateSessionAskForProfile} / {@link dropSessionAskForProfile},
 * hung off `migrateTilesForProfile` / `dropTilesForProfile` like every other
 * profile-keyed localStorage family.
 */
import type { SessionAskResult } from '@hermes/shared'
import { atom } from 'nanostores'

import { connectionScopedAtom } from '@/lib/connection-scoped'
import { Codecs } from '@/lib/persisted'
import { normalizeProfileKey } from '@/store/profile'
import { ambientRequestFor } from '@/store/session-gone-latch'
import { requestForOwnedSession } from '@/store/session-states'

import { $gateway } from './gateway'

export interface SessionAskTurn {
  answer: string
  askedAt: number
  /** The backend folded the middle of a long transcript out of the digest. */
  truncated: boolean
  question: string
}

/** One session's turns live under `${profile}:${sessionId}` — serialized as a
 *  JSON pair (same convention as `sessionTagKey`) so a profile name can never
 *  collide with the id half of a neighbor's key. */
export const sessionAskKey = (profile: null | string | undefined, sessionId: string): string =>
  JSON.stringify([normalizeProfileKey(profile), sessionId])

type SessionAskThreadMap = Record<string, SessionAskTurn[]>

/** Bounds: a thread keeps its newest turns (the pairs replayed as `history`
 *  come from the tail), and the map evicts its oldest-touched threads so a
 *  heavy asker can't grow localStorage without limit. */
const THREAD_TURNS_CAP = 50
const THREADS_CAP = 100

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

function sanitizeThreadMap(value: unknown): SessionAskThreadMap {
  if (!isPlainRecord(value)) {
    return {}
  }

  const out: SessionAskThreadMap = {}

  for (const [key, turns] of Object.entries(value)) {
    if (!Array.isArray(turns)) {
      continue
    }

    const clean = turns.filter(
      (turn): turn is SessionAskTurn =>
        isPlainRecord(turn) &&
        typeof turn.question === 'string' &&
        turn.question.trim().length > 0 &&
        typeof turn.answer === 'string' &&
        turn.answer.trim().length > 0 &&
        typeof turn.askedAt === 'number'
    )

    if (clean.length > 0) {
      out[key] = clean.slice(-THREAD_TURNS_CAP).map(turn => ({ ...turn, truncated: Boolean(turn.truncated) }))
    }
  }

  const keys = Object.keys(out)

  if (keys.length > THREADS_CAP) {
    const oldestFirst = keys
      .map(key => ({ key, latest: out[key]!.reduce((max, turn) => Math.max(max, turn.askedAt), 0) }))
      .sort((a, b) => a.latest - b.latest)

    for (const { key } of oldestFirst.slice(0, keys.length - THREADS_CAP)) {
      delete out[key]
    }
  }

  return out
}

export const $sessionAskThreads = connectionScopedAtom<SessionAskThreadMap>(
  'hermes.desktop.sessionAskThreads',
  {},
  Codecs.json(sanitizeThreadMap)
)

/** Ephemeral in-flight marker per thread key — an ask interrupted by a reload
 *  simply never persisted, so nothing here needs the sanitizer. */
export const $sessionAskPending = atom<Record<string, boolean>>({})

export const sessionAskThreadFor = (
  profile: null | string | undefined,
  sessionId: string,
  map: SessionAskThreadMap = $sessionAskThreads.get()
): readonly SessionAskTurn[] => map[sessionAskKey(profile, sessionId)] ?? []

export const sessionAskPendingFor = (
  profile: null | string | undefined,
  sessionId: string,
  map: Record<string, boolean> = $sessionAskPending.get()
): boolean => Boolean(map[sessionAskKey(profile, sessionId)])

/** How many prior pairs ride the `history` param — the backend bounds it too;
 *  this just keeps the wire small. */
const HISTORY_REPLAY = 8

/** Ask the utility model one question about `sessionId`'s transcript. The
 *  route follows the session's OWNER (`requestForOwnedSession`) so a
 *  cross-profile row asks the backend that holds the transcript. The answer
 *  appends to the persisted thread; a transport/model failure throws for the
 *  caller to surface — nothing is written on failure. */
export async function askSessionQuestion(
  profile: null | string | undefined,
  sessionId: string,
  question: string
): Promise<SessionAskTurn> {
  const gateway = $gateway.get()
  const trimmed = question.trim()

  if (!sessionId || !trimmed || !gateway) {
    throw new Error('session.ask needs a session, a question, and a live gateway')
  }

  const key = sessionAskKey(profile, sessionId)

  if ($sessionAskPending.get()[key]) {
    throw new Error('a companion question is already in flight for this session')
  }

  $sessionAskPending.set({ ...$sessionAskPending.get(), [key]: true })

  try {
    const history = sessionAskThreadFor(profile, sessionId)
      .slice(-HISTORY_REPLAY)
      .map(({ answer, question: prior }) => ({ answer, question: prior }))

    const result = await requestForOwnedSession<SessionAskResult>(
      sessionId,
      ambientRequestFor(gateway),
      'session.ask',
      { session_id: sessionId, question: trimmed, history }
    )

    const turn: SessionAskTurn = {
      answer: result.answer,
      askedAt: Date.now(),
      question: trimmed,
      truncated: result.truncated
    }

    const map = $sessionAskThreads.get()
    $sessionAskThreads.set(
      sanitizeThreadMap({ ...map, [key]: [...(map[key] ?? []), turn] })
    )

    return turn
  } finally {
    const pending = { ...$sessionAskPending.get() }
    delete pending[key]
    $sessionAskPending.set(pending)
  }
}

export function clearSessionAskThread(profile: null | string | undefined, sessionId: string): void {
  const key = sessionAskKey(profile, sessionId)
  const map = $sessionAskThreads.get()

  if (key in map) {
    const next = { ...map }
    delete next[key]
    $sessionAskThreads.set(next)
  }
}

/**
 * A local profile rename re-homes its thread entries (same rule as
 * `migrateSessionTagsForProfile`): keys under the old profile name move onto
 * the new one.
 */
export function migrateSessionAskForProfile(from: string, to: string): void {
  const map = $sessionAskThreads.get()
  const fromPrefix = `[${JSON.stringify(normalizeProfileKey(from))},`
  const toPrefix = `[${JSON.stringify(normalizeProfileKey(to))},`
  let changed = false
  const next: SessionAskThreadMap = {}

  for (const [key, turns] of Object.entries(map)) {
    if (key.startsWith(fromPrefix)) {
      next[toPrefix + key.slice(fromPrefix.length)] = turns
      changed = true
    } else {
      next[key] = turns
    }
  }

  if (changed) {
    $sessionAskThreads.set(next)
  }
}

/** Local profile deletes drop the profile's threads; remote connections keep
 *  theirs under a different storage key (see `dropSessionTagsForProfile`). */
export function dropSessionAskForProfile(
  profile: string,
  route?: { connectionId?: string; profile?: string; targetProfile?: string }
): void {
  if ((String(route?.connectionId ?? '').trim() || 'local') !== 'local') {
    return
  }

  const map = $sessionAskThreads.get()
  const prefix = `[${JSON.stringify(normalizeProfileKey(profile))},`
  let changed = false
  const next: SessionAskThreadMap = {}

  for (const [key, turns] of Object.entries(map)) {
    if (key.startsWith(prefix)) {
      changed = true
    } else {
      next[key] = turns
    }
  }

  if (changed) {
    $sessionAskThreads.set(next)
  }
}
