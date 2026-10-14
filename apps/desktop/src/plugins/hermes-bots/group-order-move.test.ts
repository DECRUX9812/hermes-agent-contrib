import { describe, expect, it } from 'vitest'

import { moveGroupRow } from './group-order'

const rows = [
  { kind: 'group' as const, name: 'Pinned', activity: 0, pinned: true },
  { kind: 'group' as const, name: 'Older', activity: 1, pinned: false },
  { kind: 'bot' as const, name: 'Bot', activity: 2, pinned: false },
  { kind: 'group' as const, name: 'Newer', activity: 3, pinned: false }
]

describe('moveGroupRow', () => {
  it('moves a room to an absolute index inside its band', () => {
    expect(moveGroupRow(rows, 'Newer', 0)).toEqual(['Pinned', 'Newer', 'Older'])
    expect(moveGroupRow(rows, 'Older', 1)).toEqual(['Pinned', 'Newer', 'Older'])
  })

  it('clamps out-of-range targets to the band edges', () => {
    expect(moveGroupRow(rows, 'Older', 99)).toEqual(['Pinned', 'Newer', 'Older'])
    expect(moveGroupRow(rows, 'Newer', -5)).toEqual(['Pinned', 'Newer', 'Older'])
  })

  it('returns null when nothing would move', () => {
    expect(moveGroupRow(rows, 'Older', 0)).toBeNull()
    expect(moveGroupRow(rows, 'deleted', 0)).toBeNull()
    expect(moveGroupRow(rows, 'Bot', 0)).toBeNull()
    expect(moveGroupRow(rows, 'Newer', 1)).toBeNull()
  })

  it('never disturbs the other pin band', () => {
    expect(moveGroupRow(rows, 'Pinned', 0)).toBeNull()

    // The moved band order lands on the band's slots in input order; the
    // pinned-first sort still renders Pinned2 ahead of Pinned.
    expect(
      moveGroupRow([...rows, { kind: 'group' as const, name: 'Pinned2', activity: 5, pinned: true }], 'Pinned2', 0)
    ).toEqual(['Pinned2', 'Older', 'Newer', 'Pinned'])
  })

  it('moves within filtered rows while hidden rooms keep their slots', () => {
    const hidden = { kind: 'group' as const, name: 'Hidden', activity: 2, pinned: false }
    const withHidden = [rows[0], rows[1], hidden, rows[3]]

    expect(moveGroupRow(withHidden, 'Newer', 0, ['Older', 'Newer'])).toEqual(['Pinned', 'Newer', 'Hidden', 'Older'])
    expect(moveGroupRow(withHidden, 'Older', 5, ['Older', 'Newer'])).toEqual(['Pinned', 'Newer', 'Hidden', 'Older'])
    expect(moveGroupRow(withHidden, 'Hidden', 0, ['Older', 'Newer'])).toBeNull()
  })
})
