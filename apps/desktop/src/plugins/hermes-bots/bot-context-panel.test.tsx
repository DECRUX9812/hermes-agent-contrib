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
const { clearSessionActivity } = await import('./session-activity')

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
  clearSessionActivity()
  request.mockImplementation(async (method: string) => {
    if (method === 'session.history') {
      return { messages: [] }
    }

    if (method === 'bot_context.activities') {
      return { activities: [] }
    }

    return { jobs, scoped: 'research' }
  })
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
  it('paints one session at a time and switches the whole feed', async () => {
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [
        {
          id: 'sess-new',
          last_active: Math.floor((NOW - 30_000) / 1000),
          resolved_id: 'rt-new',
          title: 'Release check'
        },
        {
          id: 'sess-old',
          last_active: Math.floor((NOW - 3_600_000) / 1000),
          resolved_id: 'rt-old',
          title: 'Nightly audit'
        }
      ],
      total: 2
    })
    request.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === 'session.history') {
        const session = String(params.session_id)

        return {
          messages: [
            {
              role: 'user',
              text: session === 'sess-new' ? 'Ship the release' : 'Audit the nightly log',
              timestamp: Math.floor(NOW / 1000) - (session === 'sess-new' ? 30 : 4010)
            },
            {
              context: session === 'sess-new' ? 'npm run release' : 'tail -f audit.log',
              name: session === 'sess-new' ? 'terminal' : 'fetch',
              role: 'tool',
              timestamp: Math.floor(NOW / 1000) - (session === 'sess-new' ? 20 : 4000),
              tool_call_id: session === 'sess-new' ? 'new-1' : 'old-1'
            },
            {
              role: 'assistant',
              text:
                session === 'sess-new'
                  ? 'Release checks passed and the PR is open.'
                  : 'Audit found two denied events and one stale token.',
              timestamp: Math.floor(NOW / 1000) - (session === 'sess-new' ? 10 : 3990)
            }
          ]
        }
      }

      if (method === 'bot_context.activities') {
        return { activities: [] }
      }

      return { jobs, scoped: 'research' }
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    // Header and toolbar stay: the session selector lives inside Activity.
    expect(await screen.findByText('Research')).toBeTruthy()

    for (const tab of ['Activity', 'Scheduled', 'History', 'Bot']) {
      expect(screen.getByText(tab)).toBeTruthy()
    }

    // Newest session selected; only ITS task and outcome are on screen.
    expect(await screen.findByText('Ship the release')).toBeTruthy()
    expect(screen.getByText('Release checks passed and the PR is open.')).toBeTruthy()
    expect(screen.queryByText('Audit the nightly log')).toBeNull()
    expect(screen.getByText('Release check')).toBeTruthy()

    // Switching sessions replaces the feed rather than appending to it.
    fireEvent.click(screen.getByRole('option', { name: /Nightly audit/ }))
    expect(await screen.findByText('Audit the nightly log')).toBeTruthy()
    expect(screen.getByText('Audit found two denied events and one stale token.')).toBeTruthy()
    expect(screen.queryByText('Ship the release')).toBeNull()
  })

  it('opens customization from the avatar itself, with one tab stop', async () => {
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Research')

    const avatars = screen.getAllByRole('button', { name: 'Edit profile' })
    expect(avatars).toHaveLength(1)

    fireEvent.click(avatars[0])
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shows one meaningful task, hides housekeeping, and keeps the raw trace behind a toggle', async () => {
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [{ id: 'sess-a', last_active: Math.floor(NOW / 1000), resolved_id: 'rt-a', title: 'Release check' }],
      total: 1
    })
    request.mockImplementation(async (method: string) => {
      if (method === 'session.history') {
        return {
          messages: [
            { role: 'user', text: 'Update the launch kit', timestamp: Math.floor(NOW / 1000) - 120 },
            { context: 'Hook 3', name: 'todo_write', role: 'tool', timestamp: Math.floor(NOW / 1000) - 110 },
            {
              context: 'docs/launch-kit.md',
              error: 'wrong interpreter',
              name: 'read_file',
              role: 'tool',
              timestamp: Math.floor(NOW / 1000) - 100,
              tool_call_id: 'r1'
            },
            {
              context: 'docs/launch-kit.md',
              name: 'read_file',
              role: 'tool',
              timestamp: Math.floor(NOW / 1000) - 90,
              tool_call_id: 'r2'
            },
            { context: 'Hook 3', name: 'memory_search', role: 'tool', timestamp: Math.floor(NOW / 1000) - 80 },
            {
              context: 'docs/launch-kit.md',
              name: 'read_file',
              role: 'tool',
              timestamp: Math.floor(NOW / 1000) - 70,
              tool_call_id: 'r3'
            },
            {
              role: 'assistant',
              text: 'Launch kit now uses Hook 3 everywhere, synced to ~/Code. More detail follows.',
              timestamp: Math.floor(NOW / 1000) - 60
            }
          ]
        }
      }

      if (method === 'bot_context.activities' || method === 'bot_context.history') {
        return method === 'bot_context.activities' ? { activities: [] } : { decisions: [] }
      }

      if (method === 'bot_context.subagents') {
        return { subagents: [] }
      }

      return { jobs: [], scoped: 'research' }
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('Update the launch kit')).toBeTruthy()
    expect(screen.getByText('Launch kit now uses Hook 3 everywhere, synced to ~/Code.')).toBeTruthy()
    expect(screen.queryByText(/todo/i)).toBeNull()
    expect(screen.queryByText(/memory/i)).toBeNull()
    expect(screen.queryByText('Failed', { selector: 'span' })).toBeNull()
    expect(screen.queryByText('read_file')).toBeNull()

    fireEvent.click(screen.getByText('Update the launch kit'))
    fireEvent.click(screen.getByRole('button', { name: 'Show technical details' }))
    expect(await screen.findByTestId('activity-trace')).toBeTruthy()
    expect(screen.getAllByText('read_file · docs/launch-kit.md')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Hide technical details' })).toBeTruthy()
  })

  it('keeps the bot computer in its own Bot tab', async () => {
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Activity')

    fireEvent.click(screen.getByText('Bot'))

    expect(await screen.findByTestId('bot-screen-tab')).toBeTruthy()
    expect(screen.getByText('Computer')).toBeTruthy()
  })

  it('keeps the full routines list one tab over', async () => {
    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Activity')

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
        {
          id: 'sess-a',
          last_active: Math.floor((NOW - 60_000) / 1000),
          message_count: 4,
          title: 'Rail layout options'
        },
        {
          id: 'sess-b',
          last_active: Math.floor((NOW - 3_600_000) / 1000),
          message_count: 9,
          title: 'Q3 planning notes'
        },
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

    await vi.waitFor(() =>
      expect($botMeta.get()['research::local']?.goal ?? $botMeta.get()['research']?.goal).toBe('Ship the release')
    )
  })

  it('filters the activity feed by status without changing the session', async () => {
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [{ id: 'sess-a', last_active: Math.floor(NOW / 1000), resolved_id: 'rt-a', title: 'Release check' }],
      total: 1
    })
    request.mockImplementation(async (method: string) => {
      if (method === 'session.history') {
        return {
          messages: [
            { role: 'user', text: 'Publish the package', timestamp: Math.floor(NOW / 1000) - 60 },
            {
              context: 'npm publish',
              error: 'permission denied',
              name: 'terminal',
              role: 'tool',
              timestamp: Math.floor(NOW / 1000) - 50
            },
            { role: 'assistant', text: 'Publish failed: permission denied.', timestamp: Math.floor(NOW / 1000) - 40 },
            { role: 'user', text: 'Run the checks', timestamp: Math.floor(NOW / 1000) - 30 },
            { context: 'npm test', name: 'terminal', role: 'tool', timestamp: Math.floor(NOW / 1000) - 20 },
            { role: 'assistant', text: 'Checks passed.', timestamp: Math.floor(NOW / 1000) - 10 }
          ]
        }
      }

      if (method === 'bot_context.activities') {
        return { activities: [] }
      }

      if (method === 'bot_context.history') {
        return { decisions: [] }
      }

      if (method === 'bot_context.subagents') {
        return { subagents: [] }
      }

      return { jobs: [], scoped: 'research' }
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('Publish the package')).toBeTruthy()
    expect(screen.getByText('Run the checks')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Failed/ }))

    expect(await screen.findByText('Publish the package')).toBeTruthy()
    expect(screen.queryByText('Run the checks')).toBeNull()
  })

  it('lists a session’s subagents with summary and expandable steps', async () => {
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [{ id: 'sess-a', last_active: Math.floor(NOW / 1000), resolved_id: 'rt-a', title: 'Release check' }],
      total: 1
    })
    request.mockImplementation(async (method: string) => {
      if (method === 'session.history') {
        return { messages: [] }
      }

      if (method === 'bot_context.activities' || method === 'bot_context.history') {
        return method === 'bot_context.activities' ? { activities: [] } : { decisions: [] }
      }

      if (method === 'bot_context.subagents') {
        return {
          count: 1,
          subagents: [
            {
              duration_ms: 1200,
              goal: 'Research the API contract',
              role: 'leaf',
              session_id: 'child-1',
              started_at: Math.floor(NOW / 1000) - 120,
              status: 'succeeded',
              subagent_id: 'sa-1',
              summary: 'Read the OpenAPI file and found two endpoints.',
              tool_calls: [{ status: 'ok', targets: { path: 'docs/openapi.yaml' }, tool: 'read_file' }]
            }
          ]
        }
      }

      return { jobs: [], scoped: 'research' }
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('Subagents')).toBeTruthy()
    expect(await screen.findByText('Research the API contract')).toBeTruthy()
    expect(screen.getByText('Read the OpenAPI file and found two endpoints.')).toBeTruthy()

    fireEvent.click(screen.getByText('Research the API contract'))
    expect(await screen.findByText(/read file · docs\/openapi.yaml/)).toBeTruthy()
  })

  it('shows a clear approval history for the selected session', async () => {
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [{ id: 'sess-a', last_active: Math.floor(NOW / 1000), resolved_id: 'rt-a', title: 'Release check' }],
      total: 1
    })
    request.mockImplementation(async (method: string) => {
      if (method === 'session.history') {
        return { messages: [] }
      }

      if (method === 'bot_context.activities') {
        return { activities: [] }
      }

      if (method === 'bot_context.history') {
        return {
          decisions: [
            {
              activity_id: 'req-1',
              command: 'npm publish',
              description: 'Publish the package',
              settled_at: Math.floor(NOW / 1000) - 60,
              settled_choice: 'once',
              status: 'approved'
            },
            {
              activity_id: 'req-2',
              command: 'git push --force',
              description: 'Force push',
              settled_at: Math.floor(NOW / 1000) - 120,
              settled_choice: 'deny',
              status: 'denied'
            }
          ]
        }
      }

      return { jobs: [], scoped: 'research' }
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('Approval history')).toBeTruthy()
    expect(await screen.findByText('npm publish')).toBeTruthy()
    expect(screen.getByText('git push --force')).toBeTruthy()
    expect(screen.getAllByText(/Approved/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Denied/).length).toBeGreaterThan(0)
  })

  it('renders an approval in the session feed and answers it there', async () => {
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [
        { id: 'sess-a', last_active: Math.floor((NOW - 60_000) / 1000), resolved_id: 'rt-a', title: 'Deploy' }
      ],
      total: 1
    })
    request.mockImplementation(async (method: string) => {
      if (method === 'session.history') {
        return { messages: [] }
      }

      if (method === 'bot_context.activities') {
        return {
          activities: [
            {
              activity_id: 'req-approval',
              command: 'rm -rf /tmp/build',
              description: 'Delete the stale build directory',
              choices: ['once', 'deny'],
              kind: 'command',
              requested_at: Math.floor(NOW / 1000),
              session: { id: 'sess-a' },
              status: 'pending'
            }
          ]
        }
      }

      return { jobs: [], scoped: 'research' }
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('Approval needed')).toBeTruthy()
    fireEvent.click(screen.getByText('Approval needed'))
    expect((await screen.findAllByText('Delete the stale build directory')).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Answer once' }))

    await vi.waitFor(() => {
      expect(request.mock.calls.some(call => call[0] === 'bot_context.respond')).toBe(true)
    })
    expect(await screen.findByText('Approved')).toBeTruthy()
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

  // A bot used the normal way — chatting — must still have a reachable list of
  // what it did, even with zero scheduled jobs. The History tab is that list;
  // the Activity tab is the per-session feed.
  it('lists the bot’s own conversations on the History tab when nothing is scheduled', async () => {
    request.mockImplementation(async (method: string) => {
      if (method === 'session.history') {
        return { messages: [] }
      }

      if (method === 'bot_context.activities') {
        return { activities: [] }
      }

      return { jobs: [], scoped: 'research' }
    })
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [
        {
          id: 'sess-today',
          last_active: Math.floor((NOW - 30_000) / 1000),
          message_count: 12,
          title: 'Rail layout options'
        },
        { id: 'sess-yesterday', last_active: Math.floor((NOW - 86400000) / 1000), message_count: 1, title: 'Q3 notes' }
      ],
      total: 2
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Activity')
    fireEvent.click(screen.getByText('History'))

    expect(await screen.findByText('Rail layout options')).toBeTruthy()
    expect(screen.getByText('Q3 notes')).toBeTruthy()
    // Counts are singular/plural aware, not "1 messages".
    expect(screen.getByText('12 messages')).toBeTruthy()
    expect(screen.getByText('1 message')).toBeTruthy()

    // The panel asked the bot's OWN profile, not the active one.
    expect(listPersistedSessions.mock.calls[0][1]).toMatchObject({ profile: 'research' })
  })

  it('opens the conversation a row belongs to', async () => {
    request.mockResolvedValue({ jobs: [], scoped: 'research' })
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [
        {
          id: 'sess-today',
          last_active: Math.floor((NOW - 60_000) / 1000),
          message_count: 3,
          title: 'Rail layout options'
        }
      ],
      total: 1
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))
    await screen.findByText('Activity')
    fireEvent.click(screen.getByText('History'))

    fireEvent.click(await screen.findByText('Rail layout options'))

    await vi.waitFor(() => expect(openSession).toHaveBeenCalled())
    expect(openSession.mock.calls[0][0]).toBe('sess-today')
    expect(openSession.mock.calls[0][1]).toMatchObject({ profile: 'research', intent: 'tab' })
  })

  it('offers an honest empty state when the bot has no sessions', async () => {
    request.mockImplementation(async (method: string) => {
      if (method === 'session.history') {
        return { messages: [] }
      }

      return { jobs: [], scoped: 'research' }
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('No sessions yet')).toBeTruthy()
    expect(screen.getByText(/Start a chat with this bot/)).toBeTruthy()
  })

  it('surfaces a session-list failure with a retry instead of an empty feed', async () => {
    listPersistedSessions.mockRejectedValue(new Error('gateway offline'))

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('Session activity')).toBeTruthy()
    expect(screen.getByText('Could not read this session’s activity.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('surfaces a history failure for the selected session', async () => {
    listPersistedSessions.mockResolvedValue({
      limit: 25,
      offset: 0,
      sessions: [{ id: 'sess-a', last_active: Math.floor(NOW / 1000), title: 'Release check' }],
      total: 1
    })
    request.mockImplementation(async (method: string) => {
      if (method === 'session.history') {
        throw new Error('history unavailable')
      }

      if (method === 'bot_context.activities') {
        return { activities: [] }
      }

      return { jobs: [], scoped: 'research' }
    })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    expect(await screen.findByText('Could not read this session’s activity.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  // The footer used to print relativeTime() alone, so it read "now" — a word
  // with no subject that looks like a control. It now names what is fresh.
  it('names the footer timestamp instead of printing a bare "now"', async () => {
    request.mockResolvedValue({ jobs: [], scoped: 'research' })

    renderPanel()
    act(() => $lastRoster.set([{ connectionId: 'local', name: 'research' }]))

    // Wait for the first fetch to land: until then the footer shows the
    // "just now" fallback and both branches would look identical to a bare
    // relativeTime. The assertion is about the timestamp branch.
    await vi.waitFor(() => expect(screen.queryByText('Updated just now')).toBeNull())

    expect(screen.getByText(/^Updated \S/)).toBeTruthy()
    expect(screen.queryByText(/^now$/)).toBeNull()
  })
})
