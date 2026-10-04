import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { SessionPeek } from './session-peek'

afterEach(cleanup)
afterEach(() => {
  vi.useRealTimers()
})

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      sidebar: {
        messageCount: (count: number) => `${count} messages`,
        toolCallCount: (count: number) => `${count} tool calls`,
        peek: {
          agents: 'Delegated agents',
          agentsRunning: (count: number) => `${count} running`,
          agentsSummary: (count: number) => `${count} agents`,
          archived: 'Archived',
          branch: 'Branch',
          idle: 'Idle',
          model: 'Model',
          profile: 'Profile',
          source: 'Source',
          started: 'Started',
          stats: 'Stats',
          tokens: (count: string) => `${count} tokens`,
          updated: 'Updated',
          workspace: 'Workspace'
        },
        row: {
          backgroundRunning: 'Running in background',
          draftSession: 'Draft',
          finishedUnread: 'Finished',
          needsInput: 'Needs input',
          sessionRunning: 'Running',
          waitingForAnswer: 'Waiting for answer'
        }
      },
      assistant: {
        thread: {
          today: (time: string) => `Today at ${time}`,
          yesterday: (time: string) => `Yesterday at ${time}`
        }
      }
    }
  })
}))

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    ended_at: null,
    id: 's1',
    input_tokens: 1200,
    is_active: false,
    last_active: 1_700_000_000,
    message_count: 24,
    model: 'anthropic/claude-sonnet-4',
    output_tokens: 800,
    preview: 'first user message preview',
    source: 'desktop',
    started_at: 1_700_000_000,
    title: 'Refactor the thing',
    tool_call_count: 12,
    ...overrides
  } as SessionInfo
}

function renderPeek(session: SessionInfo) {
  return render(
    <SessionPeek session={session}>
      <button type="button">row</button>
    </SessionPeek>
  )
}

describe('SessionPeek', () => {
  it('opens on a deliberate dwell and shows the session context', () => {
    vi.useFakeTimers()
    renderPeek(makeSession({ cwd: '/dev/my-project', git_branch: 'feature/x' }))

    const trigger = screen.getByRole('button', { name: 'row' })

    act(() => {
      fireEvent.pointerEnter(trigger)
      vi.advanceTimersByTime(800)
    })

    expect(screen.getByText('Refactor the thing')).toBeTruthy()
    expect(screen.getByText('first user message preview')).toBeTruthy()
    expect(screen.getByText('feature/x')).toBeTruthy()
    // Stats line composes counts, tokens and cost the row already knows.
    expect(screen.getByText(/24 messages · 12 tool calls/)).toBeTruthy()
  })

  it('does not open on a passing hover shorter than the dwell delay', () => {
    vi.useFakeTimers()
    renderPeek(makeSession())

    const trigger = screen.getByRole('button', { name: 'row' })

    act(() => {
      fireEvent.pointerEnter(trigger)
      vi.advanceTimersByTime(500)
    })

    expect(screen.queryByText('Refactor the thing')).toBeNull()

    act(() => {
      fireEvent.pointerLeave(trigger)
      vi.advanceTimersByTime(500)
    })

    expect(screen.queryByText('Refactor the thing')).toBeNull()
  })
})
