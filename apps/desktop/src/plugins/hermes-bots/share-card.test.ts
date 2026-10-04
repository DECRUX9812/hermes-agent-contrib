/**
 * The share card's words must fit its box: wrapping never exceeds the line
 * budget, and text that doesn't fit ends on an ellipsis rather than being
 * silently cut mid-thought.
 */

import { describe, expect, it } from 'vitest'

import { wrapText } from './share-card'

const measure = (s: string) => s.length * 10

describe('wrapText', () => {
  it('fits within width and line budget, ellipsising overflow', () => {
    const text = 'Keeps the launch calendar honest and nudges owners before anything slips past its date'
    const lines = wrapText(text, 200, 2, measure)

    expect(lines).toHaveLength(2)
    expect(lines.every(line => measure(line) <= 200)).toBe(true)
    expect(lines[1].endsWith('…')).toBe(true)
    expect(wrapText('Short and sweet', 200, 2, measure)).toEqual(['Short and sweet'])
  })
})
