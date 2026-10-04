/**
 * `botTeammates` — the org-chart neighbours a bot card lists.
 *
 * `reports_to` is the boss's SLOT, not a profile name, so the derive is a
 * two-step join per team: find my seat by profile name, then collect the
 * seats pointing at it (reports) and the seat it points at (lead). Teams are
 * the fan-out unit — a bot can sit in several — so results union and dedupe
 * across every view passed in.
 */

import { describe, expect, it } from 'vitest'

import { botTeammates } from './bot-teammates'
import type { TeamMember, TeamView } from './team'

const member = (slot: string, profile: null | string, reports_to: null | string = null): TeamMember =>
  ({ profile, reports_to, slot }) as TeamMember

const team = (members: TeamMember[]): TeamView => ({ team: { members } }) as TeamView

describe('botTeammates', () => {
  it('collects direct reports by slot, and the lead the seat reports to', () => {
    const teams = [
      team([
        member('boss', 'scout'),
        member('me', 'porter', 'boss'),
        member('a', 'writer', 'me'),
        member('b', 'reviewer', 'me'),
        member('peer', 'critic', 'boss')
      ])
    ]

    const { leads, reports } = botTeammates(teams, 'porter')

    expect(leads).toEqual(['scout'])
    expect(reports).toEqual(['reviewer', 'writer'])
  })

  it('unions across teams and never lists the bot itself', () => {
    const teams = [
      team([member('me', 'porter'), member('a', 'writer', 'me')]),
      team([member('lead', 'scout'), member('me', 'porter', 'lead'), member('x', null, 'me')])
    ]

    const { leads, reports } = botTeammates(teams, 'porter')

    expect(leads).toEqual(['scout'])
    // An open seat (profile: null) is a slot, not a teammate.
    expect(reports).toEqual(['writer'])
  })

  it('is empty when the bot holds no seat, and survives partial shapes', () => {
    expect(botTeammates([team([member('a', 'writer')])], 'porter')).toEqual({ leads: [], reports: [] })
    expect(botTeammates(null, 'porter')).toEqual({ leads: [], reports: [] })
    expect(botTeammates([null, undefined] as never, 'porter')).toEqual({ leads: [], reports: [] })
    expect(botTeammates([], '')).toEqual({ leads: [], reports: [] })
  })

  it('does not follow a reports_to that names no seat (deleted boss)', () => {
    const teams = [team([member('me', 'porter', 'gone'), member('a', 'writer', 'me')])]

    const { leads, reports } = botTeammates(teams, 'porter')

    expect(leads).toEqual([])
    expect(reports).toEqual(['writer'])
  })
})
