import { describe, expect, it } from 'vitest'

import { $showReasoning, localShowReasoning, setShowReasoningFromConfig } from './reasoning-disclosure'

/**
 * Reasoning is opt-in: the transcript shows the answer, not the chain of
 * thought. The message object keeps the part (and the logs keep it); these
 * assertions pin that the visible surface starts without it.
 */
describe('reasoning visibility default', () => {
  it('is off by default, so no reasoning text reaches the transcript', () => {
    expect($showReasoning.get()).toBe(false)
  })

  it('turns on only for an explicit truthy value', () => {
    setShowReasoningFromConfig(true)
    expect($showReasoning.get()).toBe(true)
  })

  it('stays off for a missing or falsy value', () => {
    for (const off of [false, 'false', 0, undefined, null]) {
      setShowReasoningFromConfig(off)
      expect($showReasoning.get()).toBe(false)
    }
  })
})

describe('localShowReasoning', () => {
  it('reads the local per-platform key over the global one', () => {
    expect(localShowReasoning({ show_reasoning: true, platforms: { cli: { show_reasoning: false } } })).toBe(false)
    expect(localShowReasoning({ show_reasoning: false, platforms: { cli: { show_reasoning: true } } })).toBe(true)
  })

  it('falls back to the global key, and ignores other platforms', () => {
    expect(localShowReasoning({ show_reasoning: false })).toBe(false)
    expect(localShowReasoning({ show_reasoning: true, platforms: { telegram: { show_reasoning: false } } })).toBe(true)
    expect(localShowReasoning(undefined)).toBeUndefined()
  })
})
