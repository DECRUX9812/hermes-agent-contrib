import { describe, expect, it } from 'vitest'

import { goalChips } from './goal'

describe('goalChips', () => {
  it('offers the plan and goal chips on an empty new-session draft', () => {
    const chips = goalChips({ sessionId: null, text: '' })

    expect(chips.map(chip => `${chip.provider}:${chip.id}`)).toEqual(['goal:plan', 'goal:goal'])

    for (const chip of chips) {
      expect(chip.label).toBeTruthy()
      expect(chip.tip).toBeTruthy()
    }
  })

  it('keeps offering while the draft has text — the chips frame what the user typed', () => {
    expect(goalChips({ sessionId: null, text: 'ship the redesign' })).toHaveLength(2)
  })

  it('stands down on an existing session — the task is already in flight', () => {
    expect(goalChips({ sessionId: 'runtime-1', text: '' })).toEqual([])
    expect(goalChips({ sessionId: 'runtime-1', text: 'ship the redesign' })).toEqual([])
  })

  it('stands down once the draft leads with a slash — the user already picked a route', () => {
    expect(goalChips({ sessionId: null, text: '/plan ship the redesign' })).toEqual([])
    expect(goalChips({ sessionId: null, text: '   /goal weekly review' })).toEqual([])
  })
})
