import { afterEach, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as { method: string; params: Record<string, unknown> }[])

vi.mock('@hermes/plugin-sdk', async () => (await import('./group-test-utils')).pluginSdkMock({ state: {} }))
vi.mock('./team', () => ({
  mutateTeam: async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })

    return { team: { id: 'team-1' } }
  },
  useTeam: () => ({ data: undefined })
}))

afterEach(() => {
  calls.length = 0
})

it('turns a room into a team: its name and goal, local bots as seats, the lead keeping the lead seat', async () => {
  const { $lastRoster } = await import('./data')
  const { runRoomAsTeam } = await import('./group-room-panel')
  $lastRoster.set([{ name: 'coder', title: 'Frontend engineer' }] as never)

  await runRoomAsTeam(
    'Launch',
    'Ship the desktop redesign',
    [{ name: 'hermes' }, { name: 'coder' }, { name: 'far', remoteSource: true, connectionId: 'c2' }] as never,
    { name: 'hermes' } as never
  )

  expect(calls[0]).toEqual({
    method: 'bots_team.create',
    params: { mission: 'Ship the desktop redesign', name: 'Launch' }
  })
  const seats = calls.slice(1).map(call => call.params)
  // A remote member stays a room voice, not a seat on this gateway's team.
  expect(seats.map(seat => seat.profile)).toEqual(['hermes', 'coder'])
  expect(seats.find(seat => seat.profile === 'hermes')).toMatchObject({ lead: true, team_id: 'team-1' })
  expect(seats.find(seat => seat.profile === 'coder')).toMatchObject({
    lead: false,
    role: 'Frontend engineer',
    title: 'Frontend engineer'
  })
})
