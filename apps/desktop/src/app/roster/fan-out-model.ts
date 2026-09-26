import type { DesktopAgentRoster, DesktopRosterAgent } from '@/global'
import type { SessionOwnerRoute } from '@/store/session-request-router'

export interface FanOutTarget {
  agent: DesktopRosterAgent
  /** Stable picker key — one entry per (connection, profile) pair. */
  key: string
  /** The exact owner the new session is created on — never ambient. */
  route: SessionOwnerRoute
}

/**
 * The agents a parallel fan-out can target (roadmap #21): one row per
 * (connection, profile) pair, on sources that can answer right now — reachable,
 * or `connect-on-demand` (the source dials on first use, same contract the
 * fleet roster's own refresh uses). An unreachable source's agents are left out
 * rather than listed as dead picks. Profiles stay islands: every entry carries
 * its OWN exact owner route, so the creates never collapse onto the ambient
 * gateway.
 */
export function fanOutTargets(roster: DesktopAgentRoster | null): FanOutTarget[] {
  if (!roster) {
    return []
  }

  const pickable = new Set(
    roster.sources
      .filter(source => source.reachable || source.error === 'connect-on-demand')
      .map(source => source.connectionId)
  )

  const seen = new Set<string>()
  const targets: FanOutTarget[] = []

  for (const agent of roster.agents) {
    if (!pickable.has(agent.connectionId)) {
      continue
    }

    const key = `${agent.connectionId} ${agent.profile}`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    targets.push({
      agent,
      key,
      route: {
        connectionId: agent.connectionId,
        mode: agent.connectionKind === 'local' ? 'local' : 'remote',
        profile: agent.profile,
        ...(agent.targetProfile ? { targetProfile: agent.targetProfile } : {})
      }
    })
  }

  return targets
}
