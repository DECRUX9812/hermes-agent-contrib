import { describe, expect, it } from 'vitest'

import { compactFacts, contentHash, hygiene, renderSummary, similarFact, truncate } from './hygiene'

const draft = (over: Record<string, unknown> = {}) => ({
  headline: 'Shiki monolith split',
  result: 'Cut 44.7% of emitted JS; shiki entry 19.5MB -> 701KB',
  facts: [{ confidence: 0.9, text: 'largest chunk is now 3.08MB' }],
  ...over
})

describe('hygiene', () => {
  it('validates a clean draft and keeps it promotable', () => {
    const s = hygiene('s-1', 'sm-1', draft())
    expect(s.validation.state).toBe('valid')
    expect(s.validation.fixes).toEqual([])
    expect(s.facts).toHaveLength(1)
    expect(s.promotion.state).toBe('pending')
    expect(s.contentHash).toMatch(/^fnv:[0-9a-f]{16}$/)
  })

  it('never drops the result, only caps it, and says so', () => {
    const s = hygiene('s-1', 'sm-1', draft({ result: 'x'.repeat(5000) }))
    expect(s.result.length).toBeLessThanOrEqual(2000)
    expect(s.result.endsWith('…')).toBe(true)
    expect(s.validation.fixes).toContain('truncated:result')
  })

  it('collapses intra-summary near-duplicate facts', () => {
    const s = hygiene('s-1', 'sm-1', draft({
      facts: [
        { text: 'the shiki chunk is 19.5MB of javascript' },
        { text: 'the shiki chunk is 19.5MB of javascript!' },
        { text: 'grammars are lazy now' }
      ]
    }))
    expect(s.facts).toHaveLength(2)
    expect(s.validation.dropped).toBe(1)
  })

  it('drops facts already present in the durable context', () => {
    const s = hygiene('s-1', 'sm-1', draft({ facts: [{ text: 'live commit is 2f9269b01c' }] }), {
      knownFactTexts: ['live commit is 2f9269b01c']
    })
    expect(s.facts).toHaveLength(0)
    expect(s.validation.dropped).toBe(1)
  })

  it('redacts secrets before they can be promoted', () => {
    const s = hygiene('s-1', 'sm-1', draft({ result: 'used ghp_ABCDEFGHIJKLMNOPQRSTUV and Bearer abcdefghijklmnop' }))
    expect(s.result).not.toContain('ghp_')
    expect(s.result).not.toContain('abcdefghijklmnop')
    expect(s.result).toContain('[redacted]')
  })

  it('marks an empty summary as empty rather than promotable', () => {
    const s = hygiene('s-1', 'sm-1', { facts: [], result: '   ' })
    expect(s.validation.state).toBe('empty')
  })

  it('marks a non-object draft as malformed', () => {
    const s = hygiene('s-1', 'sm-1', null as unknown as Record<string, unknown>)
    expect(s.validation.state).toBe('malformed')
  })

  it('caps facts and keeps the most confident ones', () => {
    const facts = Array.from({ length: 12 }, (_, i) => ({ confidence: i / 12, text: `distinct fact number ${i} about ${i}` }))
    const s = hygiene('s-1', 'sm-1', draft({ facts }))
    expect(s.facts).toHaveLength(8)
    expect(s.facts.some(f => f.text.includes('number 0'))).toBe(false)
  })

  it('truncate and similarity helpers behave', () => {
    expect(truncate('abcdef', 4)).toEqual({ text: 'abc…', truncated: true })
    expect(similarFact('a b c d', 'a b c d')).toBe(true)
    expect(similarFact('a b c d', 'w x y z')).toBe(false)
  })

  it('renders a compact promotable block', () => {
    const s = hygiene('s-1', 'sm-1', draft())
    const text = renderSummary(s)
    expect(text).toContain('## Shiki monolith split')
    expect(text).toContain('**facts**')
  })

  it('hashes stably and distinctly', () => {
    expect(contentHash('same')).toBe(contentHash('same'))
    expect(contentHash('same')).not.toBe(contentHash('other'))
  })

  it('compacts weak facts before strong ones', () => {
    const out = compactFacts(
      [
        { text: 'strong fact that is long enough', unverified: false },
        { text: 'weak fact that is long enough', unverified: true }
      ],
      40
    )
    expect(out.map(f => f.text)).toEqual(['strong fact that is long enough'])
  })
})
