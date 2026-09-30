/**
 * Org teammates for the bot card (bot-pane UX): which seats report to this
 * bot and which seat leads it — read off `bots_team.*`, the same door team.ts
 * uses, but routed to the bot's own gateway (`requestForBot`) since the team
 * store is install-wide per install.
 *
 * `reports_to` is the boss's SLOT, so teammates can't be derived from the
 * list summaries — the full team view is required, and the query fans one
 * `bots_team.get` per listed team. Remote-source rows sit in another
 * install's org chart; they still resolve here because the request follows
 * their route, not the active gateway.
 */

import { useQuery } from '@hermes/plugin-sdk'

import { requestForBot } from './routing'
import { ID } from './shared'
import type { TeamMember, TeamSummary, TeamView } from './team'
import type { RosterRow } from './types'

export interface BotTeammates {
  /** Profiles this bot reports to (its bosses' seats). */
  leads: string[]
  /** Profiles seated directly under this bot. */
  reports: string[]
}

/** Direct reports + leads of `profileName`, flattened across teams. */
export function botTeammates(
  teams: readonly (TeamView | null | undefined)[] | null | undefined,
  profileName: string
): BotTeammates {
  const name = String(profileName || '').trim()
  const leads = new Set<string>()
  const reports = new Set<string>()

  for (const view of Array.isArray(teams) ? teams : []) {
    const members: TeamMember[] = Array.isArray(view?.team?.members) ? view.team.members : []
    const me = members.find(member => member?.profile === name)

    if (!me) {
      continue
    }

    const boss = members.find(member => member?.slot === me.reports_to)

    if (boss?.profile && boss.profile !== name) {
      leads.add(boss.profile)
    }

    for (const member of members) {
      if (member?.reports_to === me.slot && member.profile && member.profile !== name) {
        reports.add(member.profile)
      }
    }
  }

  return { leads: [...leads].sort(), reports: [...reports].sort() }
}

const fetchBotTeams = async (bot: RosterRow): Promise<TeamView[]> => {
  const res = await requestForBot<{ teams?: TeamSummary[] }>(bot, 'bots_team.list', {})
  const summaries = Array.isArray(res?.teams) ? res.teams : []

  const views = await Promise.all(
    summaries.map(team =>
      requestForBot<TeamView>(bot, 'bots_team.get', { team_id: team.id }).catch(() => null)
    )
  )

  return views.filter((view): view is TeamView => Boolean(view?.team?.id))
}

/** The bot's org-chart neighbours, or an empty shape until/ unless the gateway
 *  answers — a gateway predating `bots_team.*` (or a row with no teams)
 *  resolves to 'no teammates', never a thrown error. */
export function useBotTeammates(bot: RosterRow | null | undefined): BotTeammates {
  const { data } = useQuery({
    enabled: Boolean(bot?.name) && !bot?.ghost,
    queryFn: async () => {
      try {
        return await fetchBotTeams(bot as RosterRow)
      } catch {
        return [] as TeamView[]
      }
    },
    queryKey: [ID, 'bot-teams', bot?.connectionId || 'local', bot?.name || ''],
    retry: false,
    staleTime: 30000
  })

  return botTeammates(data, bot?.name || '')
}
