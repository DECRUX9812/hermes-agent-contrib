import { describe, expect, it } from 'vitest'

import { ACCENT_SPIN_REV_PER_S, type AccentSpinState, restAccentSpin, stepAccentSpin } from './accent-spin'

const FRAME_S = 1 / 60

/** Simulate `seconds` of frames, all in one state. */
function run(state: AccentSpinState, thinking: boolean, seconds: number): AccentSpinState {
  let current = state

  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME_S) {
    current = stepAccentSpin(current, thinking, FRAME_S)
  }

  return current
}

describe('stepAccentSpin — the accent turns only while thinking (§8.4)', () => {
  it('never advances while not thinking', () => {
    expect(run(restAccentSpin(), false, 2).spin).toBe(0)
  })

  it('advances while thinking and reaches the design speed', () => {
    const spun = run(restAccentSpin(), true, 3)

    expect(spun.spin).toBeGreaterThan(0)
    expect(spun.speed).toBeCloseTo(ACCENT_SPIN_REV_PER_S, 2)
  })

  it('holds the angle exactly constant across celebrating and idle frames after thinking', () => {
    const afterThinking = run(restAccentSpin(), true, 1)

    expect(afterThinking.spin).toBeGreaterThan(0)

    // 0.9 s of celebrating, then 2 s of idle — the angle must not move at all.
    const celebrating = run(afterThinking, false, 0.9)
    const idle = run(celebrating, false, 2)

    expect(celebrating.spin).toBe(afterThinking.spin)
    expect(idle.spin).toBe(afterThinking.spin)
    expect(idle.speed).toBe(0)
  })

  it('resumes from the frozen angle when thinking returns', () => {
    const frozen = run(run(restAccentSpin(), true, 1), false, 2)
    const resumed = stepAccentSpin(frozen, true, FRAME_S)

    expect(resumed.spin).toBeGreaterThan(frozen.spin)
  })
})
