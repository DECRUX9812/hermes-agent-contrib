/**
 * The instant-ack line — a `composer.top` render contribution on a canonical
 * Bot Chat, plus the wiring that feeds it (logic in instant-ack.ts). One
 * quiet pulse and a sentence; it unmounts the moment the transcript takes over.
 *
 * DOM contract (the latency probe measures this): `data-slot="instant-ack"`
 * with `data-ack-state="receipt|waiting|working"`. No element = nothing to say.
 */

import { host, StatusDot, useValue } from '@hermes/plugin-sdk'
import { useEffect } from 'react'

import { canonicalBotChatOnScreen } from './bot-plan-card'
import { $lastRoster } from './data'
import { useBots } from './i18n'
import {
  $instantAcks,
  feedInstantAck,
  IDLE_GRACE_MS,
  INSTANT_ACK_EVENTS,
  noteInstantAck,
  sweepInstantAcks,
  WAITING_AFTER_MS
} from './instant-ack'

/** Subscribe the ack to the events and busy map the app already has.
 *  Returns false on a shell without them — the caller then never arms, so a
 *  receipt can never outlive its turn. */
export function wireInstantAck(onDispose: (dispose: () => void) => void): boolean {
  if (typeof host.onEvent !== 'function' || !host.state.busyBySession) {
    return false
  }

  for (const type of INSTANT_ACK_EVENTS) {
    onDispose(host.onEvent(type, feedInstantAck))
  }

  onDispose(host.state.busyBySession.listen(busy => sweepInstantAcks(busy)))

  return true
}

export function InstantAckLine() {
  const runtimeId = useValue(host.state.focusedSessionId)
  const storedId = useValue(host.state.focusedStoredSessionId)
  const ack = useValue($instantAcks)[runtimeId ?? ''] ?? null
  useValue($lastRoster)
  const t = useBots().ack

  const state = ack?.state
  const armedAt = ack?.armedAt ?? 0

  // The two clocks the ack keeps: a receipt admits it is waiting after
  // WAITING_AFTER_MS, and an ack whose session never went busy is dropped
  // after the grace (a refused send must not keep claiming it was taken).
  useEffect(() => {
    if (!runtimeId || (state !== 'receipt' && state !== 'waiting')) {
      return
    }

    const due = state === 'receipt' ? WAITING_AFTER_MS : IDLE_GRACE_MS

    const timer = window.setTimeout(
      () => {
        if (state === 'receipt') {
          noteInstantAck(runtimeId, { type: 'waiting' })
        }

        sweepInstantAcks(host.state.busyBySession.get())
      },
      Math.max(0, armedAt + due - Date.now())
    )

    return () => window.clearTimeout(timer)
  }, [armedAt, runtimeId, state])

  if (!ack || ack.storedId !== storedId || !canonicalBotChatOnScreen(storedId)) {
    return null
  }

  const label =
    ack.state === 'receipt'
      ? ack.kind === 'command'
        ? t.command(ack.text)
        : t.prompt(ack.text)
      : ack.state === 'working'
        ? ack.tool === 'tool'
          ? t.using(ack.name.replace(/_/g, ' '))
          : t.verbs[ack.tool]
        : t.waiting

  return (
    <div
      aria-live="polite"
      className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-(--conversation-scaffold-text)"
      data-ack-state={ack.state}
      data-slot="instant-ack"
      role="status"
    >
      <StatusDot className="shrink-0 animate-pulse" tone={ack.state === 'waiting' ? 'muted' : 'good'} />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}
