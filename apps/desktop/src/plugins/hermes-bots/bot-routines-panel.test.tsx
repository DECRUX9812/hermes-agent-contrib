import type * as HermesSdk from '@hermes/plugin-sdk'
import { queryClient } from '@hermes/plugin-sdk'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { BotRoutine } from './bot-routines'
import { BotRoutinesPanel } from './bot-routines-panel'
import { translateBots } from './i18n-test-helper'
import type { RosterRow } from './types'

const { request } = vi.hoisted(() => ({
  request: vi.fn(async (_method: string, _params: Record<string, unknown>) => ({}))
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, host: { ...sdk.host, request }, usePluginI18n: () => translateBots }
})

const BOT: RosterRow = { name: 'writer' }

const fixture = (): BotRoutine => ({
  id: 'routine-1',
  name: 'Morning routine',
  kind: 'schedule',
  schedule: '0 9 * * *',
  prompt: 'Prepare a morning summary.',
  enabled: true
})

let serverRoutines: BotRoutine[]

function mount(child: ReactNode) {
  const view = render(<QueryClientProvider client={queryClient}>{child}</QueryClientProvider>)

  return view
}

beforeEach(() => {
  serverRoutines = [fixture()]
  request.mockImplementation(async (method, params) => {
    if (method === 'fork.routines.list') {
      return { routines: serverRoutines }
    }

    if (method === 'cron.manage') {
      return { jobs: [] }
    }

    if (method === 'fork.routines.pause') {
      serverRoutines = serverRoutines.map(routine =>
        routine.id === params.id ? { ...routine, enabled: false } : routine
      )

      return { routines: serverRoutines }
    }

    if (method === 'fork.routines.remove') {
      serverRoutines = serverRoutines.filter(routine => routine.id !== params.id)

      return { routines: serverRoutines }
    }

    return { routines: serverRoutines }
  })
  queryClient.clear()
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

it('pauses a routine through its profile-scoped fork RPC', async () => {
  const view = mount(<BotRoutinesPanel bot={BOT} name="Writer" onCreate={() => undefined} />)
  const row = await screen.findByTestId('routine:routine-1')

  fireEvent.click(within(row).getByRole('button', { name: 'Pause' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('fork.routines.pause', { profile: 'writer', id: 'routine-1' })
  )
  view.unmount()
})

it('removes a routine after inline confirmation through its profile-scoped fork RPC', async () => {
  const view = mount(<BotRoutinesPanel bot={BOT} name="Writer" onCreate={() => undefined} />)
  const row = await screen.findByTestId('routine:routine-1')

  fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
  const confirmation = within(row).getByRole('group', { name: 'Confirm routine removal' })
  expect(confirmation.textContent).toContain('Remove “Morning routine”?')
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Remove' }))

  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('fork.routines.remove', { profile: 'writer', id: 'routine-1' })
  )
  await waitFor(() => expect(screen.queryByTestId('routine:routine-1')).toBeNull())
  view.unmount()
})
