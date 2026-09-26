import { describe, expect, it } from 'vitest'

import type { DesktopAgentRoster, DesktopRosterAgent } from '@/global'

import { fanOutTargets } from './fan-out-model'

const agent = (over: Partial<DesktopRosterAgent>): DesktopRosterAgent => ({
  connectionId: 'conn-a',
  connectionKind: 'local',
  connectionLabel: 'This device',
  profile: 'default',
  handle: 'default@this-device',
  ...over
})

const roster = (agents: DesktopRosterAgent[], sources: DesktopAgentRoster['sources']): DesktopAgentRoster => ({
  agents,
  sources
})

describe('fanOutTargets', () => {
  it('returns nothing for a missing or empty roster', () => {
    expect(fanOutTargets(null)).toEqual([])
    expect(fanOutTargets(roster([], []))).toEqual([])
  })

  it('lists one pickable target per (connection, profile) on reachable sources', () => {
    const targets = fanOutTargets(
      roster(
        [
          agent({ profile: 'default' }),
          agent({ profile: 'omar', handle: 'omar@this-device' }),
          agent({ connectionId: 'conn-b', connectionKind: 'ssh', connectionLabel: 'VPS', profile: 'ops', handle: 'ops@vps' })
        ],
        [
          { connectionId: 'conn-a', label: 'This device', kind: 'local', reachable: true },
          { connectionId: 'conn-b', label: 'VPS', kind: 'ssh', reachable: true }
        ]
      )
    )

    expect(targets.map(t => t.key)).toEqual(['conn-a default', 'conn-a omar', 'conn-b ops'])
    // and every key is unique per pick
    expect(new Set(targets.map(t => t.key)).size).toBe(targets.length)
  })

  it('drops agents on unreachable sources — never lists a dead pick', () => {
    const targets = fanOutTargets(
      roster(
        [agent({ connectionId: 'conn-dead', connectionKind: 'ssh', profile: 'ops', handle: 'ops@vps' })],
        [{ connectionId: 'conn-dead', label: 'VPS', kind: 'ssh', reachable: false, error: 'timeout' }]
      )
    )

    expect(targets).toEqual([])
  })

  it('keeps connect-on-demand sources — they dial on first use', () => {
    const targets = fanOutTargets(
      roster(
        [agent({ connectionId: 'conn-ssh', connectionKind: 'ssh', profile: 'ops', handle: 'ops@vps' })],
        [{ connectionId: 'conn-ssh', label: 'VPS', kind: 'ssh', reachable: false, error: 'connect-on-demand' }]
      )
    )

    expect(targets).toHaveLength(1)
  })

  it('dedupes a (connection, profile) pair the roster enumerated twice', () => {
    const targets = fanOutTargets(
      roster([agent({}), agent({})], [{ connectionId: 'conn-a', label: 'This device', kind: 'local', reachable: true }])
    )

    expect(targets).toHaveLength(1)
  })

  it('carries the agent’s exact owner route — never ambient', () => {
    const [target] = fanOutTargets(
      roster(
        [
          agent({
            connectionId: 'conn-ssh',
            connectionKind: 'ssh',
            connectionLabel: 'VPS',
            profile: 'ops',
            handle: 'ops@vps',
            targetProfile: 'ops-remote'
          })
        ],
        [{ connectionId: 'conn-ssh', label: 'VPS', kind: 'ssh', reachable: true }]
      )
    )

    expect(target.route).toEqual({
      connectionId: 'conn-ssh',
      mode: 'remote',
      profile: 'ops',
      targetProfile: 'ops-remote'
    })
  })

  it('marks local sources local and omits targetProfile when absent', () => {
    const [target] = fanOutTargets(
      roster([agent({})], [{ connectionId: 'conn-a', label: 'This device', kind: 'local', reachable: true }])
    )

    expect(target.route).toEqual({ connectionId: 'conn-a', mode: 'local', profile: 'default' })
  })
})
