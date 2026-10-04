import type { DelegationReport } from '@hermes/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $delegationReportsBySession, $dismissedDelegationReports } from '@/store/delegation-reports'
import type * as Windows from '@/store/windows'
import type { SessionInfo } from '@/types/hermes'

import { SidebarDelegationReports } from './delegation-reports'

const openSessionInNewWindow = vi.fn()

afterEach(cleanup)

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        delegationReports: {
          done: 'Done',
          needsDecision: 'Needs decision',
          failed: 'Failed',
          openSubagent: 'Open subagent',
          dismiss: 'Dismiss report',
          tasks: (count: number, completed: number) => `${completed} of ${count} tasks finished`
        }
      }
    }
  })
}))

vi.mock('@/store/windows', async importOriginal => {
  const actual = await importOriginal<typeof Windows>()

  return { ...actual, openSessionInNewWindow: (...args: unknown[]) => openSessionInNewWindow(...args) }
})

const report = (id: string, extra: Partial<DelegationReport> = {}): DelegationReport => ({
  delegation_id: id,
  state: 'completed',
  outcome: 'done',
  title: `task ${id}`,
  summary: 'finished cleanly',
  summary_source: 'heuristic',
  task_count: 1,
  completed_count: 1,
  failed_count: 0,
  ...extra
})

const session = (id: string, profile = 'default'): SessionInfo => ({ id, profile }) as unknown as SessionInfo

describe('SidebarDelegationReports', () => {
  beforeEach(() => {
    $delegationReportsBySession.set({})
    $dismissedDelegationReports.set({})
    openSessionInNewWindow.mockClear()
  })

  it('renders a card per visible report in fold order', () => {
    $delegationReportsBySession.set({
      s1: [report('d1', { title: 'Scan the logs' })],
      s2: [report('d2', { title: 'Tidy the queue' })]
    })

    render(<SidebarDelegationReports sessions={[session('s2'), session('s1')]} />)

    expect(screen.getByText('Tidy the queue')).toBeTruthy()
    expect(screen.getByText('Scan the logs')).toBeTruthy()
    expect(screen.getAllByText('Done')).toHaveLength(2)
  })

  it('opens the delegated worker session from the card action', () => {
    $delegationReportsBySession.set({
      s1: [report('d1', { title: 'Scan', child_session_ids: { '0': 'child-sess-9' } })]
    })

    render(<SidebarDelegationReports sessions={[session('s1')]} />)
    fireEvent.click(screen.getByText('Open subagent'))

    expect(openSessionInNewWindow).toHaveBeenCalledWith('child-sess-9', { watch: true })
  })

  it('dismisses a card into the session profile bucket', () => {
    $delegationReportsBySession.set({ s1: [report('d1', { title: 'Scan' })] })

    render(<SidebarDelegationReports sessions={[session('s1', 'work')]} />)
    fireEvent.click(screen.getByLabelText('Dismiss report'))

    expect(screen.queryByText('Scan')).toBeNull()
    expect($dismissedDelegationReports.get().work).toEqual(['d1'])
  })

  it('marks the mixed middle as needs-decision', () => {
    $delegationReportsBySession.set({
      s1: [report('d1', { outcome: 'needs_decision', task_count: 2, completed_count: 1, title: 'Batch' })]
    })

    render(<SidebarDelegationReports sessions={[session('s1')]} />)

    expect(screen.getByText('Needs decision')).toBeTruthy()
    expect(screen.getByText('1 of 2 tasks finished')).toBeTruthy()
  })

  it('renders nothing for sessions with no reports', () => {
    const { container } = render(<SidebarDelegationReports sessions={[session('s-empty')]} />)
    expect(container.firstChild).toBeNull()
  })
})
