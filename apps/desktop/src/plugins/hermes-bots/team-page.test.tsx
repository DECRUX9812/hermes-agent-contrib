/**
 * The Team page against a fixture team: what a Simple-mode user sees (org, goals, approvals),
 * what only Advanced adds (audit, policy), and that an approval decision reaches the gateway.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeamView } from './team'
import { TEAM_EN } from './team-i18n'

const mocks = vi.hoisted(() => ({ advanced: null as null | { set: (v: boolean) => void }, request: vi.fn() }))

const fixture = (): TeamView => {
  const budget = (limit: null | number, spent: number) => ({ hard_stop: true, monthly_usd: limit, spent_usd: spent })

  const ceo = {
    budget: budget(null, 0),
    credentials: [],
    lead: true,
    plugins: [],
    profile: 'ceo',
    reports_to: null,
    role: 'Chief of staff',
    skills: [],
    slot: 'seat_ceo',
    status: 'active',
    title: ''
  }

  const writer = {
    ...ceo,
    budget: budget(10, 9),
    lead: false,
    profile: 'writer',
    reports_to: 'seat_ceo',
    role: 'Content',
    skills: ['seo'],
    slot: 'seat_w'
  }

  const open = { ...ceo, lead: false, profile: null, reports_to: 'seat_ceo', role: 'Designer', slot: 'seat_o' }

  return {
    team: {
      approvals: [
        {
          created_at: 1,
          detail: '',
          id: 'apr1',
          kind: 'spend',
          note: '',
          requested_by: 'writer',
          status: 'pending',
          subject: '$50 on ads'
        }
      ],
      channels: {},
      goals: [
        { detail: '', id: 'g1', owner: null, parent_id: null, status: 'open', task_ids: ['t1'], title: 'Grow blog' },
        { detail: '', id: 'g2', owner: 'seat_w', parent_id: 'g1', status: 'active', task_ids: [], title: 'Ship posts' }
      ],
      id: 'team_1',
      learnings: [{ at: 1, by: 'writer', count: 2, id: 'l1', text: 'Always cite sources' }],
      members: [ceo, writer, open],
      mission: 'Reach 10k users',
      name: 'Growth',
      policy: { lead_decides: false },
      updated_at: 5
    },
    tree: [
      {
        ...ceo,
        reports: [
          { ...writer, reports: [] },
          { ...open, reports: [] }
        ]
      }
    ],
    rollup: {
      goals: {
        g1: { blocked: false, done: 1, percent: 50, status: 'open', total: 2 },
        g2: { blocked: false, done: 0, percent: 0, status: 'active', total: 0 }
      },
      overall: { done: 1, percent: 50, total: 2 }
    }
  }
}

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom } = await import('nanostores')
  const showsAdvancedChrome = atom(false)
  mocks.advanced = showsAdvancedChrome

  return {
    ...sdk,
    host: {
      ...sdk.host,
      notify: vi.fn(),
      notifyError: vi.fn(),
      request: (...args: unknown[]) => mocks.request(...args),
      state: { ...sdk.host.state, connectionId: atom('c1'), showsAdvancedChrome }
    },
    usePluginI18n:
      () =>
      (key: string, ...args: unknown[]) => {
        const leaf = key
          .split('.')
          .slice(1)
          .reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], TEAM_EN)

        return typeof leaf === 'function' ? (leaf as (...a: unknown[]) => string)(...args) : String(leaf ?? key)
      }
  }
})

const { TeamPage } = await import('./team-page')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <QueryClientProvider client={client}>
      <TeamPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.advanced?.set(false)
  mocks.request.mockReset()
  mocks.request.mockImplementation(async (method: string) => {
    if (method === 'bots_team.list') {
      return {
        teams: [
          {
            goal_count: 2,
            id: 'team_1',
            member_count: 3,
            mission: '',
            name: 'Growth',
            open_seats: 1,
            pending_approvals: 1,
            updated_at: 5
          }
        ]
      }
    }

    if (method === 'bots_team.get') {
      return fixture()
    }

    if (method === 'bots_team.approval.decide') {
      return { ...fixture(), approval: {} }
    }

    return { entries: [] }
  })
})

afterEach(cleanup)

describe('TeamPage', () => {
  it('shows the org chart with open seats, goals with roll-up, learnings and what needs the user', async () => {
    mount()

    expect((await screen.findAllByText('Reach 10k users')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('ceo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Designer').length).toBeGreaterThan(0)
    expect(screen.getByText('1 open seat')).toBeTruthy()
    expect(screen.getByText('Grow blog')).toBeTruthy()
    expect(screen.getAllByText('1/2 · 50%')).toHaveLength(2) // overall bar + the parent goal
    expect(screen.getByText('Always cite sources')).toBeTruthy()
    expect(screen.getByText('$50 on ads')).toBeTruthy()
    expect(document.querySelector('[data-slot="team-budget"][data-tone="warn"]')).toBeTruthy()
  })

  it('keeps developer surfaces out of Simple mode', async () => {
    mount()
    await screen.findByText('$50 on ads')

    expect(document.querySelector('[data-slot="team-advanced"]')).toBeNull()
    expect(document.querySelector('[data-slot="team-activity"]')).toBeNull()
  })

  it('adds the audit trail and approval policy in Advanced mode', async () => {
    mocks.advanced?.set(true)
    mount()

    await screen.findByText('$50 on ads')
    expect(document.querySelector('[data-slot="team-advanced"]')).toBeTruthy()
    expect(document.querySelector('[data-slot="team-activity"]')).toBeTruthy()
  })

  it('sends the board decision to the gateway when the user approves', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('bots_team.approval.decide', {
        approval_id: 'apr1',
        approve: true,
        team_id: 'team_1'
      })
    )
  })

  it('delegates a goal to a teammate through spawn_task, defaulting to the goal owner', async () => {
    mount()
    await screen.findByText('Ship posts')

    // second goal ("Ship posts") is owned by the writer seat
    fireEvent.click(screen.getAllByLabelText('Assign work')[1]!)
    fireEvent.change(screen.getByPlaceholderText('What should they do?'), { target: { value: 'Write post 1' } })
    fireEvent.submit(screen.getByPlaceholderText('What should they do?').closest('form')!)

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('bots_team.goal.spawn_task', {
        assignee: 'seat_w',
        goal_id: 'g2',
        team_id: 'team_1',
        title: 'Write post 1'
      })
    )
  })

  it('offers to start a team when none exists, and treats an older gateway as no teams', async () => {
    mocks.request.mockImplementation(async () => {
      throw new Error('unknown method')
    })
    mount()

    expect(await screen.findByText('No team yet')).toBeTruthy()
  })
})
