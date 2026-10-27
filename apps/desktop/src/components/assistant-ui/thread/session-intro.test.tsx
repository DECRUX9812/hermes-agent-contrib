import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
import { $introSplash } from '@/store/intro-splash'

/**
 * An existing session with no messages shows the starter intro under the
 * plugin empty slot, but only once the session has loaded, under the
 * Appearance toggle, in the primary view, and never in Bot Chat.
 */
let viewKind = 'primary'

vi.mock('@/app/chat/session-view', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSessionView: () => ({ kind: viewKind })
}))

vi.mock('@/components/assistant-ui/thread/list', () => ({
  ThreadMessageList: ({ emptyPlaceholder }: { emptyPlaceholder?: ReactNode }) => <>{emptyPlaceholder}</>
}))

vi.mock('@/components/assistant-ui/thread/timeline', () => ({ ThreadTimeline: () => null }))

vi.mock('@/components/assistant-ui/thread/status', () => ({
  BackgroundResumeNotice: () => null,
  CenteredThreadSpinner: () => null
}))

vi.mock('@/components/assistant-ui/chat-empty-slot', () => ({ ChatEmptySlot: () => <div data-testid="empty-slot" /> }))

vi.mock('@/components/chat/intro', () => ({ Intro: () => <div data-testid="intro" /> }))

vi.mock('@/i18n', () => ({
  translateNow: (key: string) => key,
  useI18n: () => ({
    t: {
      assistant: { thread: { restoreBody: 'b', restoreConfirm: 'Restore', restoreTitle: 't' } },
      common: { cancel: 'Cancel', confirm: 'Confirm', done: 'Done', loading: 'Loading' }
    }
  })
}))

import { Thread } from './index'

afterEach(() => {
  viewKind = 'primary'
  $introSplash.set(true)
  $workspaceMode.set('sessions')
})

describe('Thread intro on an empty existing session', () => {
  it('shows the intro once the session has loaded', () => {
    render(<Thread sessionId="s1" />)
    expect(screen.getByTestId('empty-slot')).toBeTruthy()
    expect(screen.queryByTestId('intro')).toBeTruthy()
  })

  it('holds the intro back while the session is still hydrating', () => {
    render(<Thread loading="session" sessionId="s1" />)
    expect(screen.queryByTestId('intro')).toBeNull()
  })

  it('respects the intro splash setting', () => {
    $introSplash.set(false)
    render(<Thread sessionId="s1" />)
    expect(screen.queryByTestId('intro')).toBeNull()
  })

  it('leaves Bot Chat and tiles to their own empty state', () => {
    $workspaceMode.set('bots')
    const { unmount } = render(<Thread sessionId="s1" />)
    expect(screen.queryByTestId('intro')).toBeNull()
    unmount()
    $workspaceMode.set('sessions')
    viewKind = 'tile'
    render(<Thread sessionId="s1" />)
    expect(screen.queryByTestId('intro')).toBeNull()
  })
})
