/**
 * usePacedText: history present at mount is never re-typed, settled text is
 * shown whole, appends ease in without ever showing text that hasn't arrived,
 * and a replaced (non-append) text shows at once.
 */

import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usePacedText } from './stream-pacing'

const burst = 'x'.repeat(600)

describe('usePacedText', () => {
  it('shows text present at mount in full, even mid-stream', () => {
    const { result } = renderHook(() => usePacedText('already here', true))

    expect(result.current).toBe('already here')
  })

  it('passes settled text straight through', () => {
    const { rerender, result } = renderHook(({ text }) => usePacedText(text, false), {
      initialProps: { text: 'a' }
    })

    rerender({ text: `a${burst}` })
    expect(result.current).toBe(`a${burst}`)
  })

  it('eases an appended burst in and catches up to everything that arrived', async () => {
    const { rerender, result } = renderHook(({ text }) => usePacedText(text, true), {
      initialProps: { text: 'a' }
    })

    rerender({ text: `a${burst}` })
    const first = result.current

    expect(`a${burst}`.startsWith(first)).toBe(true)
    expect(first.length).toBeLessThan(burst.length + 1)
    await waitFor(() => expect(result.current).toBe(`a${burst}`))
  })

  it('shows replaced text at once instead of pacing it', () => {
    const { rerender, result } = renderHook(({ text }) => usePacedText(text, true), {
      initialProps: { text: 'first draft' }
    })

    rerender({ text: 'rewritten' })
    expect(result.current).toBe('rewritten')
  })
})
