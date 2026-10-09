import type { ClientSessionState } from '@/app/types'
import { sessionTitle } from '@/lib/chat-runtime'
import { deriveLiveActions } from '@/lib/live-actions'
import { storedSessionIdForRuntimeId } from '@/store/session-states'
import type { SessionInfo } from '@/types/hermes'

import type { MissionControlCard } from './types'

export interface CollectMissionControlOptions {
  workingSessionIds: readonly string[]
  sessions: readonly SessionInfo[]
  sessionStates: Record<string, ClientSessionState | undefined>
  getStoredSessionId?: (runtimeId: string) => null | string
}

/**
 * Pure collector that transforms active working sessions into Mission Control cards.
 * - Extracts only working sessions (non-working excluded)
 * - Resolves titles from stored session data
 * - Attaches latest live action if available (state-less runtime id -> card without activity line)
 */
export function collectMissionControlCards({
  getStoredSessionId = storedSessionIdForRuntimeId,
  sessions,
  sessionStates,
  workingSessionIds
}: CollectMissionControlOptions): MissionControlCard[] {
  const sessionByStoredId = new Map<string, SessionInfo>()

  for (const session of sessions) {
    sessionByStoredId.set(session.id, session)
  }

  const cards: MissionControlCard[] = []

  for (const runtimeId of workingSessionIds) {
    const state = sessionStates[runtimeId]
    const resolvedStoredId = state?.storedSessionId ?? getStoredSessionId(runtimeId) ?? runtimeId
    const session = sessionByStoredId.get(resolvedStoredId) ?? sessionByStoredId.get(runtimeId)
    const title = session ? sessionTitle(session) : (resolvedStoredId || runtimeId || 'Untitled Session')

    let latestAction = null

    if (state?.messages && state.messages.length > 0) {
      const actions = deriveLiveActions(state.messages)

      if (actions.length > 0) {
        latestAction = actions[actions.length - 1]
      }
    }

    cards.push({
      latestAction,
      runtimeId,
      storedSessionId: resolvedStoredId,
      title
    })
  }

  return cards
}
