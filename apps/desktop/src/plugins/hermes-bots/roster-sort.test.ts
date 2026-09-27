import { describe, expect, it } from 'vitest'

import { sortRosterBots } from './roster-pane-derivation'
import type { RosterRow } from './types'

const bot = (name: string, lastActiveSec: number, extra: Partial<RosterRow> = {}): RosterRow =>
  ({
    name,
    canonical_session: { id: `c-${name}`, last_active: lastActiveSec },
    ...extra
  }) as RosterRow

describe('roster sort modes', () => {
  const roster = [
    bot('zebra', 100),
    bot('alpha', 50),
    bot('mike', 200)
  ]

  it('alpha orders by display name regardless of recency', () => {
    const { roster: sorted } = sortRosterBots(roster, {}, { mode: 'alpha' })

    expect(sorted.map(b => b.name)).toEqual(['alpha', 'mike', 'zebra'])
  })

  it('recent keeps the current newest-activity-first order', () => {
    const { roster: sorted } = sortRosterBots(roster, {}, { mode: 'recent' })

    expect(sorted.map(b => b.name)).toEqual(['mike', 'zebra', 'alpha'])
  })

  it('attention floats flagged bots to the top, then falls back to recency', () => {
    const attention = new Set(['alpha'])

    const { roster: sorted } = sortRosterBots(roster, {}, { mode: 'attention', hasAttention: b => attention.has(b.name) })

    expect(sorted.map(b => b.name)).toEqual(['alpha', 'mike', 'zebra'])
  })

  it('an unknown mode falls back to recent ordering', () => {
    const { roster: sorted } = sortRosterBots(roster, {}, { mode: 'bogus' as never })

    expect(sorted.map(b => b.name)).toEqual(['mike', 'zebra', 'alpha'])
  })
})
