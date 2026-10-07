import { describe, expect, it } from 'vitest'

import { NOD_MIN_INTERVAL_MS, NodSignals, shouldNod } from './nods'

describe('nod burst rate limit', () => {
  it('allows the first nod of an avatar and then throttles to at most two per second', () => {
    expect(shouldNod(null, 1_000)).toBe(true)
    expect(shouldNod(1_000, 1_000)).toBe(false)
    expect(shouldNod(1_000, 1_000 + NOD_MIN_INTERVAL_MS - 1)).toBe(false)
    expect(shouldNod(1_000, 1_000 + NOD_MIN_INTERVAL_MS)).toBe(true)
  })

  it('coalesces a token burst into one nod and keeps a stalled stream silent', () => {
    const signals = new NodSignals()

    const nods: number[] = []

    // A burst: six tokens inside 200 ms produce exactly one nod.
    ;[0, 30, 60, 90, 120, 200].forEach(now => {
      if (signals.signal('muse', now)) {
        nods.push(now)
      }
    })

    expect(nods).toEqual([0])

    // The stream continues at 3 tokens/s: one nod per 500 ms, never two.
    ;[600, 700, 1200, 1250, 1800].forEach(now => {
      if (signals.signal('muse', now)) {
        nods.push(now)
      }
    })

    expect(nods).toEqual([0, 600, 1200, 1800])

    // A stalled stream leaves the nod start where the last burst put it.
    expect(signals.start('muse')).toBe(1_800)
    expect(signals.signal('muse', 5_000)).toBe(true)
  })

  it('tracks avatars independently and forgets one on clear', () => {
    const signals = new NodSignals()

    signals.signal('muse', 0)
    signals.signal('grok', 10)

    expect(signals.start('muse')).toBe(0)
    expect(signals.start('grok')).toBe(10)
    expect(signals.start('claude')).toBeNull()

    signals.clear('muse')

    expect(signals.start('muse')).toBeNull()
    expect(signals.signal('muse', 20)).toBe(true)
    expect(signals.start('grok')).toBe(10)
  })
})
