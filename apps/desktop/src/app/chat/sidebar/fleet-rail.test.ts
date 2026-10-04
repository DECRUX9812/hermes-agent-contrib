import { describe, expect, it } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import type { DesktopAgentRoster, DesktopRegistryConnection } from '@/global'
import { createClientSessionState } from '@/lib/chat-runtime'
import type { SessionDotState } from '@/store/session-dot-state'
import type { SessionInfo } from '@/types/hermes'

import { buildFleetRuns, buildRestGroups, countRestAgents } from './fleet-rail'

const connections: DesktopRegistryConnection[] = [
  { id: 'pandora', kind: 'remote', label: 'Pandora', url: 'https://pandora.example' },
  { id: 'local', kind: 'local', label: 'This device' },
  { id: 'vps', kind: 'ssh', label: 'VPS', host: 'vps.example' }
] as DesktopRegistryConnection[]

const roster: DesktopAgentRoster = {
  agents: [
    {
      connectionId: 'pandora',
      connectionKind: 'remote',
      connectionLabel: 'Pandora',
      profile: 'default',
      handle: 'hermes-pandora'
    },
    {
      connectionId: 'pandora',
      connectionKind: 'remote',
      connectionLabel: 'Pandora',
      profile: 'scout',
      handle: 'scout'
    },
    {
      connectionId: 'pandora',
      connectionKind: 'remote',
      connectionLabel: 'Pandora',
      profile: 'omer',
      handle: 'omer-pandora'
    },
    {
      connectionId: 'local',
      connectionKind: 'local',
      connectionLabel: 'This device',
      profile: 'default',
      handle: 'hermes'
    },
    {
      connectionId: 'local',
      connectionKind: 'local',
      connectionLabel: 'This device',
      profile: 'omer',
      handle: 'omer-this-device'
    }
  ],
  sources: [
    { connectionId: 'pandora', kind: 'remote', label: 'Pandora', reachable: true },
    { connectionId: 'local', kind: 'local', label: 'This device', reachable: true },
    { connectionId: 'vps', kind: 'ssh', label: 'VPS', reachable: false, error: 'ssh: connect timed out' }
  ]
}

describe('buildRestGroups', () => {
  it('lists every gateway except the active one, in switcher order, regardless of which is active', () => {
    const fromPandora = buildRestGroups({ activeConnectionId: 'pandora', connections, roster })
    const fromLocal = buildRestGroups({ activeConnectionId: 'local', connections, roster })

    // This device first (switcher order), then by label — never "active first".
    expect(fromPandora.map(group => group.connectionId)).toEqual(['local', 'vps'])
    expect(fromLocal.map(group => group.connectionId)).toEqual(['pandora', 'vps'])
  })

  it('carries each gateway default as its own square plus named profiles alphabetically', () => {
    const [local] = buildRestGroups({ activeConnectionId: 'pandora', connections, roster })

    expect(local.defaultAgent).toMatchObject({
      connectionId: 'local',
      profile: 'default',
      isDefault: true,
      handle: 'hermes'
    })
    expect(local.named.map(agent => agent.profile)).toEqual(['omer'])
    expect(local.named[0]).toMatchObject({
      connectionLabel: 'This device',
      handle: 'omer-this-device',
      isDefault: false
    })

    const [pandora] = buildRestGroups({ activeConnectionId: 'local', connections, roster })
    expect(pandora.named.map(agent => agent.profile)).toEqual(['omer', 'scout'])
  })

  it('keeps an unreachable gateway on the strip with its default square and marks it', () => {
    const groups = buildRestGroups({ activeConnectionId: 'pandora', connections, roster })
    const vps = groups.find(group => group.connectionId === 'vps')

    expect(vps).toBeDefined()
    expect(vps?.reachable).toBe(false)
    expect(vps?.defaultAgent.profile).toBe('default')
    expect(vps?.named).toEqual([])
  })

  it('keeps an expired Cloud source visible but not reachable even with cached profiles', () => {
    const expired: DesktopAgentRoster = {
      ...roster,
      sources: roster.sources.map(source =>
        source.connectionId === 'pandora'
          ? { ...source, reachable: false, error: 'OAuth expired', needsSignIn: true }
          : source
      )
    }

    const groups = buildRestGroups({ activeConnectionId: 'local', connections, roster: expired })
    const cloud = groups.find(group => group.connectionId === 'pandora')
    expect(cloud).toMatchObject({ reachable: false, error: 'OAuth expired', needsSignIn: true })
    expect(cloud?.named.map(agent => agent.profile)).toEqual(['omer', 'scout'])
  })

  it('shows every gateway with just its default before the roster has loaded', () => {
    const groups = buildRestGroups({ activeConnectionId: 'pandora', connections, roster: null })

    expect(groups.map(group => [group.connectionId, group.reachable, group.named.length])).toEqual([
      ['local', true, 0],
      ['vps', true, 0]
    ])
  })

  it('skips a registration the roster collapsed into another (same backend, two addresses)', () => {
    const twin: DesktopRegistryConnection = {
      id: 'pandora-lan',
      kind: 'remote',
      label: 'Pandora LAN',
      url: 'http://10.0.0.2'
    } as DesktopRegistryConnection

    const groups = buildRestGroups({ activeConnectionId: 'local', connections: [...connections, twin], roster })

    expect(groups.map(group => group.connectionId)).toEqual(['pandora', 'vps'])
  })

  it('counts every at-rest square for the condensed threshold', () => {
    const groups = buildRestGroups({ activeConnectionId: 'pandora', connections, roster })

    // local: default + omer; vps: default
    expect(countRestAgents(groups)).toBe(3)
  })
})

const sessionRow = (extra: Partial<SessionInfo>): SessionInfo =>
  ({
    id: 'row-1',
    is_active: false,
    last_active: 100,
    message_count: 1,
    source: 'cli',
    started_at: 90,
    title: 'Row title',
    ...extra
  }) as SessionInfo

const runningState = (storedSessionId: string | null, text = 'Ship the thing'): ClientSessionState => {
  const state = createClientSessionState(storedSessionId)

  state.messages = [{ role: 'user', parts: [{ type: 'text', text }] } as never]
  state.turnStartedAt = 5000
  state.busy = true

  return state
}

describe('buildFleetRuns', () => {
  const emptyDots: Record<string, SessionDotState> = {}

  it('marks a backend-active row with no live runtime as working, tagged with its profile and gateway', () => {
    const runs = buildFleetRuns({
      connections,
      digests: {},
      dotStates: emptyDots,
      sessions: [
        sessionRow({ id: 'run-a', connection_id: 'pandora', is_active: true, last_active: 200, profile: 'scout' })
      ],
      states: {}
    })

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      connectionId: 'pandora',
      connectionLabel: 'Pandora',
      dot: 'working',
      profile: 'scout',
      sessionId: 'run-a',
      startedMs: 200 * 1000,
      title: 'Row title'
    })
  })

  it('keeps quiet dots and idle rows off the roster', () => {
    const runs = buildFleetRuns({
      connections,
      digests: {},
      dotStates: { 'row-idle': 'idle', 'row-unread': 'unread', 'row-draft': 'draft' },
      sessions: [
        sessionRow({ id: 'row-idle' }),
        sessionRow({ id: 'row-unread' }),
        sessionRow({ id: 'row-draft' }),
        sessionRow({ id: 'row-quiet' })
      ],
      states: {}
    })

    expect(runs).toHaveLength(0)
  })

  it('uses the live dot over the row flag and ranks attention first, background last, oldest first in tier', () => {
    const runs = buildFleetRuns({
      connections: [],
      digests: {},
      dotStates: { 'run-bg': 'background', 'run-work': 'working', 'run-input': 'needs-input' },
      sessions: [
        sessionRow({ id: 'run-work', last_active: 400 }),
        sessionRow({ id: 'run-input', last_active: 300 }),
        sessionRow({ id: 'run-bg', last_active: 100 })
      ],
      states: {}
    })

    expect(runs.map(run => run.sessionId)).toEqual(['run-input', 'run-work', 'run-bg'])
  })

  it('carries the first user line when the row has no title yet, and feeds the timer from turnStartedAt', () => {
    const state = runningState('run-live')

    const runs = buildFleetRuns({
      connections: [],
      digests: { 'run-live': 'Editing app.py' },
      dotStates: { 'run-live': 'working' },
      sessions: [sessionRow({ id: 'run-live', is_active: true, title: '' })],
      states: { 'runtime-1': state }
    })

    expect(runs[0]).toMatchObject({
      detail: 'Editing app.py',
      sessionId: 'run-live',
      startedMs: 5000,
      title: 'Ship the thing'
    })
  })

  it('rosters a live runtime whose stored row has not arrived, tagged by its socket owner', () => {
    const state = runningState(null)

    const runs = buildFleetRuns({
      connections,
      digests: {},
      dotStates: { 'runtime-9': 'working' },
      ownerForRuntimeId: () => ({ connectionId: 'vps', profile: 'scout', targetProfile: 'scout' }),
      sessions: [],
      states: { 'runtime-9': state }
    })

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      connectionId: 'vps',
      connectionLabel: 'VPS',
      profile: 'scout',
      sessionId: null,
      title: 'Ship the thing'
    })
  })

  it('dedupes lineage-alias claims on the same stored session', () => {
    const runs = buildFleetRuns({
      connections: [],
      digests: {},
      dotStates: { 'run-x': 'working', 'run-x-parent': 'working' },
      sessions: [sessionRow({ _lineage_ids: ['run-x', 'run-x-parent'], id: 'run-x' })],
      states: {
        'runtime-x': { ...runningState('run-x'), storedSessionId: 'run-x' },
        'runtime-xp': { ...runningState('run-x'), storedSessionId: 'run-x' }
      }
    })

    expect(runs).toHaveLength(1)
  })

  it('skips archived rows', () => {
    const runs = buildFleetRuns({
      connections: [],
      digests: {},
      dotStates: {},
      sessions: [sessionRow({ archived: true, id: 'run-dead', is_active: true })],
      states: {}
    })

    expect(runs).toHaveLength(0)
  })
})
