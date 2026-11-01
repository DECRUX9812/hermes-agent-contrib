import { describe, expect, it } from 'vitest'

import { adjacentStatus } from './card-keyboard'

// Keyboard movement (Alt+Arrow) is the only way to change a card's column
// without a pointer. These are the rules that make it safe: one step at a
// time, clamped at the ends, and a no-op for a status the board does not show.
describe('adjacentStatus', () => {
  const columns = ['backlog', 'in_progress', 'review', 'done']

  it('steps one column right and left', () => {
    expect(adjacentStatus(columns, 'in_progress', 1)).toBe('review')
    expect(adjacentStatus(columns, 'in_progress', -1)).toBe('backlog')
  })

  it('clamps at both ends instead of wrapping', () => {
    expect(adjacentStatus(columns, 'done', 1)).toBeUndefined()
    expect(adjacentStatus(columns, 'backlog', -1)).toBeUndefined()
  })

  it('ignores a status the board does not render', () => {
    expect(adjacentStatus(columns, 'archived', 1)).toBeUndefined()
    expect(adjacentStatus([], 'done', -1)).toBeUndefined()
  })
})
