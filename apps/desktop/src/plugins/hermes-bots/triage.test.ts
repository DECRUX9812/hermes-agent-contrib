/**
 * D4 — the triage strip's derivation invariants.
 *
 *   1. One item per bot, first-wins in severity order: unreachable source,
 *      recorded failure flag (delivery when its relay lane is still in
 *      flight), needs-input dot, failed canonical turn, overdue routine.
 *   2. Ghost rows never produce items, and every key ladder matches the row
 *      badge's own lookups (selection key → roster key → conn::profile).
 */

import { describe, expect, it, vi } from 'vitest'

import type { RosterRow, RoutineJob } from './types'

vi.mock('@hermes/plugin-sdk', () => ({
  nextRunOverdueMs: (job: { enabled?: boolean; next_run_at?: string }, now = Date.now()) => {
    if (job?.enabled === false || !job?.next_run_at) {
      return null
    }

    const at = Date.parse(job.next_run_at)
    const overdue = now - at

    return Number.isFinite(at) && overdue > 15 * 60 * 1000 ? overdue : null
  }
}))

vi.mock('./data', () => ({
  botRosterKey: (bot: Partial<RosterRow> | null | undefined) =>
    `${bot?.connectionId || 'legacy'}::${bot?.name || 'default'}`,
  botSelectionKey: (bot: Partial<RosterRow> | null | undefined) =>
    bot?.sourceScoped || bot?.remoteSource ? `${bot?.connectionId || 'legacy'}::${bot?.name}` : bot?.name,
  botSourceStatus: (bot: Partial<RosterRow> | null | undefined) => ({
    available: !(bot?.sourceReachable === false || bot?.sourceError)
  })
}))

vi.mock('./relay', () => ({
  relayLaneKey: (connectionId: string, profile: string) => `${connectionId}::${profile}`
}))

vi.mock('./row-helpers', () => ({
  botCanonicalRuntimeId: (bot: Partial<RosterRow>, storedByRuntime: Record<string, string>) => {
    const stored = bot?.canonical_session?.resolved_id || bot?.canonical_session?.id

    for (const runtime of Object.keys(storedByRuntime || {})) {
      if (storedByRuntime[runtime] === stored) {
        return runtime
      }
    }

    return null
  },
  botCanonicalSessionId: (bot: Partial<RosterRow>) => bot?.canonical_session?.resolved_id || bot?.canonical_session?.id
}))

import { deriveTriageItems } from './triage'

const bot = (name: string, fields: Partial<RosterRow> = {}) => ({ name, ...fields }) as RosterRow

const overdueJob = (): RoutineJob =>
  ({ enabled: true, job_id: 'j1', next_run_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }) as RoutineJob

const quiet = { attention: {} }

describe('deriveTriageItems', () => {
  it('reports each stuck signal under its own kind, one item per bot', () => {
    const needsInput = bot('asker', { canonical_session: { id: 'stored-asker' } } as Partial<RosterRow>)
    const failed = bot('crasher', { canonical_session: { id: 'stored-crasher' } } as Partial<RosterRow>)
    const flagged = bot('flaky')
    const laneBot = bot('remote', { connectionId: 'conn-b' })
    const overdue = bot('scheduler')
    const ghost = bot('gone', { ghost: true })

    const items = deriveTriageItems(
      [needsInput, failed, flagged, laneBot, overdue, ghost],
      {
        ...quiet,
        activeConnectionId: 'local',
        attention: {
          'conn-b::remote': { reason: 'delivery_failed' },
          flaky: { reason: 'agent_blocked' }
        },
        dotById: { 'stored-asker': 'needs-input' },
        jobs: new Map([['legacy::scheduler', [overdueJob()]]]),
        relayInflight: new Set(['conn-b::remote']),
        statusItems: { 'rt-crasher': [{ state: 'failed' }] },
        storedByRuntime: { 'rt-crasher': 'stored-crasher' }
      }
    )

    const kinds = Object.fromEntries(items.map(item => [item.bot.name, item.kind]))

    expect(kinds).toEqual({
      asker: 'needs-input',
      crasher: 'turn-failed',
      flaky: 'attention',
      remote: 'delivery',
      scheduler: 'overdue'
    })
    expect(items.find(item => item.bot.name === 'flaky')?.detail).toBe('agent_blocked')
    expect(items.some(item => item.bot.name === 'gone')).toBe(false)
  })

  it('an unreachable gateway wins over every other signal', () => {
    const bot_ = bot('stranded', {
      canonical_session: { id: 'stored-s' },
      sourceReachable: false
    } as Partial<RosterRow>)

    const items = deriveTriageItems([bot_], {
      ...quiet,
      dotById: { 'stored-s': 'needs-input' },
      jobs: new Map([['legacy::stranded', [overdueJob()]]])
    })

    expect(items.map(item => item.kind)).toEqual(['unreachable'])
  })
})
