import type { SessionInfo } from '@/hermes'
import { type SessionDotState, sessionStatusRank } from '@/store/session-dot-state'

import { sessionRecency } from './projects/workspace-groups'

export function attentionFoldSessions(
  sessions: readonly SessionInfo[],
  dotStates: Readonly<Record<string, SessionDotState>>,
  isPinned: (session: SessionInfo) => boolean
): SessionInfo[] {
  return sessions
    .filter(session => {
      if (isPinned(session)) {
        return false
      }

      const state = dotStates[session.id]

      return state === 'needs-input' || state === 'stalled' || state === 'unread'
    })
    .sort(
      (a, b) =>
        sessionStatusRank(dotStates[a.id] ?? 'idle') - sessionStatusRank(dotStates[b.id] ?? 'idle') ||
        sessionRecency(b) - sessionRecency(a)
    )
}
