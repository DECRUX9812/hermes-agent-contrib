import { describe, expect, it } from 'vitest'

import { type InstantAck, reduceInstantAck } from './state'

const armed = (at = 1000): InstantAck | null => reduceInstantAck(null, { at, detail: 'fix the sidebar', type: 'arm' })

describe('reduceInstantAck', () => {
  it('arms a receipt that says only what the user asked', () => {
    expect(armed()).toEqual({ armedAt: 1000, detail: 'fix the sidebar', state: 'receipt', updatedAt: 1000 })
  })

  it('promotes to working only from a real tool name, keeping the turn’s start time', () => {
    const working = reduceInstantAck(armed(1000), { at: 1500, detail: 'Editing', type: 'tool-start' })

    expect(working).toMatchObject({ armedAt: 1000, detail: 'Editing', state: 'working', updatedAt: 1500 })
  })

  it('admits waiting only while nothing has been named', () => {
    expect(reduceInstantAck(armed(), { at: 2200, type: 'waiting' })).toMatchObject({ state: 'waiting' })
  })

  it('never lets silence overwrite a running tool: its own card owns the timer', () => {
    const working = reduceInstantAck(armed(), { at: 1500, detail: 'Editing', type: 'tool-start' })
    const afterQuiet = reduceInstantAck(working, { at: 9000, type: 'waiting' })

    expect(afterQuiet).toBe(working)
  })

  it('parks on approval from any state, and resumes work after it', () => {
    const waiting = reduceInstantAck(armed(), { at: 2200, type: 'waiting' })
    const parked = reduceInstantAck(waiting, { at: 3000, type: 'approval' })
    const resumed = reduceInstantAck(parked, { at: 4000, detail: 'Running', type: 'tool-start' })

    expect(parked).toMatchObject({ state: 'approval' })
    expect(resumed).toMatchObject({ detail: 'Running', state: 'working' })
  })

  it('hands off to nothing once real turn state takes over', () => {
    expect(reduceInstantAck(armed(), { at: 2000, type: 'hand-off' })).toBeNull()
  })

  it('a new send owns the line, so the previous turn’s words cannot linger', () => {
    const working = reduceInstantAck(armed(1000), { at: 1500, detail: 'Editing', type: 'tool-start' })
    const next = reduceInstantAck(working, { at: 5000, detail: 'rework the pricing copy', type: 'arm' })

    expect(next).toEqual({ armedAt: 5000, detail: 'rework the pricing copy', state: 'receipt', updatedAt: 5000 })
  })

  it('ignores every event when nothing was armed (a cron kickoff has no receipt)', () => {
    expect(reduceInstantAck(null, { at: 10, detail: 'Editing', type: 'tool-start' })).toBeNull()
    expect(reduceInstantAck(null, { at: 10, type: 'waiting' })).toBeNull()
    expect(reduceInstantAck(null, { at: 10, type: 'approval' })).toBeNull()
  })
})
