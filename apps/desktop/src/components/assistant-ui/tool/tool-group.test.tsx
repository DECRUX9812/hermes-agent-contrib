import { type ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, assert, beforeEach, describe, expect, it } from 'vitest'

import { ApprovalComposerEntry } from '@/components/assistant-ui/tool/approval'
import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import { setShowToolActivityFromConfig } from '@/store/tool-activity'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '../test-utils'
import { Thread } from '../thread'

const createdAt = new Date('2026-06-03T00:00:00.000Z')

stubThreadEnvironment()
stubThreadViewportSize()

// A running assistant message with two tools: a completed read_file plus a
// pending terminal (no result), rendered as a flat two-row list.
function groupedPendingMessage(): ThreadMessage {
  return {
    id: 'assistant-group-1',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-1',
        toolName: 'read_file',
        args: { path: '/etc/hosts' },
        argsText: JSON.stringify({ path: '/etc/hosts' }),
        result: { content: '127.0.0.1 localhost' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-1',
        toolName: 'terminal',
        args: { command: 'rm -rf /tmp/x' },
        argsText: JSON.stringify({ command: 'rm -rf /tmp/x' })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

function pendingOnlyMessage(): ThreadMessage {
  return {
    id: 'assistant-pending-only',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'term-only',
        toolName: 'terminal',
        args: { command: 'sleep 10' },
        argsText: JSON.stringify({ command: 'sleep 10' })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

function completedOnlyMessage(): ThreadMessage {
  return {
    id: 'assistant-completed-only',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-only',
        toolName: 'read_file',
        args: { path: '/etc/hosts' },
        argsText: JSON.stringify({ path: '/etc/hosts' }),
        timestamp: createdAt.getTime() / 1000 + 10.125,
        completedAt: createdAt.getTime() / 1000 + 12.875,
        result: { content: '127.0.0.1 localhost' }
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// Two settled activity calls in a row, so the run earns a summary line and
// collapses behind it.
function settledRunMessage(): ThreadMessage {
  return {
    id: 'assistant-settled-run',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-2',
        toolName: 'read_file',
        args: { path: '/repo/src/wiring.tsx' },
        argsText: JSON.stringify({ path: '/repo/src/wiring.tsx' }),
        timestamp: createdAt.getTime() / 1000 + 20,
        completedAt: createdAt.getTime() / 1000 + 21,
        result: { content: 'export const Wiring = () => null' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-3',
        toolName: 'terminal',
        args: { command: 'ls -la' },
        argsText: JSON.stringify({ command: 'ls -la' }),
        timestamp: createdAt.getTime() / 1000 + 22,
        completedAt: createdAt.getTime() / 1000 + 23.5,
        result: { exit_code: 0, stdout: 'wiring.tsx' }
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// Activity, an edit, then more activity — all adjacent, so assistant-ui hands
// the whole stretch over as one group. The edit is the deliverable and has to
// survive that as its own card.
function editBetweenRunsMessage(): ThreadMessage {
  return {
    id: 'assistant-edit-between-runs',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-5',
        toolName: 'read_file',
        args: { path: '/repo/src/a.ts' },
        argsText: JSON.stringify({ path: '/repo/src/a.ts' }),
        result: { content: 'a' }
      },
      {
        type: 'tool-call',
        toolCallId: 'search-3',
        toolName: 'search_files',
        args: { query: 'toolRuns' },
        argsText: JSON.stringify({ query: 'toolRuns' }),
        result: { hits: [] }
      },
      {
        type: 'tool-call',
        toolCallId: 'patch-2',
        toolName: 'patch',
        args: { path: '/repo/src/wiring.tsx' },
        argsText: JSON.stringify({ path: '/repo/src/wiring.tsx' }),
        result: { path: '/repo/src/wiring.tsx', inline_diff: '--- a\n+++ b\n+added line\n-removed line' }
      },
      {
        type: 'tool-call',
        toolCallId: 'read-6',
        toolName: 'read_file',
        args: { path: '/repo/src/b.ts' },
        argsText: JSON.stringify({ path: '/repo/src/b.ts' }),
        result: { content: 'b' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-4',
        toolName: 'terminal',
        args: { command: 'ls' },
        argsText: JSON.stringify({ command: 'ls' }),
        result: { exit_code: 0 }
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// A finished turn that left a call without a result — interrupted, or the
// result landed elsewhere. The run is history and has to behave like it.
function abandonedRunMessage(): ThreadMessage {
  return {
    id: 'assistant-abandoned-run',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-3',
        toolName: 'read_file',
        args: { path: '/repo/src/status.tsx' },
        argsText: JSON.stringify({ path: '/repo/src/status.tsx' }),
        result: { content: 'export const Status = () => null' }
      },
      {
        type: 'tool-call',
        toolCallId: 'search-1',
        toolName: 'search_files',
        args: { query: 'toolRuns' },
        argsText: JSON.stringify({ query: 'toolRuns' })
      }
    ],
    status: { type: 'complete', reason: 'stop' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// The gap between one sequential call finishing and the next arriving: the
// turn is still running, the run is still the tail, but for this instant every
// call has a result.
function betweenSequentialCallsMessage(): ThreadMessage {
  return {
    id: 'assistant-between-calls',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'term-a',
        toolName: 'terminal',
        args: { command: 'sleep 2; echo alpha' },
        argsText: JSON.stringify({ command: 'sleep 2; echo alpha' }),
        result: { exit_code: 0, stdout: 'alpha' }
      },
      {
        type: 'tool-call',
        toolCallId: 'term-b',
        toolName: 'terminal',
        args: { command: 'sleep 2; echo bravo' },
        argsText: JSON.stringify({ command: 'sleep 2; echo bravo' }),
        result: { exit_code: 0, stdout: 'bravo' }
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

// Still streaming, but the agent has moved past its first run and left both of
// its calls unresolved. Only the run at the tail is still live.
function movedOnMessage(): ThreadMessage {
  return {
    id: 'assistant-moved-on',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-4',
        toolName: 'read_file',
        args: { path: '/repo/src/status.tsx' },
        argsText: JSON.stringify({ path: '/repo/src/status.tsx' })
      },
      {
        type: 'tool-call',
        toolCallId: 'search-2',
        toolName: 'search_files',
        args: { query: 'toolRuns' },
        argsText: JSON.stringify({ query: 'toolRuns' })
      },
      { type: 'text', text: 'Let me read the rest of the file.' },
      {
        type: 'tool-call',
        toolCallId: 'term-2',
        toolName: 'terminal',
        args: { command: 'ls' },
        argsText: JSON.stringify({ command: 'ls' })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as unknown as ThreadMessage
}

const GroupHarness = ({ message }: { message: ThreadMessage }) => (
  <ThreadRuntime messages={[message]}>
    <Thread />
    <ApprovalComposerEntry runtimeSessionId="sess-1" storedSessionId="sess-1" />
  </ThreadRuntime>
)

beforeEach(() => {
  clearAllPrompts()
  $activeSessionId.set('sess-1')
  setShowToolActivityFromConfig('on')
})

afterEach(() => {
  cleanup()
  clearAllPrompts()
  $activeSessionId.set(null)
  setShowToolActivityFromConfig(undefined)
})

describe('settled tool run', () => {
  it('collapses a completed run into a count and duration', async () => {
    const { container } = render(<GroupHarness message={settledRunMessage()} />)

    expect(await screen.findByRole('button', { name: 'Used 2 tools' })).toBeTruthy()
    expect(screen.getByText('2.5s')).toBeTruthy()
    expect(container.querySelectorAll('[data-tool-step]')).toHaveLength(0)
  })

  it('expands the completed run into one-line pills when clicked', async () => {
    const { container } = render(<GroupHarness message={settledRunMessage()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Used 2 tools' }))

    await waitFor(() => {
      expect(container.querySelectorAll('[data-tool-step]').length).toBe(2)
    })
  })

  it('leaves a lone tool call as a pill, with no fold summary', async () => {
    const { container } = render(<GroupHarness message={completedOnlyMessage()} />)

    await waitFor(() => {
      expect(container.querySelectorAll('[data-tool-step]').length).toBe(1)
    })
    expect(container.querySelector('[data-tool-run-anchor]')).toBeNull()
  })
})

// A diff is what the user reviews, so it is never what gets summarized away.
// It stays on screen at the point in the turn where it happened, with the
// activity either side of it collapsing around it.
describe('a file edit among ordinary activity', () => {
  it('stays visible between the two runs it interrupted', async () => {
    const { container } = render(<GroupHarness message={editBetweenRunsMessage()} />)

    expect(await screen.findAllByRole('button', { name: 'Used 2 tools' })).toHaveLength(2)
    expect(container.querySelector('[data-tool-step="done"]')).toBeTruthy()
    expect(screen.getByText('added line')).toBeTruthy()
  })
})

describe('live tool run', () => {
  it('keeps successful calls as pills until the assistant turn completes', async () => {
    const message = groupedPendingMessage()
    const { container, rerender } = render(<GroupHarness message={message} />)

    expect(container.querySelectorAll('[data-tool-step]')).toHaveLength(2)
    expect(container.querySelector('[data-tool-run-anchor]')).toBeNull()

    const next = {
      ...message,
      content: [
        ...message.content,
        {
          type: 'tool-call',
          toolCallId: 'read-next',
          toolName: 'read_file',
          args: { path: '/tmp/next' },
          argsText: '{}'
        }
      ]
    } as ThreadMessage

    rerender(<GroupHarness message={next} />)
    await waitFor(() => expect(container.querySelectorAll('[data-tool-step]')).toHaveLength(3))

    const settled = {
      ...next,
      content: next.content.map(part =>
        part.type === 'tool-call' && (part as { completedAt?: number }).completedAt === undefined
          ? { ...part, completedAt: createdAt.getTime() / 1000 + 5, result: { content: 'done' } }
          : part
      ),
      status: { type: 'complete', reason: 'stop' }
    } as ThreadMessage

    rerender(<GroupHarness message={settled} />)

    await waitFor(() => expect(container.querySelector('[data-tool-run-anchor]')).toBeTruthy())
    expect(container.querySelectorAll('[data-tool-step]')).toHaveLength(0)
  })

  it('updates the pill when identifying arguments arrive late', async () => {
    const message = groupedPendingMessage()
    const first = { ...message.content[0], toolName: 'skill_view', args: {}, result: { success: true } }

    const { rerender } = render(
      <GroupHarness message={{ ...message, content: [first, message.content[1]] } as ThreadMessage} />
    )

    expect(await screen.findByRole('button', { name: /Skills: Loaded skill/ })).toBeTruthy()
    const named = { ...first, args: { name: 'research-notes' } }
    rerender(<GroupHarness message={{ ...message, content: [named, message.content[1]] } as ThreadMessage} />)
    expect(await screen.findByRole('button', { name: /Skills: Loaded skill: research-notes/ })).toBeTruthy()
  })

  it('keeps a completed call visible during the gap before the next call', async () => {
    const { container } = render(<GroupHarness message={betweenSequentialCallsMessage()} />)

    expect(container.querySelectorAll('[data-tool-step="done"]')).toHaveLength(2)
    expect(container.querySelector('[data-tool-run-anchor]')).toBeNull()
  })
})

// A run whose calls never resolved used to read as live forever, which stranded
// it in the present tense and — because a live run withholds its toggle — left
// it permanently expanded with no way to collapse it.
describe('tool run left unresolved', () => {
  it('keeps unresolved history visible after the assistant turn settles', async () => {
    const { container } = render(<GroupHarness message={abandonedRunMessage()} />)

    expect(await screen.findByRole('button', { name: /Search: Stopped/ })).toBeTruthy()
    expect(container.querySelectorAll('[data-tool-step]')).toHaveLength(2)
    expect(container.querySelector('[data-tool-run-anchor]')).toBeNull()
  })

  it('does not fold earlier calls before the assistant turn completes', async () => {
    const { container } = render(<GroupHarness message={movedOnMessage()} />)

    expect(container.querySelectorAll('[data-tool-step]')).toHaveLength(3)
    expect(container.querySelector('[data-tool-run-anchor]')).toBeNull()
  })
})

describe('tool pills and approval surfacing', () => {
  it('keeps the approval visible in the same host when tool pills arrive', async () => {
    setApprovalRequest({ command: 'rm -rf /tmp/x', description: 'dangerous command', requestId: 'req-1', sessionId: 'sess-1' })
    const message = groupedPendingMessage()
    assert(message.role === 'assistant')

    const { container, rerender } = render(
      <GroupHarness message={{ ...message, content: [{ type: 'text', text: 'Waiting for approval.' }] }} />
    )

    const run = await screen.findByRole('button', { name: /Allow once/ })
    const host = run.closest('[data-approval-stack]')
    expect(host).not.toBeNull()
    expect(host?.getAttribute('data-slot')).toBe('composer-approval-entry')
    expect(host?.closest('[hidden], [inert], [data-tool-row], [data-tool-group]')).toBeNull()

    rerender(<GroupHarness message={message} />)

    await waitFor(() => {
      expect(container.querySelector('[data-approval-stack]')).toBe(host)
      expect(screen.getByRole('button', { name: /Allow once/ })).toBe(run)
      expect(run.closest('[hidden], [inert]')).toBeNull()
      expect(screen.getByRole('button', { name: /Deny/ })).toBeTruthy()
    })
  })

  it('renders a pending tool as a pill without a row dismissal action', async () => {
    const { container } = render(<GroupHarness message={pendingOnlyMessage()} />)

    await waitFor(() => {
      expect(container.querySelectorAll('[data-tool-step="running"]').length).toBe(1)
    })

    expect(screen.queryByLabelText('Dismiss')).toBeNull()
  })
})

describe('tool step duration', () => {
  it('shows the call duration on a settled pill', async () => {
    const { container } = render(<GroupHarness message={completedOnlyMessage()} />)

    await screen.findByRole('button', { name: /Files: Read/ })

    expect(container.querySelector('.font-mono.tabular-nums')?.textContent).toBe('2.8s')
  })
})
