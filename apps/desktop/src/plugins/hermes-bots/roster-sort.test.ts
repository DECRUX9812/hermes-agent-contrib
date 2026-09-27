/**
 * A2 — the roster's sort order. Invariants:
 *  - 'recent' keeps today's contract exactly: pinned first, then newest
 *    activity — passing no sort spec must not reorder anything;
 *  - 'attention' floats flagged bots to the top of their band, but a pin
 *    is always the outer band — an attended bot never outranks a pinned one.
 */

import { describe, expect, it, vi } from 'vitest'

import { sortRosterBots } from './roster-pane-derivation'
import type { RosterRow } from './types'

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return {
    atom,
    host: { state: { connectionId: { get: () => 'local' } } },
    queryClient: undefined,
    useQuery: vi.fn(),
    useValue: vi.fn()
  }
})

vi.mock('./shared', () => ({ getPluginCtx: () => null, ID: 'hermes-bots' }))

const NOW = 1_000_000_000_000
const secondsAgo = (n: number) => NOW / 1000 - n

const bot = (name: string, fields: Partial<RosterRow> = {}) => ({ name, ...fields }) as RosterRow

// Three quiet rows, newest activity last on purpose.
const roster = [
  bot('quiet-old', { last_session: { last_active: secondsAgo(400), preview: '' } }),
  bot('quiet-new', { last_session: { last_active: secondsAgo(10), preview: '' } }),
  bot('flagged', { last_session: { last_active: secondsAgo(3900), preview: '' } })
]

const attentionOf = (counts: Record<string, number>) => (b: RosterRow) => counts[b.name] ?? 0

describe('sortRosterBots', () => {
  it('defaults to pinned-then-activity, unchanged with no sort spec', () => {
    const { roster: sorted } = sortRosterBots(roster, {})

    expect(sorted.map(b => b.name)).toEqual(['quiet-new', 'quiet-old', 'flagged'])
  })

  it('attention-first lifts flagged bots above recent quiet ones', () => {
    const { roster: sorted } = sortRosterBots(roster, {}, {
      attentionOf: attentionOf({ flagged: 2, 'quiet-new': 1 }),
      mode: 'attention'
    })

    expect(sorted.map(b => b.name)).toEqual(['flagged', 'quiet-new', 'quiet-old'])
  })

  it('a pin still outranks attention', () => {
    const { roster: sorted } = sortRosterBots(roster, { 'quiet-old': { pinned: true } }, {
      attentionOf: attentionOf({ flagged: 9 }),
      mode: 'attention'
    })

    expect(sorted[0].name).toBe('quiet-old')
    expect(sorted[1].name).toBe('flagged')
  })

  it('equal attention falls back to activity', () => {
    const { roster: sorted } = sortRosterBots(roster, {}, {
      attentionOf: attentionOf({ flagged: 1, 'quiet-new': 1 }),
      mode: 'attention'
    })

    expect(sorted.map(b => b.name)).toEqual(['quiet-new', 'flagged', 'quiet-old'])
  })

  it('alpha orders by display name, activity only breaking ties', () => {
    const { roster: sorted } = sortRosterBots(roster, {}, { mode: 'alpha' })

    expect(sorted.map(b => b.name)).toEqual(['flagged', 'quiet-new', 'quiet-old'])
  })

  it('alpha still keeps the pinned band outer', () => {
    const { roster: sorted } = sortRosterBots(roster, { 'quiet-new': { pinned: true } }, { mode: 'alpha' })

    expect(sorted[0].name).toBe('quiet-new')
    expect(sorted.slice(1).map(b => b.name)).toEqual(['flagged', 'quiet-old'])
  })

  it('an unknown persisted mode falls back to recent ordering', () => {
    const { roster: sorted } = sortRosterBots(roster, {}, { mode: 'bogus' as never })

    expect(sorted.map(b => b.name)).toEqual(['quiet-new', 'quiet-old', 'flagged'])
  })
})
