/**
 * Team OS slice 5 — the universal Needs You categories on the strip's
 * pending-input index (deriveTriageItems).
 *
 * Invariants under test:
 *   1. A failed handoff / blocked dependency / artifact-ready event surfaces
 *      ONE card for that bot, carrying its category, classified reason and
 *      (for artifacts/dependencies) the ref.
 *   2. The artifact card never flips a status store — it reads them, never
 *      writes them (deep-frozen inputs prove it).
 *   3. Precedence: unreachable > explicit category > generic failure flag >
 *      needs-input dot > failed turn > overdue routine — the pre-existing
 *      ladder is untouched, and a WORKING bot earns a card only from an
 *      explicit category (working never manufactures needs-you).
 *   4. Malformed or unknown entries in the index are dropped; the rest of the
 *      strip still derives.
 */

import { describe, expect, it, vi } from 'vitest'

import type { RosterRow, RoutineJob } from './types'

vi.mock('@hermes/plugin-sdk', () => ({
  atom: <T,>(initial: T) => {
    let value = initial

    return {
      get: () => value,
      set: (next: T) => {
        value = next
      }
    }
  },
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

import type { NeedsYouEntry } from './needs-you'
import { deriveTriageItems } from './triage'
import type { TriageSignals } from './triage'

const bot = (name: string, fields: Partial<RosterRow> = {}) => ({ name, ...fields }) as RosterRow

const NOW = 1_700_000_000_000

const entry = (fields: Partial<NeedsYouEntry> = {}): NeedsYouEntry => ({
  at: NOW,
  bot: 'local::alpha',
  category: 'handoff-failed',
  id: 'e1',
  ...fields
})

const overdueJob = (): RoutineJob =>
  ({ enabled: true, job_id: 'j1', next_run_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }) as RoutineJob

const quiet: TriageSignals = { attention: {}, activeConnectionId: 'local' }

/** Deep-freeze so a derivation that tried to write a store would throw. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)

    for (const child of Object.values(value as object)) {
      deepFreeze(child)
    }
  }

  return value
}

describe('deriveTriageItems — universal Needs You categories', () => {
  it('surfaces a failed handoff as a needs-you card with category and reason', () => {
    const items = deriveTriageItems([bot('alpha')], {
      ...quiet,
      needsYou: {
        'local::alpha': [entry({ reason: 'provider_auth_or_access', ref: 'mbx_abc' })]
      }
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'handoff-failed',
      detail: 'provider_auth_or_access',
      ref: 'mbx_abc',
      key: 'legacy::alpha'
    })
    expect(items[0].bot.name).toBe('alpha')
  })

  it('surfaces a blocked dependency card with its ref', () => {
    const items = deriveTriageItems([bot('alpha')], {
      ...quiet,
      needsYou: { 'local::alpha': [entry({ category: 'blocked', id: 'dep:9', reason: 'dependency', ref: 'task-9' })] }
    })

    expect(items.map(item => ({ detail: item.detail, kind: item.kind, ref: item.ref }))).toEqual([
      { detail: 'dependency', kind: 'blocked', ref: 'task-9' }
    ])
  })

  it('surfaces an artifact-review card with the artifact ref and never flips a status store', () => {
    const dotById = deepFreeze({ 'stored-alpha': 'working' as const })
    const statusItems = deepFreeze({ 'rt-alpha': [{ state: 'running' }] })

    const needsYou = deepFreeze({
      'local::alpha': [entry({ category: 'artifact-review', id: 'art:1', ref: 'file:///tmp/report.md' })]
    })

    const items = deriveTriageItems([bot('alpha', { canonical_session: { id: 'stored-alpha' } } as Partial<RosterRow>)], {
      ...quiet,
      dotById,
      needsYou,
      statusItems,
      storedByRuntime: { 'rt-alpha': 'stored-alpha' }
    })

    expect(items.map(item => ({ kind: item.kind, ref: item.ref }))).toEqual([
      { kind: 'artifact-review', ref: 'file:///tmp/report.md' }
    ])
    // Read-only projection: the stores the card was derived from still say what
    // they said — an artifact ref never flips a task to "reviewed".
    expect(dotById['stored-alpha']).toBe('working')
    expect(statusItems['rt-alpha'][0].state).toBe('running')
  })

  it('ranks the explicit categories over the generic flag, unreachable over everything', () => {
    const stranded = bot('stranded', { sourceReachable: false } as Partial<RosterRow>)
    const flagged = bot('flaky')

    const items = deriveTriageItems([stranded, flagged], {
      attention: { flaky: { reason: 'agent_blocked' }, 'local::stranded': { reason: 'agent_blocked' } },
      activeConnectionId: 'local',
      needsYou: {
        'local::flaky': [entry({ reason: 'missing_config' })],
        'local::stranded': [entry({ reason: 'missing_config' })]
      }
    })

    // A dead gateway still outranks everything: nothing can be answered there.
    expect(items.find(item => item.bot.name === 'stranded')?.kind).toBe('unreachable')
    // The explicit card IS the classified flag — it supersedes the generic one.
    expect(items.find(item => item.bot.name === 'flaky')?.kind).toBe('handoff-failed')
  })

  it('picks the most urgent category when a bot carries several', () => {
    const items = deriveTriageItems([bot('alpha')], {
      ...quiet,
      needsYou: {
        'local::alpha': [
          entry({ category: 'artifact-review', id: 'art:1', ref: 'file:///a.md' }),
          entry({ category: 'blocked', id: 'dep:1', ref: 'task-1' }),
          entry({ category: 'handoff-failed', id: 'handoff:1', reason: 'delivery_failed' })
        ]
      }
    })

    expect(items.map(item => item.kind)).toEqual(['handoff-failed'])
  })

  it('keeps the pre-existing ladder (needs-input > failed turn > overdue) intact', () => {
    const asker = bot('asker', { canonical_session: { id: 'stored-asker' } } as Partial<RosterRow>)
    const failed = bot('crasher', { canonical_session: { id: 'stored-crasher' } } as Partial<RosterRow>)
    const overdue = bot('scheduler')

    const items = deriveTriageItems([asker, failed, overdue], {
      ...quiet,
      dotById: { 'stored-asker': 'needs-input', 'stored-crasher': 'working' },
      jobs: new Map([['legacy::scheduler', [overdueJob()]]]),
      statusItems: { 'rt-crasher': [{ state: 'failed' }] },
      storedByRuntime: { 'rt-crasher': 'stored-crasher' }
    })

    expect(Object.fromEntries(items.map(item => [item.bot.name, item.kind]))).toEqual({
      asker: 'needs-input',
      crasher: 'turn-failed',
      scheduler: 'overdue'
    })
  })

  it('gives a WORKING bot a card only when an explicit category says so', () => {
    const working = bot('busy', { canonical_session: { id: 'stored-busy' } } as Partial<RosterRow>)

    const signals = (needsYou: TriageSignals['needsYou']): TriageSignals => ({
      ...quiet,
      dotById: { 'stored-busy': 'working' },
      needsYou
    })

    // Working on its own is not a need — the strip stays silent.
    expect(deriveTriageItems([working], signals(undefined))).toEqual([])
    expect(deriveTriageItems([working], signals({}))).toEqual([])
    // …and only the recorded category makes it one.
    expect(deriveTriageItems([working], signals({ 'local::busy': [entry({ bot: 'local::busy' })] })).map(item => item.kind)).toEqual([
      'handoff-failed'
    ])
  })

  it('drops malformed or unknown index entries without breaking hydration of the rest', () => {
    const alpha = bot('alpha')
    const bravo = bot('bravo')

    const index = {
      'local::alpha': [null, 'junk', { category: 'needs-input' }, { id: 1, category: 'blocked' }],
      'local::bravo': 'not-an-array',
      'legacy::bravo': [entry({ bot: 'legacy::bravo', category: 'artifact-review', id: 'art:2', ref: 'file:///b' })]
    } as unknown as TriageSignals['needsYou']

    expect(() => deriveTriageItems([alpha, bravo], { ...quiet, needsYou: index })).not.toThrow()

    const items = deriveTriageItems([alpha, bravo], { ...quiet, needsYou: index })

    expect(items.filter(item => item.bot.name === 'alpha')).toEqual([])
    expect(items.map(item => ({ kind: item.kind, ref: item.ref }))).toEqual([
      { kind: 'artifact-review', ref: 'file:///b' }
    ])
  })
})
