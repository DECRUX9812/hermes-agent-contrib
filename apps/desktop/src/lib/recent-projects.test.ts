/**
 * Recent projects: entering one puts it first without duplicates, and lists
 * order by that recency while projects never entered keep their own order.
 */

import { describe, expect, it } from 'vitest'

import { byRecency, touchRecent } from './recent-projects'

describe('recent projects', () => {
  it('moves the entered project to the front, bounded and without duplicates', () => {
    expect(touchRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(touchRecent(['a', 'b'], 'z', 2)).toEqual(['z', 'a'])
  })

  it('orders by recency and keeps the rest stable', () => {
    const items = ['w', 'x', 'y', 'z'].map(id => ({ id }))

    expect(byRecency(items, ['y', 'w'], item => item.id).map(item => item.id)).toEqual(['y', 'w', 'x', 'z'])
  })
})
