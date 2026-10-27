/**
 * Where armed receipts live.
 *
 * A nanostore, not a React state, because the receipt is armed by the composer
 * submit path and read by the transcript's tail line — two subtrees that never
 * share a parent render. Keyed by the composer/queue session key so a tile, the
 * primary surface and a queued follow-up each keep their own line.
 *
 * Nothing here is persisted: the ack is a claim about a turn in flight, and a
 * reload must re-derive it from real turn state rather than replay a stale one.
 */

import { atom } from 'nanostores'

import { type InstantAck, type InstantAckEvent, reduceInstantAck } from './state'

export const $instantAcks = atom<Record<string, InstantAck>>({})

/** Read one session's ack without subscribing (submit path, non-React callers). */
export function readInstantAck(key: string | null | undefined): InstantAck | null {
  return key ? ($instantAcks.get()[key] ?? null) : null
}

/**
 * Arm a receipt for `key`. Synchronous and network-free: the caller runs this
 * on the send itself, so the row paints on the next frame instead of after the
 * gateway answers.
 *
 * Returns the ack that was armed, so a caller can log timing without re-reading
 * the store.
 */
export function armInstantAck(key: string | null | undefined, detail: string, at = Date.now()): InstantAck | null {
  if (!key || !detail) {
    return null
  }

  const next = reduceInstantAck(null, { at, detail, type: 'arm' })

  if (next) {
    $instantAcks.set({ ...$instantAcks.get(), [key]: next })
  }

  return next
}

/** Feed a real turn event. No-op when nothing is armed for that session. */
export function noteInstantAck(key: string | null | undefined, event: InstantAckEvent): void {
  if (!key) {
    return
  }

  const acks = $instantAcks.get()
  const current = acks[key] ?? null
  const next = reduceInstantAck(current, event)

  if (next === current) {
    return
  }

  if (next === null) {
    clearInstantAck(key)

    return
  }

  $instantAcks.set({ ...acks, [key]: next })
}

export function clearInstantAck(key: string | null | undefined): void {
  if (!key) {
    return
  }

  const acks = $instantAcks.get()

  if (!(key in acks)) {
    return
  }

  const { [key]: _dropped, ...rest } = acks

  $instantAcks.set(rest)
}

/** Test helper: drop every ack so one test cannot leak into the next. */
export function resetInstantAcks(): void {
  $instantAcks.set({})
}
