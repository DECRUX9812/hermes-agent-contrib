import type { PluginRestOptions } from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Test harness supplies the host's locale registration, as plugin loading does.
// eslint-disable-next-line no-restricted-imports
import { registerPluginLocales } from '@/i18n/plugin-i18n'

import { bindApi } from './api'
import { KANBAN_LOCALES } from './i18n'
import { SquadsPanel } from './squads'
import type { SquadRun } from './types'

vi.mock('@/hermes', () => ({ setApiRequestProfile: vi.fn() }))

const roles = [
  { id: 'developer', name: 'Developer', emoji: '🛠️', summary: 'Builds it', profile: 'squad-developer', bot_exists: true, builtin: true },
  { id: 'reviewer', name: 'Reviewer', emoji: '🔎', summary: 'Checks it', profile: 'squad-reviewer', bot_exists: false, builtin: true }
]

const templates = [
  {
    id: 'feature',
    name: 'Feature',
    summary: 'Build, then review.',
    builtin: true,
    steps: [
      { key: 'build', role: 'developer', title: 'Build', needs: [], final: false },
      { key: 'review', role: 'reviewer', title: 'Review', needs: ['build'], final: true }
    ]
  }
]

const run: SquadRun = {
  id: 't_root',
  title: 'Squad: Feature — Add dark mode',
  created_at: 0,
  template: 'feature',
  template_name: 'Feature',
  goal: 'Add dark mode',
  state: 'running',
  done: 0,
  total: 2,
  lanes: [
    { key: 'build', role: 'developer', profile: 'squad-developer', title: 'Build', needs: [], final: false, task_id: 't_build', status: 'running' },
    { key: 'review', role: 'reviewer', profile: 'squad-reviewer', title: 'Review', needs: ['build'], final: true, task_id: 't_review', status: 'todo' }
  ],
  notes: []
}

const rest = vi.fn(async (path: string, options?: PluginRestOptions): Promise<unknown> => {
  if (path === '/squads/roles') {
    return { roles }
  }

  if (path === '/squads/templates') {
    return { templates }
  }

  if (path === '/squads/runs' && options?.method === 'POST') {
    return { run }
  }

  if (path === '/squads/runs') {
    return { runs: [] }
  }

  if (path === '/squads/runs/t_root') {
    return { run }
  }

  if (path === '/squads/roles/reviewer/bot') {
    return { created: true, profile: 'squad-reviewer' }
  }

  if (path === '/dispatch') {
    return {}
  }

  throw new Error(`Unexpected REST request: ${path}`)
})

let client: QueryClient
let disposeApi: () => void
let disposeLocales: () => void

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  disposeLocales = registerPluginLocales('kanban', KANBAN_LOCALES)
  disposeApi = bindApi(
    async <T,>(path: string, options?: PluginRestOptions) => (await rest(path, options)) as T,
    { get: (_key, fallback) => fallback, set: vi.fn(), remove: vi.fn() },
    () => vi.fn()
  )
})

afterEach(() => {
  cleanup()
  client.clear()
  disposeApi()
  disposeLocales()
  vi.clearAllMocks()
})

function renderPanel(onOpenTask = vi.fn()) {
  render(
    <QueryClientProvider client={client}>
      <SquadsPanel onOpenTask={onOpenTask} />
    </QueryClientProvider>
  )

  return onOpenTask
}

describe('SquadsPanel', () => {
  it('lists the team and sets up a teammate that has no profile yet', async () => {
    renderPanel()
    const team = await screen.findByRole('list', { name: 'Team' })
    await within(team).findByText('Reviewer')
    fireEvent.click(within(team).getByRole('button', { name: 'Set up' }))
    await waitFor(() =>
      expect(rest).toHaveBeenCalledWith('/squads/roles/reviewer/bot', expect.objectContaining({ method: 'POST' }))
    )
  })

  it('starts a squad from the goal, creating missing teammates, then follows its lanes', async () => {
    const onOpenTask = renderPanel()
    await screen.findByText('Build, then review.')
    const start = screen.getByRole('button', { name: 'Start squad' })
    expect((start as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Goal' }), { target: { value: 'Add dark mode' } })
    fireEvent.click(start)

    await waitFor(() =>
      expect(rest).toHaveBeenCalledWith('/squads/runs', {
        method: 'POST',
        body: { create_missing: true, goal: 'Add dark mode', template: 'feature' }
      })
    )

    const review = await screen.findByRole('button', { name: 'Open Review' })
    expect(within(review).getByText('Waiting on Build')).toBeTruthy()
    fireEvent.click(review)
    expect(onOpenTask).toHaveBeenCalledWith('t_review')
  })
})
