/**
 * Composer predictions — the user's likely next message, shown as the empty
 * composer's ghost text and taken with Tab.
 *
 * One `session.predict_next` call per settled turn (the backend answers ""
 * when `auxiliary.composer_prediction.enabled` is off, so a disabled install
 * pays one cheap RPC and no model call). A prediction belongs to the turn it
 * followed: starting the next turn clears it, and an answer that lands after
 * that is dropped instead of resurrecting a stale suggestion.
 */

import { atom } from 'nanostores'

import { $gateway } from './gateway'
import { ambientRequestFor } from './session-gone-latch'
import { requestForOwnedSession } from './session-states'

export const $composerPredictions = atom<Record<string, string>>({})

// Bumped whenever a session's prediction is invalidated; an in-flight request
// only lands if its generation still matches.
const generation = new Map<string, number>()

export function clearComposerPrediction(sessionId: null | string | undefined): void {
  if (!sessionId) {
    return
  }

  generation.set(sessionId, (generation.get(sessionId) ?? 0) + 1)

  if ($composerPredictions.get()[sessionId] === undefined) {
    return
  }

  const next = { ...$composerPredictions.get() }
  delete next[sessionId]
  $composerPredictions.set(next)
}

export async function requestComposerPrediction(sessionId: null | string | undefined): Promise<void> {
  const gateway = $gateway.get()

  if (!sessionId || !gateway) {
    return
  }

  clearComposerPrediction(sessionId)
  const asked = generation.get(sessionId)

  try {
    const { text } = await requestForOwnedSession<{ text?: string }>(
      sessionId,
      ambientRequestFor(gateway),
      'session.predict_next',
      { session_id: sessionId }
    )

    if (text?.trim() && generation.get(sessionId) === asked) {
      $composerPredictions.set({ ...$composerPredictions.get(), [sessionId]: text.trim() })
    }
  } catch {
    // A missed suggestion is not an error the user needs to hear about.
  }
}
