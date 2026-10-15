/**
 * The goal-first board's behaviour against a fixture `fork.team.board`: the Needs-you
 * filter, template apply idempotency (same request id on retry), the card actions'
 * RPCs and refresh, the null-usage em dashes, and Inspect opening the drawer state
 * without a navigation.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TeamBoardCard, TeamBoardResult } from './team-board'
import { TEAM_EN, type TeamText } from './team-i18n'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()
  const { atom } = await import('nanostores')

  return {
    ...sdk,
    host: {
      ...sdk.host,
      navigate: vi.fn(),
      notify: vi.fn(),
      notifyError: vi.fn(),
      request: (...args: unknown[]) => mocks.request(...args),
      state: {
        ...sdk.host.state,
        connectionId: atom('c1'),
        showsAdvancedChrome: atom(false)
      }
    }
  }
})

const { TeamBoard, TemplateCards } = await import('./team-board-view')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')

const t = TEAM_EN as unknown as TeamText

const assignee = (profile: string, title: string) => ({ profile, role: 'teammate', title })

const card = (over: Partial<TeamBoardCard>): TeamBoardCard => {
  const { status = 'ready', ...rest } = over

  return {
    column: 'queued',
    cost_usd: null,
    elapsed_s: null,
    needs_you: null,
    session_id: 'sess_1',
    stoppable: false,
    takeable: true,
    task_id: 't1',
    title: 'Card',
    tokens: null,
    ...rest,
    status
  }
}

const board = (): TeamBoardResult => ({
  cards: [
    card({
      assignee: assignee('rr-lead', 'Research lead'),
      column: 'in_progress',
      elapsed_s: 65,
      last_tool: { name: 'terminal', status: 'running' },
      stoppable: true,
      task_id: 'lead1',
      title: 'Lead: Ship the report',
      tokens: 1200,
      cost_usd: 0.5
    }),
    card({
      assignee: assignee('rr-writer', 'Writer'),
      column: 'needs_approval',
      needs_you: 'approval',
      task_id: 'w1',
      title: 'Gather sources'
    })
  ],
  goal: { id: 'g1', status: 'open', title: 'Ship the report' },
  totals: { cost_usd: 0.5, done: 0, in_progress: 1, needs_approval: 1, needs_you: 1, queued: 0, tokens: 1200 }
})

const template = () => ({
  description: 'A lead coordinates research, writing, and fact-checking.',
  name: 'Research & Report',
  seats: [
    { instruction: 'lead', lead: true, reports_to: null, role: 'lead', title: 'Research lead' },
    { instruction: 'research', lead: false, reports_to: 'lead', role: 'researcher', title: 'Researcher' }
  ],
  template_id: 'research-report'
})

let calls: { method: string; params: Record<string, unknown> }[] = []

function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  calls = []
  mocks.request.mockReset()
  mocks.request.mockImplementation(async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params })

    if (method === 'fork.team.board') {
      return board()
    }

    if (method === 'fork.team.templates.list') {
      return { templates: [template()] }
    }

    if (method === 'profiles.list') {
      return { profiles: [{ name: 'rr-lead' }, { name: 'rr-writer' }] }
    }

    if (method === 'fork.team.card.takeover') {
      return { profile: 'rr-writer', session_id: 'sess_1' }
    }

    return {}
  })
})

afterEach(cleanup)

describe('TeamBoard', () => {
  it('groups the board result into the four columns and shows the active goal and totals', async () => {
    mount(<TeamBoard t={t} teamId="team_1" />)

    await waitFor(() => expect(screen.getByText('Lead: Ship the report')).toBeTruthy())
    expect(screen.getByText('Ship the report')).toBeTruthy()
    expect(screen.getAllByText('$0.50').length).toBe(2)
    expect(screen.getAllByText('1200').length).toBe(2)
    expect(screen.getByText('Needs you (1)')).toBeTruthy()
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.getByText('Needs approval')).toBeTruthy()
  })

  it('renders missing usage as an em dash on the card', async () => {
    mount(<TeamBoard t={t} teamId="team_1" />)

    const row = await screen.findByText('Gather sources')

    expect(row.closest('[data-slot="team-card"]')?.textContent).toContain('—')
  })

  it('filters the board down to the cards that need the user, and back', async () => {
    mount(<TeamBoard t={t} teamId="team_1" />)

    await waitFor(() => expect(screen.getByText('Lead: Ship the report')).toBeTruthy())

    fireEvent.click(screen.getByText('Needs you (1)'))

    expect(screen.queryByText('Lead: Ship the report')).toBeNull()
    expect(screen.getByText('Gather sources')).toBeTruthy()

    fireEvent.click(screen.getByText('Needs you (1)'))

    expect(screen.getByText('Lead: Ship the report')).toBeTruthy()
  })

  it('starts a goal through fork.team.goal.start with the typed title', async () => {
    mount(<TeamBoard t={t} teamId="team_1" />)

    const input = await screen.findByPlaceholderText(t.goalAsk)

    fireEvent.change(input, { target: { value: 'Audit the docs' } })
    fireEvent.click(screen.getByText(t.startGoal))

    await waitFor(() => expect(calls.some(c => c.method === 'fork.team.goal.start' && c.params.title === 'Audit the docs')).toBe(true))
    expect(calls.some(c => c.method === 'fork.team.goal.start' && c.params.team_id === 'team_1')).toBe(true)
  })

  it('stops only a stoppable card through fork.team.card.stop and refreshes the board', async () => {
    mount(<TeamBoard t={t} teamId="team_1" />)

    const leadCard = (await screen.findByText('Lead: Ship the report')).closest('[data-slot="team-card"]') as HTMLElement
    const writerCard = (screen.getByText('Gather sources').closest('[data-slot="team-card"]') as HTMLElement)!

    // The queued card is not running: the backend says stoppable=false, so no Stop is offered.
    expect(writerCard.querySelector('[data-slot="team-card-stop"]')).toBeNull()
    expect(leadCard.querySelector('[data-slot="team-card-stop"]')).toBeTruthy()

    const reads = calls.filter(c => c.method === 'fork.team.board').length

    fireEvent.click(leadCard.querySelector('[data-slot="team-card-stop"]')!)

    await waitFor(() => expect(calls.some(c => c.method === 'fork.team.card.stop' && c.params.task_id === 'lead1')).toBe(true))
    await waitFor(() => expect(calls.filter(c => c.method === 'fork.team.board').length).toBeGreaterThan(reads))
  })

  it('takes a card over, offers Hand back, and hands it back to the seat it came from', async () => {
    mount(<TeamBoard t={t} teamId="team_1" />)

    const writerCard = (await screen.findByText('Gather sources')).closest('[data-slot="team-card"]') as HTMLElement

    fireEvent.click(writerCard.querySelector('[data-slot="team-card-takeover"]')!)

    await waitFor(() => expect(calls.some(c => c.method === 'fork.team.card.takeover' && c.params.task_id === 'w1')).toBe(true))

    const handback = window.document.querySelector('[data-slot="team-card-handback"]') as HTMLElement

    expect(handback).toBeTruthy()
    fireEvent.click(handback)

    await waitFor(() =>
      expect(
        calls.some(c => c.method === 'fork.team.card.resume' && c.params.task_id === 'w1' && c.params.assignee === 'rr-writer')
      ).toBe(true)
    )
  })

  it('opens the inspect drawer in place without navigating away', async () => {
    const { host } = await import('@hermes/plugin-sdk')

    mount(<TeamBoard t={t} teamId="team_1" />)

    const leadCard = (await screen.findByText('Lead: Ship the report')).closest('[data-slot="team-card"]') as HTMLElement

    fireEvent.click(leadCard.querySelector('[data-slot="team-card-inspect"]')!)

    const drawer = window.document.querySelector('[data-slot="team-inspect-drawer"]')

    expect(drawer).toBeTruthy()
    expect(drawer?.textContent).toContain('Lead: Ship the report')
    expect(host.navigate).not.toHaveBeenCalled()
  })
})

describe('TemplateCards', () => {
  it('retries the apply with the SAME request id, so the backend never creates two teams', async () => {
    let applies = 0

    mocks.request.mockImplementation(async (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params })

      if (method === 'fork.team.templates.apply') {
        applies += 1

        if (applies === 1) {
          throw new Error('gateway hiccup')
        }

        return { created: true, team: { id: 'team_new' } }
      }

      if (method === 'fork.team.templates.list') {
        return { templates: [template()] }
      }

      return {}
    })

    const onApplied = vi.fn()

    mount(<TemplateCards onApplied={onApplied} t={t} />)

    const apply = () => {
      const cards = window.document.querySelectorAll('[data-slot="team-template"]')

      return cards[0].querySelector('button') as HTMLElement
    }

    await waitFor(() => expect(window.document.querySelectorAll('[data-slot="team-template"]').length).toBe(1))

    fireEvent.click(apply())

    await waitFor(() => expect(applies).toBe(1))
    expect(mocks.request.mock.calls.filter(([m]) => m === 'fork.team.templates.apply')).toHaveLength(1)

    fireEvent.click(apply())

    await waitFor(() => expect(applies).toBe(2))

    const [first, second] = mocks.request.mock.calls.filter(([m]) => m === 'fork.team.templates.apply')

    expect((first[1] as { request_id: string }).request_id).toBeTruthy()
    expect((first[1] as { request_id: string }).request_id).toBe((second[1] as { request_id: string }).request_id)
    expect((second[1] as { template_id: string }).template_id).toBe('research-report')
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith('team_new'))
  })
})
