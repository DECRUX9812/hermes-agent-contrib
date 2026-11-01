import { describe, expect, it } from 'vitest'

import { findMatches, matchCounterLabel, normalizeQuery, stepMatch } from './find-matches'

const nodes = [
  { id: 'a', label: 'Deploy the gateway' },
  { id: 'b', label: 'gateway restart runbook' },
  { id: 'c', label: 'Chocolate chip cookies' },
  { id: 'd', label: 'GATEWAY' }
]

describe('find-on-map matching', () => {
  it('treats a blank or non-string query as no search at all', () => {
    expect(normalizeQuery('   ')).toBe('')
    expect(normalizeQuery(undefined)).toBe('')
    expect(normalizeQuery(42)).toBe('')
    expect(findMatches(nodes, '')).toEqual([])
    expect(findMatches(nodes, '   ')).toEqual([])
  })

  it('matches a case-insensitive substring in map order', () => {
    expect(findMatches(nodes, 'gateway')).toEqual(['a', 'b', 'd'])
    expect(findMatches(nodes, 'GATE')).toEqual(['a', 'b', 'd'])
    expect(findMatches(nodes, '  cookie ')).toEqual(['c'])
  })

  it('finds nothing rather than everything when the query is absent from the map', () => {
    expect(findMatches(nodes, 'kubernetes')).toEqual([])
  })

  it('skips malformed nodes instead of throwing on a partial graph', () => {
    const broken = [
      { id: 'ok', label: 'gateway' },
      { id: '', label: 'gateway' },
      { label: 'gateway' },
      null,
      { id: 'no-label', label: null },
      { id: 'num-label', label: 7 }
    ] as unknown as { id: string; label: string }[]

    expect(findMatches(broken, 'gateway')).toEqual(['ok'])
  })

  it('survives a missing node list', () => {
    expect(findMatches(undefined as unknown as [], 'x')).toEqual([])
  })
})

describe('stepping through matches', () => {
  const ids = ['a', 'b', 'c']

  it('starts at the first hit going forward and the last going back', () => {
    expect(stepMatch(null, ids, 1)).toBe('a')
    expect(stepMatch(null, ids, -1)).toBe('c')
  })

  it('walks forward and wraps around', () => {
    expect(stepMatch('a', ids, 1)).toBe('b')
    expect(stepMatch('c', ids, 1)).toBe('a')
  })

  it('walks back and wraps around', () => {
    expect(stepMatch('a', ids, -1)).toBe('c')
    expect(stepMatch('c', ids, -1)).toBe('b')
  })

  it('recovers when the current hit is no longer in the list', () => {
    expect(stepMatch('gone', ids, 1)).toBe('a')
    expect(stepMatch('gone', ids, -1)).toBe('c')
  })

  it('returns null when there is nothing to step through', () => {
    expect(stepMatch(null, [], 1)).toBeNull()
    expect(stepMatch('a', undefined as unknown as [], 1)).toBeNull()
  })
})

describe('match counter label', () => {
  it('counts from one and clamps a stale index', () => {
    expect(matchCounterLabel(0, 12)).toBe('1/12')
    expect(matchCounterLabel(11, 12)).toBe('12/12')
    expect(matchCounterLabel(99, 3)).toBe('3/3')
    expect(matchCounterLabel(-4, 3)).toBe('1/3')
  })

  it('never claims a hit when there is none', () => {
    expect(matchCounterLabel(0, 0)).toBe('0/0')
    expect(matchCounterLabel(Number.NaN, 4)).toBe('1/4')
  })
})
