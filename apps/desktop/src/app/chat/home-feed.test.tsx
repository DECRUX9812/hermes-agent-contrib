import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readKey } from '@/lib/storage'
import type * as AttentionInboxModule from '@/store/attention-inbox'
import { $gateway } from '@/store/gateway'
import {
  $dismissedHomeFeedItemIds,
  HOME_FEED_DISMISSED_KEY,
  resetDismissedHomeFeedItems
} from '@/store/home-feed'
import type * as PromptsModule from '@/store/prompts'
import { $approvalQueues, answerApproval } from '@/store/prompts'

import { HomeFeed, HomeFeedCard } from './home-feed'

// Mock answerApproval
vi.mock('@/store/prompts', async importOriginal => {
  const actual = await importOriginal<typeof PromptsModule>()

  return {
    ...actual,
    answerApproval: vi.fn(async () => {})
  }
})

// Mock triggerAndRefreshCronJobs
vi.mock('@/app/cron/cron-actions', () => ({
  triggerAndRefreshCronJobs: vi.fn(async () => ({ renewed: true }))
}))

// Mock openSession
vi.mock('@/app/open-session', () => ({
  openSession: vi.fn()
}))

// Mock attention reveal
vi.mock('@/store/attention-inbox', async importOriginal => {
  const actual = await importOriginal<typeof AttentionInboxModule>()

  return {
    ...actual,
    requestAttentionReveal: vi.fn()
  }
})

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('HomeFeed component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDismissedHomeFeedItems()
    $approvalQueues.set({})
  })

  afterEach(() => {
    cleanup()
    resetDismissedHomeFeedItems()
    $approvalQueues.set({})
  })

  it('renders nothing when items list is empty', () => {
    const { container } = renderWithRouter(<HomeFeed items={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('never offers Approve when the card matches no queued request', () => {
    $approvalQueues.set({
      'session-1': [{ command: 'other', description: '', requestId: 'req-other', sessionId: 'session-1' }]
    } as never)
    renderWithRouter(
      <HomeFeed
        items={[{ id: 'approval:session-1:req-1', kind: 'approval', sessionId: 'session-1', title: 'Bash execution' }]}
      />
    )

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
  })

  it('renders cards with title, caption, and actions', () => {
    $approvalQueues.set({
      'session-1': [{ command: 'rm -rf /tmp/cache', description: '', requestId: 'req-1', sessionId: 'session-1' }]
    } as never)
    renderWithRouter(
      <HomeFeed
        items={[
          {
            caption: 'rm -rf /tmp/cache',
            id: 'approval:session-1:req-1',
            kind: 'approval',
            sessionId: 'session-1',
            title: 'Bash execution'
          },
          {
            caption: 'Every 15m',
            cronJobId: 'job-1',
            id: 'cron:job-1',
            kind: 'cronOverdue',
            title: 'Overdue Sync'
          }
        ]}
      />
    )

    expect(screen.getByText('Bash execution')).toBeTruthy()
    expect(screen.getByText('rm -rf /tmp/cache')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()

    expect(screen.getByText('Overdue Sync')).toBeTruthy()
    expect(screen.getByText('Every 15m')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy()
  })

  it('approve button calls answerApproval path with choice once', async () => {
    $approvalQueues.set({
      'session-1': [
        {
          command: 'npm test',
          description: 'Run test suite',
          requestId: 'req-1',
          serverRequestId: 'srv-1',
          sessionId: 'session-1'
        }
      ]
    })

    renderWithRouter(
      <HomeFeed
        items={[
          {
            id: 'approval:session-1:req-1',
            kind: 'approval',
            sessionId: 'session-1',
            title: 'Approve command'
          }
        ]}
      />
    )

    const approveBtn = screen.getByRole('button', { name: 'Approve' })
    fireEvent.click(approveBtn)

    expect(answerApproval).toHaveBeenCalledTimes(1)
    expect(answerApproval).toHaveBeenCalledWith(
      $gateway.get(),
      expect.objectContaining({
        requestId: 'req-1',
        sessionId: 'session-1'
      }),
      'once'
    )
  })

  it('deny button calls answerApproval path with choice deny', async () => {
    $approvalQueues.set({
      'session-1': [
        {
          command: 'dangerous-cmd',
          description: 'Dangerous action',
          requestId: 'req-99',
          serverRequestId: 'srv-99',
          sessionId: 'session-1'
        }
      ]
    })

    renderWithRouter(
      <HomeFeed
        items={[
          {
            id: 'approval:session-1:req-99',
            kind: 'approval',
            sessionId: 'session-1',
            title: 'Dangerous command'
          }
        ]}
      />
    )

    const denyBtn = screen.getByRole('button', { name: 'Deny' })
    fireEvent.click(denyBtn)

    expect(answerApproval).toHaveBeenCalledTimes(1)
    expect(answerApproval).toHaveBeenCalledWith(
      $gateway.get(),
      expect.objectContaining({
        requestId: 'req-99',
        sessionId: 'session-1'
      }),
      'deny'
    )
  })

  it('dismiss button persists dismissed item id', () => {
    const item = {
      id: 'approval:session-1:req-test',
      kind: 'approval' as const,
      sessionId: 'session-1',
      title: 'Approve bash'
    }

    renderWithRouter(<HomeFeed items={[item]} />)

    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' })
    fireEvent.click(dismissBtn)

    expect($dismissedHomeFeedItemIds.get()).toContain('approval:session-1:req-test')
    const persisted = readKey(HOME_FEED_DISMISSED_KEY)
    expect(persisted).toBeTruthy()
    expect(JSON.parse(persisted!)).toContain('approval:session-1:req-test')
  })

  it('one-tap Open button triggers attention reveal and openSession', async () => {
    const { requestAttentionReveal } = await import('@/store/attention-inbox')
    const { openSession } = await import('@/app/open-session')

    renderWithRouter(
      <HomeFeedCard
        item={{
          caption: 'Need input',
          id: 'clarify:session-1:req-clarify',
          kind: 'clarify',
          sessionId: 'session-1',
          title: 'Which environment?'
        }}
        onDismiss={vi.fn()}
      />
    )

    const openBtn = screen.getByRole('button', { name: 'Open' })
    fireEvent.click(openBtn)

    expect(requestAttentionReveal).toHaveBeenCalledWith('session-1')
    expect(openSession).toHaveBeenCalledWith('session-1', expect.any(Function), 'stack')
  })

  it('cron Run now button triggers triggerAndRefreshCronJobs', async () => {
    const { triggerAndRefreshCronJobs } = await import('@/app/cron/cron-actions')

    renderWithRouter(
      <HomeFeedCard
        item={{
          cronJobId: 'cron-hourly',
          id: 'cron:cron-hourly',
          kind: 'cronDue',
          title: 'Hourly report'
        }}
        onDismiss={vi.fn()}
      />
    )

    const runBtn = screen.getByRole('button', { name: 'Run now' })
    fireEvent.click(runBtn)

    expect(triggerAndRefreshCronJobs).toHaveBeenCalledWith('cron-hourly', 'all')
  })
})
