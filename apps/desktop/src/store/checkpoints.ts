import type { RollbackCheckpoint, RollbackListResult } from '@hermes/shared'
import { atom, computed, type ReadableAtom } from 'nanostores'

import { ambientRequestFor } from '@/store/session-gone-latch'
import { requestForOwnedSession } from '@/store/session-states'

import { $gateway } from './gateway'
import { notifyError } from './notifications'

/**
 * TURN CHECKPOINTS — the desktop half of the `rollback.*` RPC family. Each
 * user turn that mutates the workspace starts with a snapshot in the shared
 * checkpoint store, stamped (when the backend supports it) with the durable
 * row id of the user message that opened the turn. This module caches the
 * `rollback.list` snapshot per runtime session id so a user-message row can
 * offer "revert files to before this prompt" without a per-row round trip.
 *
 * PROFILE SCOPING rides the owner route, not the ambient socket: the RPC is
 * dispatched through `requestForOwnedSession`, so a cross-profile session's
 * checkpoints come from the backend that actually ran the turn.
 *
 * Nothing persists — the shadow git store is the source of truth; the cache
 * is best-effort display state and refetches when stale.
 */

export interface SessionCheckpointCache {
  checkpoints: RollbackCheckpoint[]
  fetchedAt: number
}

/** runtime session id → latest rollback.list snapshot. */
export const $checkpointsBySession = atom<Record<string, SessionCheckpointCache>>({})

const inflight = new Map<string, Promise<void>>()

/** A fresh fetch is allowed after this much quiet time; the row mount still
 *  works off the cache in the meantime (offer-don't-hijack: a backend without
 *  the RPC just never shows the affordance). */
const CHECKPOINTS_TTL_MS = 15_000

export function sessionCheckpoints(sessionId: null | string | undefined): RollbackCheckpoint[] {
  if (!sessionId) {
    return []
  }

  return $checkpointsBySession.get()[sessionId]?.checkpoints ?? []
}

/** The checkpoint taken just before the user message with durable `rowId`
 *  opened its turn — the "revert files" target. Only row-id matches count:
 *  a checkpoint without a trailer (pre-tagging backend, or the row had not
 *  flushed yet when the first mutation ran) stays unattributed rather than
 *  risking a wrong-turn match on a best-effort ordinal. */
export function checkpointForUserRow(
  sessionId: null | string | undefined,
  rowId: null | number | undefined
): null | RollbackCheckpoint {
  if (typeof rowId !== 'number') {
    return null
  }

  return sessionCheckpoints(sessionId).find(entry => entry.user_row_id === rowId) ?? null
}

/** reactive selector for one message's revert target. */
export function $checkpointForUserRow(
  sessionId: null | string | undefined,
  rowId: null | number | undefined
): ReadableAtom<null | RollbackCheckpoint> {
  return computed($checkpointsBySession, () => checkpointForUserRow(sessionId, rowId))
}

/** Pull `rollback.list` for one session through its OWN backend, dedup'd and
 *  TTL'd. Callers fire-and-forget; failures leave the previous cache intact. */
export function ensureSessionCheckpoints(sessionId: null | string | undefined, force = false): Promise<void> {
  if (!sessionId) {
    return Promise.resolve()
  }

  const pending = inflight.get(sessionId)

  if (pending) {
    return pending
  }

  const cached = $checkpointsBySession.get()[sessionId]

  if (!force && cached && Date.now() - cached.fetchedAt < CHECKPOINTS_TTL_MS) {
    return Promise.resolve()
  }

  const gateway = $gateway.get()

  if (!gateway) {
    return Promise.resolve()
  }

  const task = requestForOwnedSession<RollbackListResult>(sessionId, ambientRequestFor(gateway), 'rollback.list', {
    session_id: sessionId
  })
    .then(result => {
      $checkpointsBySession.set({
        ...$checkpointsBySession.get(),
        [sessionId]: { checkpoints: result.checkpoints ?? [], fetchedAt: Date.now() }
      })
    })
    .catch(() => {
      // Older backends (or a container session that refuses checkpoints)
      // simply never offer the affordance.
    })
    .finally(() => {
      inflight.delete(sessionId)
    })

  inflight.set(sessionId, task)

  return task
}

/** Mark a session's cache stale so the next row mount refetches. */
export function markCheckpointsStale(sessionId: null | string | undefined): void {
  if (!sessionId) {
    return
  }

  const map = $checkpointsBySession.get()
  const entry = map[sessionId]

  if (entry) {
    $checkpointsBySession.set({ ...map, [sessionId]: { ...entry, fetchedAt: 0 } })
  }
}

/** Revert the workspace to the checkpoint that preceded one user prompt —
 *  transcript untouched (`files_only`), and user-hand-edited files preserved
 *  (`safe`, per the agent-write ledger). `failMessage` is the localized toast
 *  title, supplied by the caller (store code can't reach `t()`). */
export async function revertToCheckpoint(sessionId: string, hash: string, failMessage: string): Promise<boolean> {
  const gateway = $gateway.get()

  if (!gateway) {
    return false
  }

  try {
    const result = await requestForOwnedSession<{ success?: boolean; error?: string | null }>(
      sessionId,
      ambientRequestFor(gateway),
      'rollback.restore',
      { session_id: sessionId, hash, files_only: true, safe: true }
    )

    if (!result.success) {
      notifyError(new Error(result.error ?? 'restore failed'), failMessage)

      return false
    }

    return true
  } catch (error) {
    notifyError(error, failMessage)

    return false
  }
}
