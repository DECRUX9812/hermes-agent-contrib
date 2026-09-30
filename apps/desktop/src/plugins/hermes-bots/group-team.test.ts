import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as groupChat from './group-chat'
import type * as groupRounds from './group-rounds'
import type * as groupTeam from './group-team'
import { createGroupGateway, drain, runTimersInline, scriptedStorage } from './group-test-utils'
import type { GatewayOptions, ScriptedGateway } from './group-test-utils'
import type * as groupTurns from './group-turns'
import type { GroupMember, GroupMessage } from './types'

// Team-room orchestration: when the room's local members are one Bot Team's
// seats, the org-tree LEAD alone hears plain user turns; teammates wake only
// when the turn addresses them. Every contract below is about WHO gets a
// prompt.submit — unaddressed members must never reach a model call.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

interface Room {
  chat: typeof groupChat
  gateway: ScriptedGateway
  rounds: typeof groupRounds
  team: typeof groupTeam
  turns: typeof groupTurns
}

async function loadRoom(options: GatewayOptions = {}): Promise<Room> {
  vi.resetModules()
  const gateway = createGroupGateway(options)

  for (const key of Object.keys(host)) {
    delete host[key]
  }

  Object.assign(host, gateway.host)

  const [chat, rounds, team, turns, shared] = await Promise.all([
    import('./group-chat'),
    import('./group-rounds'),
    import('./group-team'),
    import('./group-turns'),
    import('./shared')
  ])

  shared.setPluginCtx(scriptedStorage(gateway.storage))

  return { chat, gateway, rounds, team, turns }
}

const MEMBERS: GroupMember[] = [
  { name: 'research', title: '' },
  { name: 'builder', title: '' },
  { name: 'ops', title: 'The Ops' }
]

const user = (text: string): GroupMessage[] => [{ at: 1, from: { kind: 'user', name: 'You' }, text }] as GroupMessage[]

/** Run the room's drive to completion. */
async function settle(room: Room, group: string) {
  await drain(() => Boolean(room.chat.$groupChats.get()[group]?.running))
}

const submitProfiles = (room: Room) => room.gateway.calls.map(call => call.profile)

beforeEach(() => {
  runTimersInline()
})

describe('room lead resolution', () => {
  it('resolves the org-tree lead for the room, null when the team does not cover it', async () => {
    const room = await loadRoom({ teamLead: { lead: 'research', lead_title: 'Chief', team_id: 't-1', team_name: 'Crew' } })

    await expect(room.team.resolveTeamRoomLead(MEMBERS)).resolves.toEqual({
      lead: 'research',
      leadTitle: 'Chief',
      teamId: 't-1',
      teamName: 'Crew'
    })

    const fallback = await loadRoom({ teamLead: null })

    await expect(fallback.team.resolveTeamRoomLead(MEMBERS)).resolves.toBeNull()
  })

  it('treats a gateway without bots_team.room_lead as fan-out, never an error', async () => {
    const room = await loadRoom()

    await expect(room.team.resolveTeamRoomLead(MEMBERS)).resolves.toBeNull()
  })

  it('only offers LOCAL member profiles to the team match — remote seats are guests', async () => {
    const remote: GroupMember = {
      connectionId: 'mini',
      handle: 'builder-mini',
      name: 'builder',
      remoteSource: true,
      sourceScoped: true
    }

    const room = await loadRoom({ teamLead: { lead: 'research' } })

    expect(room.team.localMemberProfiles([MEMBERS[0], remote, MEMBERS[0]])).toEqual(['research'])

    await room.team.resolveTeamRoomLead([MEMBERS[0], remote])

    expect(room.gateway.rpcFor('bots_team.room_lead')[0].params.members).toEqual(['research'])
    // A remote twin never counts as the room's lead seat.
    expect(room.team.teamLeadKey({ lead: 'builder', leadTitle: '', teamId: '', teamName: '' }, [MEMBERS[0], remote])).toBeNull()
    expect(room.team.teamLeadKey('research', [MEMBERS[0], remote])).toBe('research')
  })
})

describe('orchestrated responder gate', () => {
  const gate = (room: Room, log: GroupMessage[], leadKey?: null | string) =>
    room.rounds.resolveGroupResponders(log, MEMBERS, leadKey).map(member => member.name)

  it('wakes only the lead on a plain user turn — unaddressed members get nothing', async () => {
    const room = await loadRoom()

    expect(gate(room, user('hello team'), 'research')).toEqual(['research'])
    // Addressing the lead by name changes nothing — it was already listening.
    expect(gate(room, user('@research take this'), 'research')).toEqual(['research'])
  })

  it('wakes the lead plus every explicitly @-mentioned member', async () => {
    const room = await loadRoom()

    expect(gate(room, user('@builder take this one'), 'research')).toEqual(['research', 'builder'])
    expect(gate(room, user('@builder and @theops please pair on it'), 'research')).toEqual([
      'research',
      'builder',
      'ops'
    ])
  })

  it('keeps broadcast louder than the gate — @all and @everyone still wake the room', async () => {
    const room = await loadRoom()

    expect(gate(room, user('@everyone standup'), 'research')).toHaveLength(3)
    expect(gate(room, user('@all resume'), 'research')).toHaveLength(3)
  })

  it('falls back to fan-out when no lead resolved — absence is never silent', async () => {
    const room = await loadRoom()

    expect(gate(room, user('hello team'))).toHaveLength(3)
    expect(gate(room, user('hello team'), null)).toHaveLength(3)
    // A stored lead that no local seat matches is no lead.
    expect(gate(room, user('hello team'), 'ghost')).toHaveLength(3)
    // Fan-out still honors explicit mentions.
    expect(gate(room, user('@builder take this'), null)).toEqual(['builder'])
  })

  it('wakes a member the lead delegated to — a lead reply is still an address', async () => {
    const room = await loadRoom()

    const log: GroupMessage[] = [
      ...user('team, review this'),
      { at: 2, from: { kind: 'member', name: 'research' }, text: '@builder can you check the diff?' }
    ]

    expect(gate(room, log, 'research')).toEqual(['research', 'builder'])
  })
})

describe('orchestrated drive', () => {
  it('delivers a plain user send to the lead alone', async () => {
    const room = await loadRoom({ teamLead: { lead: 'research' }, turn: () => 'Done.' })

    room.rounds.sendToGroupChat('Crew', MEMBERS, 'status update please')
    await settle(room, 'Crew')

    expect(submitProfiles(room)).toEqual(['research'])
    // Unaddressed members never minted a session at all.
    expect([...room.gateway.sessions.values()].map(session => session.profile)).toEqual(['research'])
  })

  it('mints the member session with the team_room contract', async () => {
    const room = await loadRoom({ teamLead: { lead: 'research' }, turn: () => 'Done.' })

    room.rounds.sendToGroupChat('Crew', MEMBERS, 'hi')
    await settle(room, 'Crew')

    const session = [...room.gateway.sessions.values()][0]

    expect(session.contracts).toEqual({
      follow_profile_config: true,
      room_plumbing: true,
      team_room: true,
      team_room_lead: 'research'
    })
  })

  it('wakes an explicitly addressed member alongside the lead', async () => {
    const room = await loadRoom({ teamLead: { lead: 'research' }, turn: () => '(pass)' })

    room.rounds.sendToGroupChat('Crew', MEMBERS, '@builder take this one')
    await settle(room, 'Crew')

    expect(new Set(submitProfiles(room))).toEqual(new Set(['research', 'builder']))
  })

  it('keeps every member listening when the room is not a team', async () => {
    const room = await loadRoom({ teamLead: null, turn: () => '(pass)' })

    room.rounds.sendToGroupChat('Open', MEMBERS, 'hi')
    await settle(room, 'Open')

    expect(new Set(submitProfiles(room))).toEqual(new Set(['research', 'builder', 'ops']))
  })

  it('keeps every member listening on a gateway that predates the RPC', async () => {
    const room = await loadRoom({ turn: () => '(pass)' })

    room.rounds.sendToGroupChat('Legacy', MEMBERS, 'hi')
    await settle(room, 'Legacy')

    expect(new Set(submitProfiles(room))).toEqual(new Set(['research', 'builder', 'ops']))
  })
})
