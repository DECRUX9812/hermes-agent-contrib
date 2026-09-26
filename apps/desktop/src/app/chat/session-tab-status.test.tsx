import { describe, expect, it } from 'vitest'

import { sessionTabStatus } from './session-tab-status'
import type { FleetRun } from './sidebar/fleet-rail'

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

describe('sessionTabStatus', () => {
  it('is quiet for an unknown or absent session id', () => {
    expect(sessionTabStatus(null, [run({})], { s1: 'x' })).toEqual({ startedMs: null, detail: null })
    expect(sessionTabStatus('nope', [run({})], { s1: 'x' })).toEqual({ startedMs: null, detail: null })
  })

  it('shows the live run clock and its detail line', () => {
    const status = sessionTabStatus('s1', [run({ startedMs: 1234, detail: 'Running terminal' })], {})

    expect(status).toEqual({ startedMs: 1234, detail: 'Running terminal' })
  })

  it('prefers the run detail (resolved through aliases) over the raw digest', () => {
    const status = sessionTabStatus(
      's1',
      [run({ startedMs: 1234, detail: 'Asking you' })],
      { s1: 'stale digest' }
    )

    expect(status.detail).toBe('Asking you')
  })

  it('falls back to the stored-id digest when no run is rostered', () => {
    const status = sessionTabStatus('s1', [], { s1: 'Editing files' })

    expect(status).toEqual({ startedMs: null, detail: 'Editing files' })
  })

  it('ignores runs of other sessions', () => {
    const status = sessionTabStatus('s1', [run({ sessionId: 'other', startedMs: 9, detail: 'nope' })], {})

    expect(status).toEqual({ startedMs: null, detail: null })
  })
})
