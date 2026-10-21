import { describe, expect, it } from 'vitest'

import type { FleetRun } from '../chat/sidebar/fleet-rail'

import { hudRunCards } from './run-cards'

const run = (over: Partial<FleetRun>): FleetRun => ({
  sessionId: 's1',
  dot: 'working',
  title: 'Session',
  detail: null,
  profile: 'default',
  connectionId: null,
  connectionLabel: null,
  startedMs: null,
  ...over
})

describe('hudRunCards', () => {
  it('drops the session the HUD itself is showing — its transcript is below the bar', () => {
    const runs = [run({ sessionId: 's1' }), run({ sessionId: 's2' })]

    expect(hudRunCards(runs, 's1').map(r => r.sessionId)).toEqual(['s2'])
  })

  it('keeps every run when the HUD is on a fresh draft (no stored id)', () => {
    const runs = [run({ sessionId: 's1' }), run({ sessionId: 's2' })]

    expect(hudRunCards(runs, null)).toHaveLength(2)
  })

  it('keeps rowless runs (sessionId null) — they render inert like the roster', () => {
    const runs = [run({ sessionId: null, title: 'Anon' })]

    expect(hudRunCards(runs, 's1')).toHaveLength(1)
  })
})
