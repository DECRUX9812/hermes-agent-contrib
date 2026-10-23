import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CatalogFeaturedSlider } from './catalog-featured-slider'

const slides = () => ['One', 'Two', 'Three'].map(label => <div key={label}>{label}</div>)

const activeDot = () =>
  screen.getAllByRole('button').findIndex(button => button.getAttribute('aria-current') === 'true')

beforeEach(() => {
  vi.useFakeTimers()
  HTMLElement.prototype.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CatalogFeaturedSlider', () => {
  it('auto-advances on schedule even while its parent keeps re-rendering', () => {
    const { rerender } = render(<CatalogFeaturedSlider slides={slides()} />)
    const firstDot = activeDot()

    // A parent re-render every 3s (status polling, store updates) must not
    // restart the 7s auto-advance countdown.
    for (let elapsed = 0; elapsed < 7500; elapsed += 2500) {
      act(() => {
        vi.advanceTimersByTime(2500)
      })
      rerender(<CatalogFeaturedSlider slides={slides()} />)
    }

    expect(activeDot()).toBe(firstDot + 1)
  })
})
