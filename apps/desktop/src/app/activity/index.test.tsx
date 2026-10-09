import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type * as Nanostores from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as AttentionInbox from '@/store/attention-inbox'

import { ActivityView } from './index'

const { $attentionItemCountMock } = vi.hoisted(() => {
  const { atom: nanoAtom } = require('nanostores') as typeof Nanostores

  return {
    $attentionItemCountMock: nanoAtom(0)
  }
})

vi.mock('@/store/attention-inbox', async importOriginal => {
  const actual = await importOriginal<typeof AttentionInbox>()

  return {
    ...actual,
    $attentionItemCount: $attentionItemCountMock
  }
})

vi.mock('@/app/chat/sidebar/agent-presence', () => ({
  AgentPresence: () => <div data-testid="agent-presence" />
}))

vi.mock('@/app/chat/sidebar/colony-roster', () => ({
  ColonyRoster: () => <div data-testid="colony-roster" />
}))

vi.mock('./activity-tab', () => ({
  ActivityTab: () => <div data-testid="activity-tab-content">Activity Content</div>
}))

vi.mock('./approvals-tab', () => ({
  ApprovalsTab: () => <div data-testid="approvals-tab-content">Approvals Content</div>
}))

afterEach(() => {
  cleanup()
  $attentionItemCountMock.set(0)
  vi.clearAllMocks()
})

describe('ActivityView', () => {
  it('renders exactly two tabs: activity and approvals (no upcoming or bots)', () => {
    render(<ActivityView onClose={vi.fn()} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)

    expect(screen.getByRole('tab', { name: /Activity/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Approvals/i })).toBeDefined()
    expect(screen.queryByRole('tab', { name: /Upcoming/i })).toBeNull()
    expect(screen.queryByRole('tab', { name: /Bots/i })).toBeNull()
  })

  it('defaults to the Activity tab and switches to Approvals', () => {
    render(<ActivityView onClose={vi.fn()} />)

    expect(screen.getByTestId('activity-tab-content')).toBeDefined()
    expect(screen.queryByTestId('approvals-tab-content')).toBeNull()

    const approvalsTab = screen.getByRole('tab', { name: /Approvals/i })
    fireEvent.click(approvalsTab)

    expect(screen.getByTestId('approvals-tab-content')).toBeDefined()
    expect(screen.queryByTestId('activity-tab-content')).toBeNull()
  })

  it('renders badge for approvals when attention items are pending', () => {
    $attentionItemCountMock.set(3)
    render(<ActivityView onClose={vi.fn()} />)

    const approvalsTab = screen.getByRole('tab', { name: /Approvals/i })
    expect(approvalsTab.textContent).toContain('3')
  })

  it('invokes onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<ActivityView onClose={onClose} />)

    const closeButton = screen.getByRole('button', { name: /close/i })
    fireEvent.click(closeButton)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
