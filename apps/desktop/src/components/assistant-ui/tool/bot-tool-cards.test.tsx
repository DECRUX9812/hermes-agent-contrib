import { type ThreadMessage } from '@assistant-ui/react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '@/components/assistant-ui/test-utils'
import { Thread } from '@/components/assistant-ui/thread'
import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import { $botChatSessionIds, $sessionTiles, setSessionTileWorkspaceScope } from '@/store/session-states'
import { setShowToolActivityFromConfig } from '@/store/tool-activity'

stubThreadEnvironment()
stubThreadViewportSize()

const SID = 'sess-1'
const STORED = 'stored-1'
const createdAt = new Date('2026-06-03T00:00:00.000Z')

function toolMessage(): ThreadMessage {
  return {
    id: 'assistant-tools',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-1',
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
        argsText: JSON.stringify({ query: 'toolRuns' }),
        result: { matches: [] }
      },
      {
        type: 'text',
        text: 'all done'
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

function Harness({ message }: { message: ThreadMessage }) {
  return (
    <ThreadRuntime messages={[message]}>
      <Thread />
    </ThreadRuntime>
  )
}

function markBotChat() {
  $sessionTiles.set([{ runtimeId: SID, storedSessionId: STORED } as never])
  setSessionTileWorkspaceScope(STORED, { workspaceMode: 'bots', workspaceOwnerKey: 'bot:alpha' })
}

beforeEach(() => {
  clearAllPrompts()
  $activeSessionId.set(SID)
  setShowToolActivityFromConfig('off')
})

afterEach(() => {
  cleanup()
  clearAllPrompts()
  $activeSessionId.set(null)
  setShowToolActivityFromConfig(undefined)
  $sessionTiles.set([])
  setSessionTileWorkspaceScope(STORED, { workspaceMode: 'sessions', workspaceOwnerKey: '' })
  $botChatSessionIds.set(new Set())
})

describe('bot-tool-cards', () => {
  it('renders a single tool call in Bot Chat as a card', async () => {
    markBotChat()

    const message: ThreadMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'read-1',
          toolName: 'read_file',
          args: { path: '/repo/src/status.tsx' },
          argsText: JSON.stringify({ path: '/repo/src/status.tsx' }),
          result: { content: 'export const Status = () => null' }
        },
        {
          type: 'text',
          text: 'Finished reading.'
        }
      ],
      status: { type: 'complete', reason: 'stop' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as unknown as ThreadMessage

    const { container } = render(<Harness message={message} />)

    expect(await screen.findByText('Finished reading.')).toBeTruthy()
    expect(container.querySelector('[data-slot="tool-activity-stack"]')).toBeTruthy()
    expect(container.querySelector('[data-tool-card="done"]')).toBeTruthy()
    expect(screen.getByText('Read status.tsx')).toBeTruthy()
  })

  it('groups a run of reads and searches into cards by kind', async () => {
    markBotChat()

    const message: ThreadMessage = {
      id: 'msg-run',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'read-1',
          toolName: 'read_file',
          args: { path: '/repo/src/a.ts' },
          argsText: JSON.stringify({ path: '/repo/src/a.ts' }),
          result: { content: 'a' }
        },
        {
          type: 'tool-call',
          toolCallId: 'read-2',
          toolName: 'read_file',
          args: { path: '/repo/src/b.ts' },
          argsText: JSON.stringify({ path: '/repo/src/b.ts' }),
          result: { content: 'b' }
        },
        {
          type: 'tool-call',
          toolCallId: 'search-1',
          toolName: 'search_files',
          args: { query: 'test' },
          argsText: JSON.stringify({ query: 'test' }),
          result: { matches: [] }
        },
        {
          type: 'text',
          text: 'Run completed.'
        }
      ],
      status: { type: 'complete', reason: 'stop' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as unknown as ThreadMessage

    const { container } = render(<Harness message={message} />)

    expect(await screen.findByText('Run completed.')).toBeTruthy()
    const cards = container.querySelectorAll('[data-tool-card="done"]')
    expect(cards.length).toBe(2)
    expect(screen.getByText(/Files ×2/)).toBeTruthy()
  })

  it('leaves non-bot sessions to render through ToolRun or answer-only passthrough', async () => {
    const { container, rerender } = render(<Harness message={toolMessage()} />)

    expect(await screen.findByText('all done')).toBeTruthy()
    expect(container.querySelector('[data-slot="tool-activity-stack"]')).toBeNull()
    expect(container.querySelector('[data-slot="bot-activity-pill"]')).toBeNull()
    expect(container.querySelector('[data-tool-row]')).toBeNull()

    await act(async () => {
      setShowToolActivityFromConfig('on')
    })

    rerender(<Harness message={toolMessage()} />)

    await waitFor(() => {
      expect(container.querySelector('[data-tool-summary]')).not.toBeNull()
    })

    expect(container.querySelector('[data-slot="tool-activity-stack"]')).toBeNull()
  })

  it('still renders card tools such as file diffs as their own components', async () => {
    markBotChat()

    const diff = '--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1,2 @@\n-beforeEdit\n+afterEdit'

    const message: ThreadMessage = {
      id: 'msg-diff',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'edit-1',
          toolName: 'edit_file',
          args: { path: '/repo/demo.ts', content: 'afterEdit' },
          argsText: '{}',
          result: { success: true, path: '/repo/demo.ts', inline_diff: diff }
        },
        {
          type: 'text',
          text: 'Edited demo.ts'
        }
      ],
      status: { type: 'complete', reason: 'stop' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as unknown as ThreadMessage

    const { container } = render(<Harness message={message} />)

    expect(await screen.findByText('Edited demo.ts')).toBeTruthy()
    expect(container.querySelector('[data-tool-row][data-file-edit]')).toBeTruthy()
  })

  it('still renders inter-agent delivery notices', async () => {
    markBotChat()

    const message: ThreadMessage = {
      id: 'msg-delivery',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'delivery-1',
          toolName: 'terminal',
          args: { command: 'hermes -p alpha chat -q "Message from bot: please review"' },
          argsText: '{}',
          result: { exit_code: 0, output: 'Delivered' }
        },
        {
          type: 'text',
          text: 'Dispatched delivery.'
        }
      ],
      status: { type: 'complete', reason: 'stop' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as unknown as ThreadMessage

    const { container } = render(<Harness message={message} />)

    expect(await screen.findByText('Dispatched delivery.')).toBeTruthy()
    expect(container.querySelector('[data-slot="aui_agent-delivery-notice"]')).toBeTruthy()
    expect(screen.getByText(/Messaged alpha/)).toBeTruthy()
  })

  it('scrolls to the session approval element when Review Approval is clicked', async () => {
    markBotChat()

    const anchor = document.createElement('div')
    anchor.setAttribute('data-approval-stack', '')
    anchor.setAttribute('data-session-id', SID)
    anchor.scrollIntoView = vi.fn()
    document.body.appendChild(anchor)

    setApprovalRequest({
      command: 'rm -rf /tmp/test',
      description: 'delete files',
      sessionId: SID
    })

    const message: ThreadMessage = {
      id: 'msg-approval',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'term-approval',
          toolName: 'terminal',
          args: { command: 'rm -rf /tmp/test' },
          argsText: '{}'
        }
      ],
      status: { type: 'running' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as unknown as ThreadMessage

    render(<Harness message={message} />)

    const reviewButton = await screen.findByRole('button', { name: 'Review' })
    expect(reviewButton).toBeTruthy()

    fireEvent.click(reviewButton)

    expect(anchor.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    anchor.remove()
  })

  it('does not re-render the card stack when text streams after the run settles', async () => {
    markBotChat()

    const initialMessage: ThreadMessage = {
      id: 'msg-stream',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'read-1',
          toolName: 'read_file',
          args: { path: '/repo/src/status.tsx' },
          argsText: JSON.stringify({ path: '/repo/src/status.tsx' }),
          result: { content: 'export const Status = () => null' }
        },
        {
          type: 'text',
          text: 'Thinking'
        }
      ],
      status: { type: 'running' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as unknown as ThreadMessage

    const { container, rerender } = render(<Harness message={initialMessage} />)

    expect(await screen.findByText('Thinking')).toBeTruthy()
    const cardStackBefore = container.querySelector('[data-slot="tool-activity-stack"]')
    expect(cardStackBefore).not.toBeNull()

    const streamedMessage: ThreadMessage = {
      ...initialMessage,
      content: [
        initialMessage.content[0],
        {
          type: 'text',
          text: 'Thinking about the next steps and continuing to stream...'
        }
      ]
    } as unknown as ThreadMessage

    rerender(<Harness message={streamedMessage} />)

    expect(await screen.findByText('Thinking about the next steps and continuing to stream...')).toBeTruthy()
    const cardStackAfter = container.querySelector('[data-slot="tool-activity-stack"]')
    expect(cardStackAfter).toBe(cardStackBefore)
  })

  it('shows the failure reason on an error card without a duplicate tool row', async () => {
    markBotChat()

    const message: ThreadMessage = {
      id: 'msg-error',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'term-1',
          toolName: 'terminal',
          args: { command: 'npm run build' },
          argsText: JSON.stringify({ command: 'npm run build' }),
          isError: true,
          result: { error: 'disk full, act now\nstack trace' }
        },
        { type: 'text', text: 'Write failed.' }
      ],
      status: { type: 'complete', reason: 'stop' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as unknown as ThreadMessage

    const { container } = render(<Harness message={message} />)

    expect(await screen.findByText('Write failed.')).toBeTruthy()
    expect(container.querySelector('[data-tool-card="error"]')).toBeTruthy()
    expect(screen.getAllByText('disk full, act now').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-tool-row]')).toBeNull()
  })

  it('draws cards whatever the tool progress setting is', async () => {
    markBotChat()
    setShowToolActivityFromConfig('all')

    const { container } = render(<Harness message={toolMessage()} />)

    expect(await screen.findByText('all done')).toBeTruthy()
    expect(container.querySelector('[data-slot="tool-activity-stack"]')).toBeTruthy()
    expect(container.querySelector('[data-tool-row]')).toBeNull()
  })

  it('shows typing dots on a running call', async () => {
    markBotChat()

    const message: ThreadMessage = {
      id: 'msg-running',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'read-running',
          toolName: 'read_file',
          args: { path: '/repo/src/status.tsx' },
          argsText: JSON.stringify({ path: '/repo/src/status.tsx' })
        }
      ],
      status: { type: 'running' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as unknown as ThreadMessage

    const { container } = render(<Harness message={message} />)

    await waitFor(() => expect(container.querySelector('[data-tool-card="running"] [data-typing]')).toBeTruthy())
  })
})
