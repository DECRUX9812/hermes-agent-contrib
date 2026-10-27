import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ContextGauge, TraceList } from './context-panel'
import { CONTEXT_PANEL_EN } from './context-panel-i18n'
import type { TraceTurn } from './context-panel-model'

afterEach(cleanup)

const turn = (index: number, overrides: Partial<TraceTurn> = {}): TraceTurn => ({
  answered: true,
  id: `turn-${index}`,
  index,
  prompt: `prompt ${index}`,
  steps: [
    { context: 'ls', icon: 'terminal', id: `${index}a`, name: 'Terminal', took: 900 },
    { context: 'cat x', icon: 'terminal', id: `${index}b`, name: 'Terminal', took: 3200 }
  ],
  ...overrides
})

describe('ContextGauge', () => {
  it('shows the reading and fills the meter', () => {
    render(
      <ContextGauge
        reading={{ compressions: 0, estimated: false, max: 200_000, percent: 92, used: 184_000 }}
        text={CONTEXT_PANEL_EN}
      />
    )

    expect(screen.getByTestId('rail-context-reading').textContent).toBe('92% · 184k / 200k')
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('92')
    expect(screen.getByTestId('rail-context-gauge').getAttribute('data-tone')).toBe('full')
  })

  it('says so when there is no reading yet', () => {
    render(<ContextGauge reading={null} text={CONTEXT_PANEL_EN} />)

    expect(screen.getByTestId('rail-context-reading').textContent).toBe(CONTEXT_PANEL_EN.waiting)
  })
})

describe('TraceList', () => {
  it('lists turns newest first with only the newest unfolded', () => {
    const turns = [turn(1), turn(2, { slowest: undefined })]

    turns[1].slowest = turns[1].steps[1]
    render(<TraceList busy={false} text={CONTEXT_PANEL_EN} turns={turns} />)

    const rows = screen.getAllByTestId('rail-trace-turn')

    expect(rows[0].textContent).toContain('Turn 2')
    expect(screen.getAllByTestId('rail-trace-step')).toHaveLength(2)
    expect(screen.getByText('Longest wait: Terminal, 3.2s')).toBeTruthy()

    fireEvent.click(screen.getByText('Turn 1'))
    expect(screen.getAllByTestId('rail-trace-step')).toHaveLength(4)
  })

  it('marks the newest turn as running while the chat is busy', () => {
    render(<TraceList busy text={CONTEXT_PANEL_EN} turns={[turn(1)]} />)

    expect(screen.getByText(CONTEXT_PANEL_EN.working)).toBeTruthy()
  })

  it('has a quiet empty state', () => {
    render(<TraceList busy={false} text={CONTEXT_PANEL_EN} turns={[]} />)

    expect(screen.getByText(CONTEXT_PANEL_EN.none)).toBeTruthy()
  })
})
