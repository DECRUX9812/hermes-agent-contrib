import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readKey } from '@/lib/storage'
import type * as AttentionInboxModule from '@/store/attention-inbox'
import {
  $dismissedHomeFeedItemIds,
  HOME_FEED_DISMISSED_KEY,
  resetDismissedHomeFeedItems
} from '@/store/home-feed'

import { HomeFeed, HomeFeedCard } from './home-feed'

// Mock triggerAndRefreshCronJobs
vi.mock('@/app/cron/cron-actions', () => ({
  triggerAndRefreshCronJobs: vi.fn(async () => ({ renewed: true }))
}))

// Mock openSession
vi.mock('@/app/open-session', () => ({
  openSession: vi.fn()
}))

// Mock openExternalLink
vi.mock('@/lib/external-link', () => ({
  openExternalLink: vi.fn()
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
  })

  afterEach(() => {
    cleanup()
    resetDismissedHomeFeedItems()
  })

  it('renders nothing when items list is empty', () => {
    const { container } = renderWithRouter(<HomeFeed items={[]} />)

    expect(container.firstChild).toBeNull()
  })

  it('routes approval items to the session instead of offering a second decision UI', () => {
    renderWithRouter(
      <HomeFeed
        items={[{ id: 'approval:session-1:req-1', kind: 'approval', sessionId: 'session-1', title: 'Bash execution' }]}
      />
    )

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
  })

  it('renders cards with title, caption, and actions', () => {
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
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()

    expect(screen.getByText('Overdue Sync')).toBeTruthy()
    expect(screen.getByText('Every 15m')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run now' })).toBeTruthy()
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

  it('prReview Open button calls openExternalLink', async () => {
    const { openExternalLink } = await import('@/lib/external-link')

    renderWithRouter(
      <HomeFeedCard
        item={{
          caption: 'feat/feed · Checks passing',
          id: 'pr:42',
          kind: 'prReview',
          prUrl: 'https://github.com/org/repo/pull/42',
          title: 'PR #42: Calm feed'
        }}
        onDismiss={vi.fn()}
      />
    )

    const openBtn = screen.getByRole('button', { name: 'Open' })
    fireEvent.click(openBtn)

    expect(openExternalLink).toHaveBeenCalledWith('https://github.com/org/repo/pull/42')
  })

  it('keyboard number 1..5 triggers the primary action of the corresponding card', async () => {
    const { openExternalLink } = await import('@/lib/external-link')

    renderWithRouter(
      <HomeFeed
        items={[
          {
            caption: 'feat/feed',
            id: 'pr:101',
            kind: 'prReview',
            prUrl: 'https://github.com/org/repo/pull/101',
            title: 'PR #101'
          }
        ]}
      />
    )

    // Press '1'
    fireEvent.keyDown(window, { key: '1' })

    expect(openExternalLink).toHaveBeenCalledWith('https://github.com/org/repo/pull/101')
  })
})
