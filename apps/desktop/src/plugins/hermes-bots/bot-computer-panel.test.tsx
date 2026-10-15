import type * as HermesSdk from '@hermes/plugin-sdk'
import { queryClient } from '@hermes/plugin-sdk'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { ComputerTimelineResult } from './bot-computer'
import { BotComputerTimeline, BotTodoChecklist } from './bot-computer-panel'
import { translateBots } from './i18n-test-helper'
import type { RosterRow } from './types'

const { dispatchEvent, onEvent, request, resetListeners } = vi.hoisted(() => {
  const listeners = new Set<(event: { connectionId?: string; session_id?: string }) => void>()

  return {
    dispatchEvent: (event: { connectionId?: string; session_id?: string }) => {
      for (const listener of listeners) {
        listener(event)
      }
    },
    onEvent: vi.fn((_type: string, listener: (event: { connectionId?: string; session_id?: string }) => void) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    }),
    request: vi.fn(async (_method: string, _params: Record<string, unknown>) => ({})),
    resetListeners: () => listeners.clear()
  }
})

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return { ...sdk, host: { ...sdk.host, onEvent, request }, usePluginI18n: () => translateBots }
})

const BOT: RosterRow = {
  canonical_session: { id: 'canonical-session', resolved_id: 'canonical-session' },
  name: 'writer'
}

const step = (
  id: string,
  index: number,
  kind: 'file' | 'terminal',
  title: string
): ComputerTimelineResult['steps'][number] => ({
  id,
  index,
  kind,
  tool: kind,
  title,
  status: 'done',
  duration_s: 1.2,
  detail:
    kind === 'terminal'
      ? { command: title.replace(/^Ran /, ''), output_tail: 'ready' }
      : { path: 'README.md', diff: '+Ready' }
})

function mount(child: ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{child}</QueryClientProvider>)
}

beforeEach(() => {
  request.mockReset()
  resetListeners()
  queryClient.clear()
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

it('renders timeline rows and terminal detail from the computer timeline RPC', async () => {
  request.mockResolvedValue({
    session_id: 'canonical-session',
    steps: [step('call-terminal', 0, 'terminal', 'Ran echo ready')],
    todos: []
  })

  const view = mount(<BotComputerTimeline bot={BOT} />)
  expect(await screen.findByText('Ran echo ready')).toBeTruthy()
  expect(screen.getByText('echo ready')).toBeTruthy()
  expect(screen.getByText('ready')).toBeTruthy()
  expect(request).toHaveBeenCalledWith('fork.computer.timeline', {
    profile: 'writer',
    session_id: 'canonical-session'
  })
  view.unmount()
})

it('Live follows a step added by refetch', async () => {
  let timeline: ComputerTimelineResult = {
    session_id: 'canonical-session',
    steps: [step('call-terminal', 0, 'terminal', 'Ran echo ready')],
    todos: []
  }

  request.mockImplementation(async method => (method === 'fork.computer.timeline' ? timeline : {}))
  const view = mount(<BotComputerTimeline bot={BOT} />)

  expect(await screen.findByText('echo ready')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true')

  timeline = {
    ...timeline,
    steps: [...timeline.steps, step('call-latest', 1, 'terminal', 'Ran printf latest')]
  }
  dispatchEvent({ session_id: 'canonical-session' })

  await waitFor(() => expect(screen.getByTestId('computer-step-detail').textContent).toContain('printf latest'))
  expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true')
  view.unmount()
})

it('keeps a selected step by id when refreshed timeline positions change', async () => {
  let timeline: ComputerTimelineResult = {
    session_id: 'canonical-session',
    steps: [step('call-terminal', 0, 'terminal', 'Ran echo ready'), step('call-file', 1, 'file', 'Edited README.md')],
    todos: []
  }

  request.mockImplementation(async method => (method === 'fork.computer.timeline' ? timeline : {}))
  const view = mount(<BotComputerTimeline bot={BOT} />)

  fireEvent.click(await screen.findByRole('button', { name: /Edited README\.md/ }))
  expect(screen.getByTestId('computer-step-detail').textContent).toContain('README.md')
  timeline = {
    ...timeline,
    steps: [
      timeline.steps[0],
      step('call-new', 1, 'terminal', 'Ran another command'),
      { ...timeline.steps[1], index: 2 }
    ]
  }
  dispatchEvent({ session_id: 'canonical-session' })

  await waitFor(() =>
    expect(
      within(screen.getByTestId('computer-step-list'))
        .getByRole('button', { name: /Edited README\.md/ })
        .getAttribute('aria-current')
    ).toBe('step')
  )
  expect(screen.getByTestId('computer-step-detail').textContent).toContain('README.md')
  view.unmount()
})

it('shows pending, in-progress, completed, and cancelled checklist items', async () => {
  request.mockResolvedValue({
    session_id: 'canonical-session',
    steps: [],
    todos: [
      { id: 'pending', content: 'Pending item', status: 'pending' },
      { id: 'working', content: 'Current item', status: 'in_progress' },
      { id: 'done', content: 'Finished item', status: 'completed' },
      { id: 'cancelled', content: 'Cancelled item', status: 'cancelled' }
    ]
  })

  const view = mount(<BotTodoChecklist bot={BOT} />)
  const checklist = await screen.findByTestId('bot-todo-checklist')

  for (const [content, status] of [
    ['Pending item', 'pending'],
    ['Current item', 'in_progress'],
    ['Finished item', 'completed'],
    ['Cancelled item', 'cancelled']
  ]) {
    expect(checklist.querySelector(`li[data-status="${status}"]`)?.textContent).toContain(content)
  }

  view.unmount()
})
