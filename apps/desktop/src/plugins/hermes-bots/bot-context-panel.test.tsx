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

const { listPersistedSessions, openSession, request } = vi.hoisted(() => ({
  listPersistedSessions: vi.fn(),
  openSession: vi.fn(),
  request: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom: nanoAtom } = await import('nanostores')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      listPersistedSessions,
      openSession,
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
const { $botMeta } = await import('./data')
const { $groupChats, $groupClarify } = await import('./group-chat')
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
  listPersistedSessions.mockResolvedValue({ limit: 25, offset: 0, sessions: [], total: 0 })
  openSession.mockResolvedValue(undefined)
  $lastRoster.set([])
  $selectedBot.set('default')
  $focused.set({ connectionId: 'local', profile: 'research' })
  $botMeta.set({})
  $groupChats.set({})
  $groupClarify.set({})
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
    for (const tab of ['Activity', 'Scheduled', 'History']) {
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

  it('shows an honest empty state for history', async () => {
    request.mockResolvedValue({ jobs: [], scoped: 'research' })
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Activity')

    fireEvent.click(screen.getByText('History'))
    expect(await screen.findByText('No recent conversations')).toBeTruthy()
  })

  // The History tab used to render exactly one row (`last_session`) while the
  // Activity timeline above already listed every conversation — the panel
  // contradicting itself, and the single row duplicated the footer's "Open
  // chat". History now lists what the timeline knows.
  it('lists every recent conversation on the History tab', async () => {
    request.mockResolvedValue({ jobs: [], scoped: 'research' })
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [
        { id: 'sess-a', last_active: Math.floor((NOW - 60_000) / 1000), message_count: 4, title: 'Rail layout options' },
        { id: 'sess-b', last_active: Math.floor((NOW - 3_600_000) / 1000), message_count: 9, title: 'Q3 planning notes' },
        { id: 'sess-c', last_active: Math.floor((NOW - 90_000_000) / 1000), message_count: 1, title: 'Old thread' }
      ],
      total: 3
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Activity')

    fireEvent.click(screen.getByText('History'))

    expect(await screen.findByText('Rail layout options')).toBeTruthy()
    expect(screen.getByText('Q3 planning notes')).toBeTruthy()
    expect(screen.getByText('Old thread')).toBeTruthy()
    // Counts travel with each row, so the list is scannable without opening it.
    expect(screen.getByText('4 messages')).toBeTruthy()
    // Newest first, and the empty state stays away.
    expect(screen.queryByText('No recent conversations')).toBeNull()

    fireEvent.click(screen.getByText('Q3 planning notes'))
    await vi.waitFor(() => expect(openSession).toHaveBeenCalled())
    expect(openSession.mock.calls.at(-1)?.[0]).toBe('sess-b')
  })

  it('edits the bot goal inline — Enter commits, Esc cancels, Set stays disabled until non-blank', async () => {
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Research')

    fireEvent.click(screen.getByRole('button', { name: 'Edit goal' }))
    const input = screen.getByLabelText('Bot goal')
    const setBtn = screen.getByRole('button', { name: 'Set' })

    expect((setBtn as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'Ship the release' } })
    expect((setBtn as HTMLButtonElement).disabled).toBe(false)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('Bot goal')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Edit goal' }))
    fireEvent.change(screen.getByLabelText('Bot goal'), { target: { value: 'Ship the release' } })
    fireEvent.submit(screen.getByLabelText('Bot goal').closest('form')!)

    await vi.waitFor(() => expect($botMeta.get()['research::local']?.goal ?? $botMeta.get()['research']?.goal).toBe('Ship the release'))
  })

  it('dismisses a needs-you prompt inline', async () => {
    $groupClarify.set({
      'room:req1': {
        at: Date.now(),
        group: 'Ops',
        kind: 'approval',
        member: 'research',
        choices: [],
        memberKey: 'research',
        question: 'Deploy the fix?',
        requestId: 'req1',
        thread: 't1'
      }
    })
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText(/Deploy the fix/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText(/Deploy the fix/)).toBeNull()
    expect(Object.keys($groupClarify.get())).toHaveLength(0)
  })

  it('shows a running-round strip with an inline Stop that halts the room', async () => {
    $groupChats.set({
      Ops: {
        epoch: 1,
        holds: {},
        log: [],
        members: [{ name: 'research', title: '' }],
        roomId: 'r1',
        running: true,
        sessions: {},
        watermarks: {}
      } as never
    })
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText(/Running round/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await vi.waitFor(() => expect($groupChats.get().Ops?.running).toBe(false))
  })

  it('shows an unreachable banner when the bot source is offline', async () => {
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research', sourceReachable: false }]))

    expect(await screen.findByText(/unreachable right now/i)).toBeTruthy()
  })

  // The activity view used to be routines-only: a bot you actually talk to —
  // the normal case — had zero scheduled jobs and therefore an empty panel
  // that said "No completed runs yet" forever, even with 50 conversations on
  // disk. Conversations are the other half of "activity".
  it('lists the bot’s own conversations as activity when nothing is scheduled', async () => {
    request.mockResolvedValue({ jobs: [], scoped: 'research' })
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [
        { id: 'sess-today', last_active: Math.floor((NOW - 30_000) / 1000), message_count: 12, title: 'Rail layout options' },
        { id: 'sess-yesterday', last_active: Math.floor((NOW - 86400000) / 1000), message_count: 1, title: 'Q3 notes' }
      ],
      total: 2
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('Rail layout options')).toBeTruthy()
    expect(screen.getByText('Q3 notes')).toBeTruthy()
    // Counts are singular/plural aware, not "1 messages".
    expect(screen.getByText('12 messages')).toBeTruthy()
    expect(screen.getByText('1 message')).toBeTruthy()

    // Day grouping still applies, and the empty state is gone.
    const days = await screen.findAllByTestId('panel-day')
    expect(days.map(day => day.textContent)).toEqual(['Today', 'Yesterday'])
    expect(screen.queryByTestId('panel-empty-live')).toBeNull()

    // The panel asked the bot's OWN profile, not the active one.
    expect(listPersistedSessions.mock.calls[0][1]).toMatchObject({ profile: 'research' })
  })

  it('opens the conversation a row belongs to', async () => {
    request.mockResolvedValue({ jobs: [], scoped: 'research' })
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [{ id: 'sess-today', last_active: Math.floor((NOW - 60_000) / 1000), message_count: 3, title: 'Rail layout options' }],
      total: 1
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    fireEvent.click(await screen.findByText('Rail layout options'))

    await vi.waitFor(() => expect(openSession).toHaveBeenCalled())
    expect(openSession.mock.calls[0][0]).toBe('sess-today')
    expect(openSession.mock.calls[0][1]).toMatchObject({ profile: 'research', intent: 'tab' })
  })

  it('offers a way out when there is genuinely nothing to show', async () => {
    request.mockResolvedValue({ jobs: [], scoped: 'research' })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText(/Runs and conversations for this bot appear here/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New cron' })).toBeTruthy()
  })
})
