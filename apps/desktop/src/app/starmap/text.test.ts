import { describe, expect, it } from 'vitest'

import { wrapText } from './text'

// Deterministic canvas stand-in: latin/digit/space are narrow, everything else
// (CJK, emoji, symbols) is wide — close enough to real font metrics to exercise
// the wrap decisions without a canvas.
const NARROW = 8
const WIDE = 16

const ctx = {
  measureText: (s: string) => ({
    width: Array.from(s).reduce((w, ch) => w + (/[\x20-\u024f]/.test(ch) ? NARROW : WIDE), 0)
  })
} as unknown as CanvasRenderingContext2D

const widthOf = (s: string) => ctx.measureText(s).width
const stripSpaces = (s: string) => s.replace(/\s+/g, '')

describe('wrapText', () => {
  it('keeps the whitespace greedy-wrap for ordinary sentences', () => {
    // 4-letter words, maxW = 3 words + 2 spaces (3*4*8 + 2*8 = 112).
    const lines = wrapText(ctx, 'aaaa bbbb cccc dddd eeee', 112)

    expect(lines).toEqual(['aaaa bbbb cccc', 'dddd eeee'])
  })

  it('wraps continuous CJK text instead of overflowing the width', () => {
    const text = '中文标签应当在画布提示范围内完整可读'.repeat(4)
    const lines = wrapText(ctx, text, 368)

    expect(lines.length).toBeGreaterThan(1)

    for (const line of lines) {
      expect(widthOf(line)).toBeLessThanOrEqual(368)
    }

    expect(lines.join('')).toBe(text)
  })

  it('wraps a long CJK token surrounded by normal words', () => {
    const cjk = '中文字符串'.repeat(6)
    const lines = wrapText(ctx, `hello ${cjk} world`, 200)

    expect(lines.length).toBeGreaterThan(1)

    for (const line of lines) {
      expect(widthOf(line)).toBeLessThanOrEqual(200)
    }

    // Every non-space character survives, in order. Whitespace positions may
    // differ where a token wrapped mid-word — lines render separately anyway.
    expect(stripSpaces(lines.join(''))).toBe(stripSpaces(`hello ${cjk} world`))
    expect(lines[0]).toBe('hello')
    expect(lines[lines.length - 1].endsWith('world')).toBe(true)
  })

  it('does not split emoji grapheme clusters', () => {
    const family = '👨‍👩‍👧‍👦' // 1 grapheme, 4 code points
    const flag = '🇨🇳' // regional indicator pair
    const text = `${family}${flag}`.repeat(10)

    const lines = wrapText(ctx, text, 160)

    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe(text)
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

    for (const line of lines) {
      for (const seg of segmenter.segment(line)) {
        expect([family, flag]).toContain(seg.segment)
      }
    }
  })

  it('puts a lone over-wide grapheme on its own line instead of looping', () => {
    // '字' alone is 16 wide — never fits a maxW of 10. Must still terminate
    // with the grapheme intact on its own line.
    const lines = wrapText(ctx, 'a 字 b', 10)

    expect(lines).toEqual(['a', '字', 'b'])
  })

  it('bounds every wrapped line to maxW', () => {
    const text = `word word ${'字'.repeat(50)} word word`
    const lines = wrapText(ctx, text, 100)

    for (const line of lines) {
      expect(widthOf(line)).toBeLessThanOrEqual(100)
    }

    expect(stripSpaces(lines.join(''))).toBe(stripSpaces(text))
  })
})
