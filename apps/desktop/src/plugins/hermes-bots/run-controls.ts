/**
 * Run controls (revamp E1 + E3): interrupt the bot's in-flight
 * canonical-chat turn, and kick the relay outbox so stuck mail moves now.
 *
 * E1 — `session.interrupt` speaks a LIVE runtime id, so the stop resolves
 * the canonical chat through the runtime→stored bridge
 * (`botCanonicalRuntimeId`) — never a stored-id guess, never a session.list
 * scan to invent one. No mounted runtime means no turn is interruptible, so
 * the call is a no-op rather than a 4001.
 *
 * E3 — `retryRelayOutbox` re-arms the drain loop's push signal so the next
 * pass claims every pending envelope and re-offers claimed-but-unanswered
 * ones for another `bot_relay.deliver` round. It reuses the relay's own
 * doors; a stopped relay (Bot Mode off) stays stopped.
 */

import { host } from '@hermes/plugin-sdk'

import { retryRelayOutbox } from './relay'
import { requestForBot } from './routing'
import { botCanonicalRuntimeId } from './row-helpers'
import type { RosterRow } from './types'

export type BotStopResult = 'failed' | 'idle' | 'stopped'

/** Interrupt the turn in flight on the bot's canonical Bot Chat. 'idle'
 *  means there was no live runtime to stop (or the gateway answered
 *  `not_interrupted`); 'failed' means the request never landed. */
export async function stopBotTurn(bot: null | RosterRow | undefined): Promise<BotStopResult> {
  const storedByRuntime = host.state.storedSessionByRuntimeId?.get?.() || {}
  const runtimeId = botCanonicalRuntimeId(bot, storedByRuntime)

  if (!runtimeId) {
    return 'idle'
  }

  try {
    const res = await requestForBot<{ status?: string }>(
      bot,
      'session.interrupt',
      { session_id: runtimeId },
      // A user gesture against a possibly-cold backend — same foreground
      // class as the roster click's registry lookup.
      { spawnPriority: 'foreground' }
    )

    return res?.status === 'interrupted' ? 'stopped' : 'idle'
  } catch {
    return 'failed'
  }
}

/** One-click outbox retry (E3): force the drain pass immediately instead of
 *  waiting out the poll interval — pending envelopes are claimed and
 *  claimed-but-unanswered ones re-offered for `bot_relay.deliver`. */
export function retryBotDeliveries() {
  retryRelayOutbox()
}
