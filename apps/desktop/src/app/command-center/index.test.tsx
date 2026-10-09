import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as HermesApi from '@/hermes'

import { CommandCenterView } from './index'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<typeof HermesApi>()),
  getActionStatus: vi.fn(() => Promise.resolve({ running: false })),
  getLogs: vi.fn(() => Promise.resolve({ lines: ['test-log-line'] })),
  getStatus: vi.fn(() =>
    Promise.resolve({
      active_sessions: 2,
      gateway_running: true,
      version: '0.9.0'
    })
  ),
  restartGateway: vi.fn(),
  updateHermes: vi.fn()
}))

vi.mock('./maintenance', () => ({
  MaintenancePanel: () => <div data-testid="maintenance-panel">Maintenance Content</div>
}))

afterEach(cleanup)

function renderCommandCenter(initialEntries: string[] = ['/command-center']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <CommandCenterView onClose={() => {}} />
    </MemoryRouter>
  )
}

describe('CommandCenterView sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders system section by default', async () => {
    renderCommandCenter(['/command-center'])

    expect(await screen.findByText('Messaging gateway running')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restart gateway' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Update Hermes' })).toBeTruthy()
  })

  it('only presents diagnostics tabs: system, maintenance, notices (sessions and usage removed)', async () => {
    const { container } = renderCommandCenter(['/command-center'])
    await screen.findByText('Messaging gateway running')

    expect(container.querySelector('[data-tour="nav-system"]')).toBeTruthy()
    expect(container.querySelector('[data-tour="nav-maintenance"]')).toBeTruthy()
    expect(container.querySelector('[data-tour="nav-notices"]')).toBeTruthy()

    expect(container.querySelector('[data-tour="nav-sessions"]')).toBeNull()
    expect(container.querySelector('[data-tour="nav-usage"]')).toBeNull()
  })

  it('falls back to system when deep link ?section=sessions arrives', async () => {
    const { container } = renderCommandCenter(['/command-center?section=sessions'])

    expect(await screen.findByText('Messaging gateway running')).toBeTruthy()
    expect(container.querySelector('[data-tour="nav-sessions"]')).toBeNull()
  })

  it('falls back to system when deep link ?section=usage arrives', async () => {
    const { container } = renderCommandCenter(['/command-center?section=usage'])

    expect(await screen.findByText('Messaging gateway running')).toBeTruthy()
    expect(container.querySelector('[data-tour="nav-usage"]')).toBeNull()
  })

  it('lands on notices when deep link ?section=notices arrives', async () => {
    renderCommandCenter(['/command-center?section=notices'])

    expect(await screen.findByText('No notices yet — toasts and alerts land here as they happen.')).toBeTruthy()
    expect(screen.queryByText('Messaging gateway running')).toBeNull()
  })

  it('lands on maintenance when deep link ?section=maintenance arrives', async () => {
    renderCommandCenter(['/command-center?section=maintenance'])

    expect(await screen.findByTestId('maintenance-panel')).toBeTruthy()
    expect(screen.queryByText('Messaging gateway running')).toBeNull()
  })

  it('switches between sections on tab click', async () => {
    const { container } = renderCommandCenter(['/command-center'])

    expect(await screen.findByText('Messaging gateway running')).toBeTruthy()

    const noticesNav = container.querySelector('[data-tour="nav-notices"]') as HTMLButtonElement
    await act(async () => {
      fireEvent.click(noticesNav)
    })
    expect(await screen.findByText('No notices yet — toasts and alerts land here as they happen.')).toBeTruthy()

    const maintenanceNav = container.querySelector('[data-tour="nav-maintenance"]') as HTMLButtonElement
    await act(async () => {
      fireEvent.click(maintenanceNav)
    })
    expect(await screen.findByTestId('maintenance-panel')).toBeTruthy()
  })
})
