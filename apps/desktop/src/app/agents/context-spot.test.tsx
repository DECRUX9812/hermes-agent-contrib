import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { bootstrapContext } from '@/orchestrator/context'
import { deriveContextSpot } from '@/orchestrator/panel'

import { ContextSpot } from './context-spot'

afterEach(cleanup)

const readySpot = () =>
  deriveContextSpot(
    {
      ...bootstrapContext('local'),
      constraints: ['no writes to the served tree'],
      facts: [{ id: 'f1', sourceEntry: 'ce-1', text: 'shiki split landed' }],
      objective: 'ship the desktop fixes',
      openDecisions: [{ askedAt: '2026-10-30T17:00:00Z', id: 'd1', options: [], question: 'merge the WIP test?' }],
      revision: 3
    },
    []
  )

const props = () => ({ onNewChat: vi.fn(), onSetObjective: vi.fn(), spot: null })

describe('Homie Spot', () => {
  it('renders an intentional empty state instead of blank space', () => {
    render(<ContextSpot {...props()} />)
    expect(screen.getByLabelText('Homie Spot context').getAttribute('data-state')).toBe('empty')
    expect(screen.getByText(/No objective yet/i)).toBeTruthy()
    expect(screen.getByLabelText('Orchestrator objective')).toBeTruthy()
  })

  it('renders an error state with the reason and an alert role', () => {
    render(<ContextSpot {...props()} error="gateway unreachable" />)
    expect(screen.getByLabelText('Homie Spot context').getAttribute('data-state')).toBe('error')
    expect(screen.getByRole('alert').textContent).toContain('gateway unreachable')
  })

  it('renders the objective, constraints and pending decisions when data exists', () => {
    render(<ContextSpot {...props()} spot={readySpot()} />)
    expect(screen.getByLabelText('Homie Spot context').getAttribute('data-state')).toBe('ready')
    expect(screen.getByText('ship the desktop fixes')).toBeTruthy()
    expect(screen.getByText('no writes to the served tree')).toBeTruthy()
    expect(screen.getByText('merge the WIP test?')).toBeTruthy()
  })

  it('offers a New chat entry point that navigates', () => {
    const p = props()
    render(<ContextSpot {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(p.onNewChat).toHaveBeenCalledTimes(1)
  })

  it('sets the objective from the empty state', () => {
    const p = props()
    render(<ContextSpot {...p} />)
    fireEvent.change(screen.getByLabelText('Orchestrator objective'), { target: { value: 'ship 1.0' } })
    fireEvent.submit(screen.getByLabelText('Orchestrator objective').closest('form')!)
    expect(p.onSetObjective).toHaveBeenCalledWith('ship 1.0')
  })
})
