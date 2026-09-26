import { describe, expect, it } from 'vitest'

import { Sun } from '@/lib/icons'
import type { PaletteFrecencyTable } from '@/store/command-palette-frecency'

import { type PaletteGroup, type PaletteItem, rankGroups } from './rank'

const NOW = 1_800_000_000_000

const item = (id: string, label: string, extra?: Partial<PaletteItem>): PaletteItem => ({
  icon: Sun,
  id,
  label,
  ...extra
})

const history = (key: string, count: number, ageMs = 0): PaletteFrecencyTable => ({
  [key]: { count, lastUsed: NOW - ageMs }
})

describe('rankGroups without a query', () => {
  const groups: PaletteGroup[] = [
    { heading: 'A', items: [item('a1', 'Alpha'), item('a2', 'Beta'), item('a3', 'Gamma')] },
    { heading: 'B', items: [item('b1', 'Delta'), item('b2', 'Epsilon')] }
  ]

  it('keeps the curated order when nothing has history', () => {
    const ranked = rankGroups(groups, '', {}, NOW)

    expect(ranked[0].items.map(i => i.id)).toEqual(['a1', 'a2', 'a3'])
    // No history anywhere → the group objects pass through untouched, so
    // memoized rows don't re-render on a no-op.
    expect(ranked[0]).toBe(groups[0])
    expect(ranked[1]).toBe(groups[1])
  })

  it('orders rows by frecency inside each group without reordering groups', () => {
    const ranked = rankGroups(groups, '', { ...history('a3', 2), ...history('b1', 1) }, NOW)

    expect(ranked.map(g => g.heading)).toEqual(['A', 'B'])
    expect(ranked[0].items.map(i => i.id)).toEqual(['a3', 'a1', 'a2'])
    expect(ranked[1].items.map(i => i.id)).toEqual(['b1', 'b2'])
  })

  it('reads the shared frecencyKey rather than the row id', () => {
    const keyed: PaletteGroup[] = [
      {
        heading: 'Sessions',
        items: [item('session-9', 'Pinned chat', { frecencyKey: 'session:9' }), item('session-4', 'Other chat')]
      }
    ]

    const ranked = rankGroups(keyed, '', history('session:9', 1), NOW)

    expect(ranked[0].items.map(i => i.id)).toEqual(['session-9', 'session-4'])
  })
})

describe('rankGroups with a query', () => {
  it('keeps the better text match ahead when history is shallow', () => {
    const groups: PaletteGroup[] = [
      { heading: 'G', items: [item('tools', 'Tools'), item('toolsets', 'Toolsets', { keywords: ['tools'] })] }
    ]

    // One stale use isn't enough to bury a prefix match.
    const ranked = rankGroups(groups, 'tools', history('toolsets', 1, 60 * 24 * 3_600_000), NOW)

    expect(ranked[0].items.map(i => i.id)).toEqual(['tools', 'toolsets'])
  })

  it('lifts a heavily used row over a same-quality text match', () => {
    const groups: PaletteGroup[] = [
      { heading: 'G', items: [item('x', 'Tools pane'), item('y', 'Tools menu')] }
    ]

    // Both are word matches (0.85); a strong recent history decides the tie.
    const ranked = rankGroups(groups, 'tools', history('y', 30), NOW)

    expect(ranked[0].items.map(i => i.id)).toEqual(['y', 'x'])
  })

  it('never surfaces a row that does not match the needle', () => {
    const groups: PaletteGroup[] = [
      { heading: 'G', items: [item('x', 'Tools'), item('y', 'Completely unrelated')] }
    ]

    // Even maximal frecency can't resurrect a zero-match row.
    const ranked = rankGroups(groups, 'tools', history('y', 10_000), NOW)

    expect(ranked[0].items.map(i => i.id)).toEqual(['x'])
  })

  it('still orders groups by their best item', () => {
    const groups: PaletteGroup[] = [
      { heading: 'Weak', items: [item('w', 'Unrelated', { keywords: ['tools'] })] },
      { heading: 'Strong', items: [item('s', 'Tools')] }
    ]

    const ranked = rankGroups(groups, 'tools', {}, NOW)

    expect(ranked.map(g => g.heading)).toEqual(['Strong', 'Weak'])
  })
})
