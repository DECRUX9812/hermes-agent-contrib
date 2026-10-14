import { sessionTitle } from '@/lib/chat-runtime'
import { lineageAliases } from '@/store/session'
import type { SessionDotState } from '@/store/session-dot-state'
import { SESSION_LIVE_GROUPS, sessionLiveGroup, type SessionLiveGroup } from '@/store/session-live'
import type { SessionInfo } from '@/types/hermes'

import type { OverviewCardData } from './types'

export interface CollectOverviewOptions {
  sessions: readonly SessionInfo[]
  dotStates: Record<string, SessionDotState | undefined>
  /** Stored ids with a live turn, loudest first. */
  workingSessionIds: readonly string[]
  attentionSessionIds: readonly string[]
  /** Stored ids that finished during this run (still worth a glance). */
  finishedSessionIds: readonly string[]
  /** Stored ids open in a pane or selected (nulls ignored). */
  openSessionIds: readonly (null | string | undefined)[]
}

/**
 * Pure collector for the session overview grid: every session with a live
 * turn, every session that finished during this run, and every session open
 * in a pane — de-duplicated by lineage (a renamed/continued session paints
 * once), ordered needs-you first, most recently active first within a group.
 */
export function collectOverviewCards({
  attentionSessionIds,
  dotStates,
  finishedSessionIds,
  openSessionIds,
  sessions,
  workingSessionIds
}: CollectOverviewOptions): OverviewCardData[] {
  const sessionById = new Map<string, SessionInfo>()

  for (const session of sessions) {
    sessionById.set(session.id, session)
  }

  const seen = new Set<string>()
  const cards: { card: OverviewCardData; lastActive: number }[] = []

  const consider = (storedSessionId: string) => {
    const canonical = lineageAliases(storedSessionId, sessions)[0] ?? storedSessionId

    if (seen.has(canonical)) {
      return
    }

    seen.add(canonical)

    const session = sessionById.get(canonical) ?? sessionById.get(storedSessionId)
    const group: SessionLiveGroup = sessionLiveGroup(dotStates[canonical] ?? dotStates[storedSessionId] ?? 'idle')

    cards.push({
      card: {
        group,
        storedSessionId: canonical,
        title: session ? sessionTitle(session) : canonical
      },
      lastActive: session?.last_active ?? -1
    })
  }

  for (const id of workingSessionIds) {
    consider(id)
  }

  for (const id of attentionSessionIds) {
    consider(id)
  }

  for (const id of finishedSessionIds) {
    consider(id)
  }

  for (const id of openSessionIds) {
    if (id) {
      consider(id)
    }
  }

  const groupRank = new Map(SESSION_LIVE_GROUPS.map((group, index) => [group, index]))

  cards.sort(
    (a, b) => groupRank.get(a.card.group)! - groupRank.get(b.card.group)! || b.lastActive - a.lastActive
  )

  return cards.map(entry => entry.card)
}
