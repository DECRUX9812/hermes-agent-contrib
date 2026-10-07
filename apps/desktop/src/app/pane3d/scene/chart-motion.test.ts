/**
 * Contract tests for the Chart3D motion (architecture §8.9, VAL-CHART-001/003).
 *
 * The chart's motion is a pure function of elapsed ms — the same rule the rig
 * uses — so the slow ±20° turn, the 60 ms stagger and the spring overshoot are
 * all provable without a running pane. The turn must never become a continuous
 * spin, and reduced motion must still the chart completely.
 */

import { describe, expect, it } from 'vitest'

import {
  barRise,
  CHART_REVEAL_MS,
  CHART_RISE_MS,
  CHART_STAGGER_MS,
  CHART_YAW_MAX_DEG,
  CHART_YAW_PERIOD_MS,
  CHART_YAW_RATE_DEG_PER_S,
  chartReveal,
  chartYawDeg
} from './chart-motion'

const sample = (
  from: number,
  to: number,
  step: number,
  fn: (ms: number) => number
): { ms: number; value: number }[] => {
  const out: { ms: number; value: number }[] = []

  for (let ms = from; ms <= to; ms += step) {
    out.push({ ms, value: fn(ms) })
  }

  return out
}

describe('chartYawDeg', () => {
  it('stays inside ±20°', () => {
    sample(0, 90_000, 250, chartYawDeg).forEach(({ value }) => {
      expect(Math.abs(value)).toBeLessThanOrEqual(CHART_YAW_MAX_DEG + 1e-9)
    })
  })

  it('turns at about 6°/s at its fastest', () => {
    const samples = sample(0, 21_000, 10, chartYawDeg)
    let peak = 0

    for (let index = 1; index < samples.length; index += 1) {
      const dt = (samples[index].ms - samples[index - 1].ms) / 1000
      const rate = Math.abs(samples[index].value - samples[index - 1].value) / dt

      peak = Math.max(peak, rate)
    }

    expect(peak).toBeGreaterThan(CHART_YAW_RATE_DEG_PER_S * 0.9)
    expect(peak).toBeLessThan(CHART_YAW_RATE_DEG_PER_S * 1.1)
  })

  it('oscillates through both extremes instead of spinning one way', () => {
    const quarter = CHART_YAW_PERIOD_MS / 4
    const values = [0, quarter, quarter * 2, quarter * 3, quarter * 4].map(ms => chartYawDeg(ms))

    expect(values[0]).toBeCloseTo(0, 5)
    expect(values[1]).toBeCloseTo(CHART_YAW_MAX_DEG, 1)
    expect(values[2]).toBeCloseTo(0, 1)
    expect(values[3]).toBeCloseTo(-CHART_YAW_MAX_DEG, 1)
    expect(values[4]).toBeCloseTo(0, 1)
    // Monotone motion would mean a spin; the samples must turn back.
    const rising = values[1] > values[0]
    const falling = values[3] < values[2]

    expect(rising).toBe(true)
    expect(falling).toBe(true)
  })

  it('is still under reduced motion', () => {
    expect(chartYawDeg(0, true)).toBe(0)
    expect(chartYawDeg(5_000, true)).toBe(0)
  })
})

describe('barRise', () => {
  it('starts at zero and has not started before its stagger delay', () => {
    expect(barRise(0, 0)).toBe(0)
    expect(barRise(CHART_STAGGER_MS - 1, 1)).toBe(0)
    expect(barRise(CHART_STAGGER_MS, 1)).toBe(0)
  })

  it('settles at exactly the bar height', () => {
    expect(barRise(CHART_RISE_MS, 0)).toBeCloseTo(1, 2)
    expect(barRise(CHART_RISE_MS * 3, 7)).toBeCloseTo(1, 3)
  })

  it('springs slightly past the height before settling', () => {
    const peak = Math.max(...sample(0, CHART_RISE_MS, 8, ms => barRise(ms, 0)).map(entry => entry.value))

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThan(1.08)
  })

  it('staggers each bar behind the previous one', () => {
    const at = (ms: number) => [0, 1, 2, 3].map(index => barRise(ms, index))
    const values = at(200)

    expect(values[0]).toBeGreaterThan(values[1])
    expect(values[1]).toBeGreaterThan(values[2])
    expect(values[2]).toBeGreaterThan(values[3])
  })

  it('appears at full height immediately under reduced motion', () => {
    expect(barRise(0, 3, { reducedMotion: true })).toBe(1)
  })
})

describe('chartReveal', () => {
  it('fades in over its duration and stays at one', () => {
    expect(chartReveal(0)).toBe(0)
    expect(chartReveal(CHART_REVEAL_MS / 2)).toBeGreaterThan(0)
    expect(chartReveal(CHART_REVEAL_MS)).toBe(1)
    expect(chartReveal(9_999)).toBe(1)
  })

  it('never goes backwards', () => {
    const values = sample(0, CHART_REVEAL_MS, 16, chartReveal)

    for (let index = 1; index < values.length; index += 1) {
      expect(values[index].value).toBeGreaterThanOrEqual(values[index - 1].value)
    }
  })

  it('is instant under reduced motion', () => {
    expect(chartReveal(0, true)).toBe(1)
  })
})
