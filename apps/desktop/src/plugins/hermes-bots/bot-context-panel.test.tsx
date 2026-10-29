/**
 * Bot Context Panel: the per-bot right rail paints the agent header, the
 * four-view toolbar, and a tasks timeline grouped by day — all from backend
 * evidence (routine runs, recent session), with the full routines list one
 * tab over and honest empty states where no system exists yet.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'
import type { RoutineJob } from './types'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom: nanoAtom } = await import('nanostores')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      request,
      // The panel's owner ladder starts here, so it has to be a real store.
      state: { ...sdk.host.state, focusedSessionOwner: nanoAtom(null) }
    },
    // The plugin bundle normally lands via `ctx.i18n.register` at load, so
    // without this every localized label renders empty.
    usePluginI18n: () => translateBots
  }
})

const { host } = await import('@hermes/plugin-sdk')
const { $lastRoster } = await import('./data')
const { $selectedBot } = await import('./bot-state')
const { BotContextPanel } = await import('./bot-context-panel')

/** The SDK store the panel's owner ladder reads. */
const $focused = host.state.focusedSessionOwner as unknown as ReturnType<typeof atom>

const NOW = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

const jobs: RoutineJob[] = [
  {
    enabled: true,
    job_id: 'j-today',
    last_run_at: iso(NOW - 3600000),
    last_status: 'ok',
    name: '[bot:research] Morning brief',
    schedule: 'every 1h',
    state: 'scheduled'
  },
  {
    enabled: true,
    job_id: 'j-yesterday',
    last_fire_error: 'gateway timeout',
    last_run_at: iso(NOW - 86400000),
    last_status: 'error',
    name: '[bot:research] Nightly audit',
    schedule: 'every 1d',
    state: 'scheduled'
  }
]

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <BotContextPanel />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  request.mockResolvedValue({ jobs, scoped: 'research' })
  $lastRoster.set([])
  $selectedBot.set('default')
  $focused.set({ connectionId: 'local', profile: 'research' })
})

afterEach(() => {
  cleanup()
})

describe('bot context panel', () => {
  it('paints the agent header, toolbar, and a day-grouped tasks timeline', async () => {
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    // Header: the bot's own name, not the pane title.
    expect(await screen.findByText('Research')).toBeTruthy()

    // Toolbar: all four views.
    for (const tab of ['Tasks', 'Scheduled', 'History', 'Saved']) {
      expect(screen.getByText(tab)).toBeTruthy()
    }

    // Timeline: routine runs grouped under day dividers with counts.
    const days = await screen.findAllByTestId('panel-day')
    expect(days.map(day => day.textContent)).toEqual(['Today', 'Yesterday'])
    expect(screen.getByText('Morning brief')).toBeTruthy()
    expect(screen.getByText('Nightly audit')).toBeTruthy()
    expect(screen.getByText('gateway timeout')).toBeTruthy()
    // Footer: the way back into the conversation.
    expect(screen.getByText(/Open chat/)).toBeTruthy()
  })

  it('keeps the full routines list one tab over', async () => {
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Morning brief')

    fireEvent.click(screen.getByText('Scheduled'))

    // The same job rows the old routines pane showed, create affordance kept.
    expect(await screen.findByText('Nightly audit')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New cron' })).toBeTruthy()
  })

  it('shows honest empty states for history and saved', async () => {
    request.mockResolvedValue({ jobs: [], scoped: 'research' })
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Tasks')

    fireEvent.click(screen.getByText('History'))
    expect(await screen.findByText('No recent conversations')).toBeTruthy()

    fireEvent.click(screen.getByText('Saved'))
    expect(await screen.findByText('Nothing saved yet')).toBeTruthy()
  })
})
