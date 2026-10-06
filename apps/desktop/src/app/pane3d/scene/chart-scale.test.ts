/**
 * Contract tests for the Chart3D scale math (architecture §8.9, VAL-CHART-004).
 *
 * These pin the three relationships the chart depends on: the Y ticks are
 * round numbers that always reach at least the data maximum, the height scale
 * is linear and zero-based against the axis ceiling (a value at the ceiling
 * maps to EXACTLY the configured max height, so the bars and the gridlines can
 * never disagree), and the value/tick labels read the way a reader expects
 * (grouped exact values, compact axis ticks).
 */

import { describe, expect, it } from 'vitest'

import {
  CHART_MAX_BAR_HEIGHT,
  CHART_Y_TICK_COUNT,
  chartDomain,
  formatTickLabel,
  formatValue,
  niceTicks,
  scaleBarHeights
} from './chart-scale'

const DEMO = [1180, 1265, 1340, 1310, 1485, 1610, 1742, 1968]

describe('niceTicks', () => {
  it('returns the requested number of round ticks, starting at zero', () => {
    expect(niceTicks(1968)).toEqual([0, 1000, 2000])
    expect(niceTicks(1968)).toHaveLength(CHART_Y_TICK_COUNT)
    expect(niceTicks(1968)[0]).toBe(0)
  })

  it('always reaches at least the data maximum', () => {
    for (const max of [1, 7, 12, 96, 420, 1968, 2400, 1_000_001]) {
      const ticks = niceTicks(max)

      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max)
    }
  })

  it('uses a round step at every magnitude', () => {
    expect(niceTicks(0.4)).toEqual([0, 0.2, 0.4])
    // 24 needs a ceiling of 40 at three zero-based ticks: [0, 10, 20] would
    // leave the tallest bar above the axis top.
    expect(niceTicks(24)).toEqual([0, 20, 40])
    expect(niceTicks(9_600)).toEqual([0, 5_000, 10_000])
  })

  it('falls back to a unit scale for an all-zero series', () => {
    expect(niceTicks(0)).toEqual([0, 1, 2])
  })

  it('honours an explicit tick count', () => {
    expect(niceTicks(100, 5)).toEqual([0, 25, 50, 75, 100])
  })
})

describe('scaleBarHeights', () => {
  it('maps the largest value to exactly the configured max height', () => {
    const heights = scaleBarHeights(DEMO, 0.9)
    const peak = Math.max(...heights)

    expect(peak).toBe(0.9)
    expect(heights[DEMO.indexOf(1968)]).toBe(0.9)
  })

  it('is linear and zero-based', () => {
    // Half the peak is exactly half the height, and zero stays zero.
    expect(scaleBarHeights([10, 5, 0], 1)).toEqual([1, 0.5, 0])
  })

  it('scales against the axis ceiling when one is given, so ticks never lie', () => {
    // The demo's axis tops out at 2000 while its data tops out at 1968: the
    // tallest bar must stop just short of the top gridline, and a bar at the
    // ceiling itself must reach it exactly.
    const heights = scaleBarHeights(DEMO, 0.62, 2000)

    expect(heights[DEMO.indexOf(1968)]).toBeCloseTo(0.62 * (1968 / 2000), 6)
    expect(heights[DEMO.indexOf(1968)]).toBeLessThan(0.62)
    expect(scaleBarHeights([2000], 0.62, 2000)).toEqual([0.62])
    // Linear against the ceiling too: half the ceiling is half the height.
    expect(scaleBarHeights([1000, 500, 0], 1, 2000)).toEqual([0.5, 0.25, 0])
  })

  it('keeps the configured default when no height is passed', () => {
    expect(scaleBarHeights([4, 2])).toEqual([CHART_MAX_BAR_HEIGHT, CHART_MAX_BAR_HEIGHT / 2])
  })

  it('never produces a negative or NaN bar for degenerate input', () => {
    expect(scaleBarHeights([0, 0, 0], 0.9)).toEqual([0, 0, 0])
    expect(scaleBarHeights([5, -3], 0.9)).toEqual([0.9, 0])
    expect(scaleBarHeights([], 0.9)).toEqual([])
    // A zero ceiling is not a division by zero.
    expect(scaleBarHeights([5], 0.9, 0)).toEqual([0])
  })
})

describe('chartDomain', () => {
  it('returns the axis ceiling and its ticks for a series', () => {
    const domain = chartDomain(DEMO)

    expect(domain.max).toBe(2000)
    expect(domain.ticks).toEqual([0, 1000, 2000])
  })

  it('keeps the ceiling at or above the data maximum', () => {
    const domain = chartDomain([3, 8, 11])

    expect(domain.max).toBeGreaterThanOrEqual(11)
  })
})

describe('formatValue', () => {
  it('groups thousands and appends the unit', () => {
    expect(formatValue(1968, 'followers')).toBe('1,968 followers')
    expect(formatValue(1_234_567, 'visits')).toBe('1,234,567 visits')
  })

  it('omits the unit when there is none', () => {
    expect(formatValue(1968)).toBe('1,968')
  })

  it('keeps a fractional value readable', () => {
    expect(formatValue(12.5, 'kg')).toBe('12.5 kg')
    expect(formatValue(3.25)).toBe('3.25')
  })

  it('never renders NaN', () => {
    expect(formatValue(Number.NaN, 'x')).toBe('0 x')
  })
})

describe('formatTickLabel', () => {
  it('keeps small values verbatim', () => {
    expect(formatTickLabel(0)).toBe('0')
    expect(formatTickLabel(250)).toBe('250')
  })

  it('compacts thousands and millions', () => {
    expect(formatTickLabel(1000)).toBe('1k')
    expect(formatTickLabel(1500)).toBe('1.5k')
    expect(formatTickLabel(2000)).toBe('2k')
    expect(formatTickLabel(1_000_000)).toBe('1M')
    expect(formatTickLabel(2_500_000)).toBe('2.5M')
  })

  it('keeps the sign', () => {
    expect(formatTickLabel(-1500)).toBe('-1.5k')
  })
})
