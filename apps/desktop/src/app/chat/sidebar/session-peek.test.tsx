import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionInfo } from '@/hermes'
import type { ChatMessage } from '@/lib/chat-messages/types'
import { createClientSessionState } from '@/lib/chat-runtime'
import type * as NativeNotifications from '@/store/native-notifications'
import { respondToApprovalAction } from '@/store/native-notifications'
import { setApprovalRequest } from '@/store/prompts'
import { setSessions } from '@/store/session'
import { clearAllSessionStates, publishSessionState } from '@/store/session-states'
import { openSessionTile } from '@/store/session-states-tiles'
import type * as SessionStatesTiles from '@/store/session-states-tiles'
import type * as TilesCore from '@/store/session-states-tiles-core'
import { setSessionTileDelegate } from '@/store/session-states-tiles-core'
import { $todosBySession } from '@/store/todos'

import { SessionPeek } from './session-peek'

const { interruptSessionMock, respondToApprovalMock } = vi.hoisted(() => ({
  interruptSessionMock: vi.fn(),
  respondToApprovalMock: vi.fn()
}))

vi.mock('@/store/session-states-tiles', async importOriginal => {
  const actual = await importOriginal<typeof SessionStatesTiles>()

  return {
    ...actual,
    openSessionTile: vi.fn()
  }
})

vi.mock('@/store/native-notifications', async importOriginal => {
  const actual = await importOriginal<typeof NativeNotifications>()

  return {
    ...actual,
    respondToApprovalAction: respondToApprovalMock
  }
})

afterEach(cleanup)
afterEach(() => {
  vi.useRealTimers()
  clearAllSessionStates()
  setSessions([])
  $todosBySession.set({})
  // No wiring mounted: the Stop button has nothing to call.
  setSessionTileDelegate({ interruptSession: vi.fn() } as unknown as TilesCore.SessionTileDelegate)
  vi.clearAllMocks()
})

vi.mock('@/i18n', () => ({
  translateNow: (key: string, ...args: unknown[]) => [key, ...args.map(String)].join(' '),
  useI18n: () => ({
    t: {
      common: {
        approve: 'Approve',
        open: 'Open'
      },
      composer: {
        stop: 'Stop'
      },
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
          lastTool: 'Last tool',
          model: 'Model',
          more: (count: number) => `+${count} more`,
          planFraction: (done: number, total: number) => `${done} of ${total}`,
          profile: 'Profile',
          source: 'Source',
          started: 'Started',
          stats: 'Stats',
          stopFailed: 'Could not stop the session',
          tokens: (count: string) => `${count} tokens`,
          updated: 'Updated',
          workspace: 'Workspace'
        },
        row: {
          backgroundRunning: 'Running in background',
          draftSession: 'Draft',
          finishedUnread: 'Finished',
          needsInput: 'Needs input',
          openInSplit: 'Open in split',
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

function toolMessage(id: string, name: string, args: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-call',
        toolCallId: `call-${id}`,
        toolName: name,
        args: JSON.parse(args),
        argsText: args,
        timestamp: 100
      }
    ] as ChatMessage['parts']
  }
}

function renderPeek(session: SessionInfo, onOpen?: () => void) {
  return render(
    <SessionPeek onOpen={onOpen} session={session}>
      <button type="button">row</button>
    </SessionPeek>
  )
}

function openPeek() {
  const trigger = screen.getByRole('button', { name: 'row' })

  act(() => {
    fireEvent.pointerEnter(trigger)
    vi.advanceTimersByTime(450)
  })
}

describe('SessionPeek', () => {
  it('opens on a deliberate dwell and shows the session context', () => {
    vi.useFakeTimers()
    renderPeek(makeSession({ cwd: '/dev/my-project', git_branch: 'feature/x' }))
    openPeek()

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
      vi.advanceTimersByTime(400)
    })

    expect(screen.queryByText('Refactor the thing')).toBeNull()

    act(() => {
      fireEvent.pointerLeave(trigger)
      vi.advanceTimersByTime(500)
    })

    expect(screen.queryByText('Refactor the thing')).toBeNull()
  })

  it('shows the working body with step, checklist, last tool and a Stop that interrupts the runtime', async () => {
    vi.useFakeTimers()
    interruptSessionMock.mockResolvedValue(undefined)
    setSessionTileDelegate({ interruptSession: interruptSessionMock } as unknown as TilesCore.SessionTileDelegate)
    publishSessionState('rt-1', {
      ...createClientSessionState('stored-1', [toolMessage('m', 'terminal', '{"command":"npm test"}')]),
      busy: true,
      turnStartedAt: Date.now() - 65_000
    })
    $todosBySession.set({
      'rt-1': [
        { content: 'Find the flaky test', id: '1', status: 'completed' },
        { content: 'Fix it', id: '2', status: 'in_progress' },
        { content: 'Dropped', id: '3', status: 'cancelled' },
        { content: 'Open a PR', id: '4', status: 'pending' }
      ]
    })
    renderPeek(makeSession({ id: 'stored-1' }))
    openPeek()

    expect(screen.getAllByText('Fix it').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Find the flaky test')).toBeTruthy()
    expect(screen.getByText('Open a PR')).toBeTruthy()
    expect(screen.queryByText('Dropped')).toBeNull()
    expect(screen.getByText('1 of 3')).toBeTruthy()
    expect(screen.getByText('Last tool')).toBeTruthy()
    expect(screen.getByText('terminal · npm test')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    // The delegate call happens synchronously in the click handler (before
    // its first await); flushing microtasks settles the pending state.
    await act(async () => {})
    expect(interruptSessionMock).toHaveBeenCalledWith('rt-1')
  })

  it('shows Approve for a needs-you session with a pending approval and approves its runtime', () => {
    vi.useFakeTimers()
    publishSessionState('rt-2', { ...createClientSessionState('stored-2'), busy: true, needsInput: true })
    setApprovalRequest({ command: 'rm -rf /tmp/x', description: 'Delete the scratch dir', sessionId: 'rt-2' })
    renderPeek(makeSession({ id: 'stored-2' }))
    openPeek()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(respondToApprovalMock).toHaveBeenCalledWith('rt-2', 'approve')
    expect(respondToApprovalAction).toBe(respondToApprovalMock)
  })

  it('wires Open and Open in split to the row handlers', () => {
    vi.useFakeTimers()
    const onOpen = vi.fn()
    renderPeek(makeSession(), onOpen)
    openPeek()

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onOpen).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open in split' }))
    expect(openSessionTile).toHaveBeenCalledWith('s1', 'right')
  })
})
