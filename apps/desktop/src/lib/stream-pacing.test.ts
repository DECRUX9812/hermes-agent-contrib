/**
 * Paced streaming must never show text that hasn't arrived, never go
 * backwards, ease a burst in over several frames, and never let the display
 * fall behind a deep or stale backlog (it drains at once instead).
 */

import { describe, expect, it } from 'vitest'

import { initialPacing, stepPacing } from './stream-pacing'

describe('stepPacing', () => {
  it('eases a burst in monotonically without passing what arrived', () => {
    let state = initialPacing()
    const seen: number[] = []

    for (let frame = 1; frame <= 60 && state.shown < 400; frame++) {
      state = stepPacing(state, { dt: 16, now: frame * 16, oldestAgeMs: 0, target: 400 })
      seen.push(state.shown)
    }

    expect(seen[0]).toBeGreaterThan(0)
    expect(seen[0]).toBeLessThan(400)
    expect(seen.every((n, i) => n <= 400 && (i === 0 || n >= seen[i - 1]))).toBe(true)
    expect(state.shown).toBe(400)
  })

  it('drains everything at once when the backlog is deep or stale, then settles back to smooth', () => {
    const deep = stepPacing(initialPacing(), { dt: 16, now: 16, oldestAgeMs: 0, target: 5000 })
    const stale = stepPacing(initialPacing(10), { dt: 16, now: 16, oldestAgeMs: 500, target: 200 })

    expect(deep).toMatchObject({ mode: 'catch-up', shown: 5000 })
    expect(stale).toMatchObject({ mode: 'catch-up', shown: 200 })

    let state = deep

    for (let now = 32; now < 700; now += 16) {
      state = stepPacing(state, { dt: 16, now, oldestAgeMs: 0, target: state.shown + 2 })
    }

    expect(state.mode).toBe('smooth')
  })
})
