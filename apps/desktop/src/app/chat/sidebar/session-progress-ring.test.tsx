import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionProgressRing } from './session-progress-ring'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        row: {
          progressRing: (done: number, total: number) => `${done} of ${total} steps done`
        }
      }
    }
  })
}))

afterEach(cleanup)

const RING_CIRCUMFERENCE = 2 * Math.PI * 6

describe('SessionProgressRing', () => {
  it('is an image named by the localized progress', () => {
    render(<SessionProgressRing done={2} total={5} />)

    expect(screen.getByRole('img', { name: '2 of 5 steps done' })).toBeTruthy()
  })

  it('fills the arc to the completed fraction', () => {
    const { container } = render(<SessionProgressRing done={2} total={5} />)
    const arc = container.querySelector('[data-slot="progress-arc"]')

    expect(Number(arc?.getAttribute('stroke-dashoffset'))).toBeCloseTo(RING_CIRCUMFERENCE * 0.6, 5)
  })

  it('leaves the arc empty when nothing is done and never overfills past the whole', () => {
    const { container, rerender } = render(<SessionProgressRing done={0} total={4} />)
    const arc = () => container.querySelector('[data-slot="progress-arc"]')

    expect(Number(arc()?.getAttribute('stroke-dashoffset'))).toBeCloseTo(RING_CIRCUMFERENCE, 5)

    rerender(<SessionProgressRing done={4} total={4} />)

    expect(Number(arc()?.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5)
  })

  it('animates the arc only under motion-safe', () => {
    const { container } = render(<SessionProgressRing done={1} total={3} />)
    const arc = container.querySelector('[data-slot="progress-arc"]')

    expect(arc?.getAttribute('class')).toContain('motion-safe:transition-[stroke-dashoffset]')
  })
})
