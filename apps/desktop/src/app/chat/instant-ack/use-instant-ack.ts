/**
 * The ack line as the transcript reads it.
 *
 * Part A (the receipt) is armed by the composer at send time, so this hook does
 * no work to show it; the only timer here is the one that keeps a receipt
 * honest — if no real event lands within {@link WAITING_AFTER_MS}, the line
 * stops implying progress and says it is waiting on the model.
 */

import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { type InstantAck, WAITING_AFTER_MS } from './state'
import { $instantAcks, noteInstantAck } from './store'

export function useInstantAck(key: string | null | undefined): InstantAck | null {
  const acks = useStore($instantAcks)
  const ack = key ? (acks[key] ?? null) : null
  const state = ack?.state
  const updatedAt = ack?.updatedAt

  useEffect(() => {
    if (!key || state !== 'receipt' || updatedAt === undefined) {
      return
    }

    // Measure from the last REAL event, not from mount: a re-render must not
    // restart the clock and let a silent model look busy for longer.
    const remaining = Math.max(0, updatedAt + WAITING_AFTER_MS - Date.now())
    const timer = window.setTimeout(() => noteInstantAck(key, { at: Date.now(), type: 'waiting' }), remaining)

    return () => window.clearTimeout(timer)
  }, [key, state, updatedAt])

  return ack
}
