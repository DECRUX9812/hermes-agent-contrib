import { describe, expect, it } from 'vitest'

import { cleanPreviewLine } from './labels'

describe('cleanPreviewLine', () => {
  it('removes heading markers that survived the backend flattening to one line', () => {
    // The exact shape the live roster showed: `##` mid-sentence, not at a
    // line start, so stripPreviewMarkdown's anchored heading regex misses it.
    expect(cleanPreviewLine("Fixed and live. Here's the whole thing. ## The overlay bug — root cause `gro…")).toBe(
      "Fixed and live. Here's the whole thing. The overlay bug — root cause gro…"
    )
  })

  it('still strips per-line markdown (headings, quotes, bold) from multi-line messages', () => {
    expect(cleanPreviewLine('Intro line\n## Section head\n> quoted reply\n**Status:** every check green')).toBe(
      'Intro line Section head quoted reply Status: every check green'
    )
  })

  it('drops a leading list bullet so a row starts on the item', () => {
    expect(cleanPreviewLine('- deploy the plugin')).toBe('deploy the plugin')
  })

  it('never eats hyphens used mid-sentence (issue numbers, ranges)', () => {
    expect(cleanPreviewLine('fixed issue #12 in the 5-10 word range')).toBe('fixed issue #12 in the 5-10 word range')
  })

  it('collapses whitespace and treats empty input as empty', () => {
    expect(cleanPreviewLine('  a   b\t\tc  ')).toBe('a b c')
    expect(cleanPreviewLine(null)).toBe('')
    expect(cleanPreviewLine(undefined)).toBe('')
  })
})
