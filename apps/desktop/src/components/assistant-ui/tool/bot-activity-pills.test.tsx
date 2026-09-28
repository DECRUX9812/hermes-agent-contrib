/**
 * Bot-mode G2: in a canonical Bot Chat's transcript a run of tool calls is a
 * compact collapsible pill — the summary line only, until expanded — instead
 * of the wall of chrome a regular session shows once answer-only opens it.
 * Invariants under test:
 *   1. A bot chat's quiet run renders as one pill (data-bot-activity-pill)
 *      with its summary and no tool rows; expanding the pill reveals them.
 *   2. A failure inside the run is never hidden by the collapse.
 *   3. A regular session's transcript is untouched — no pill, ever.
 */

import { type ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  stubThreadEnvironment,
  stubThreadViewportSize,
  ThreadRuntime
} from '@/components/assistant-ui/test-utils'
import { Thread } from '@/components/assistant-ui/thread'
import { clearAllPrompts } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import {
  $botChatSessionIds,
  $sessionTiles,
  setSessionTileWorkspaceScope
} from '@/store/session-states'
import { setShowToolActivityFromConfig } from '@/store/tool-activity'

stubThreadEnvironment()
stubThreadViewportSize()

const SID = 'sess-1'
const STORED = 'stored-1'
const createdAt = new Date('2026-06-03T00:00:00.000Z')

function toolMessage(failed = false): ThreadMessage {
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

function failedToolMessage(): ThreadMessage {
  const message = toolMessage() as unknown as {
    content: { type: string; isError?: boolean; result?: unknown }[]
  }

  message.content[0] = {
    ...(message.content[0] as Record<string, unknown>),
    isError: true,
    result: { error: 'disk full, act now' }
  } as never

  return message as unknown as ThreadMessage
}

function Harness({ message }: { message: ThreadMessage }) {
  return (
    <ThreadRuntime messages={[message]}>
      <Thread />
    </ThreadRuntime>
  )
}

function markBotChat() {
  // The mapping a real tile carries: runtime id → stored id, and the stored
  // id filed under the bots workspace scope — the pair isBotChatSession
  // resolves through.
  $sessionTiles.set([{ runtimeId: SID, storedSessionId: STORED } as never])
  setSessionTileWorkspaceScope(STORED, { workspaceMode: 'bots', workspaceOwnerKey: 'bot:alpha' })
}

beforeEach(() => {
  clearAllPrompts()
  $activeSessionId.set(SID)
  // The tool feed follows display.tool_progress (not show_reasoning); off is the quiet policy.
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

describe('bot-chat activity pills', () => {
  it('renders a quiet tool run as one collapsed pill that expands to its rows', async () => {
    markBotChat()

    const { container } = render(<Harness message={toolMessage()} />)

    // The run collapses to its one-line summary; the individual rows wait
    // inside the pill until it opens.
    expect(await screen.findByText(/Explored 2 files/)).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="bot-activity-pill"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-tool-row]')).toHaveLength(0)

    fireEvent.click(screen.getByText(/Explored 2 files/))

    expect(container.querySelectorAll('[data-tool-row]').length).toBeGreaterThan(0)
  })

  it('never lets the collapse hide a failed call', async () => {
    markBotChat()

    const { container } = render(<Harness message={failedToolMessage()} />)

    // The pill's own summary carries the failure and the failed call's row
    // renders — collapse may hide quiet rows, never what the user must see.
    expect(await screen.findByText(/1 tool call failed/)).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="bot-activity-pill"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-tool-row]').length).toBeGreaterThan(0)
  })

  it('leaves a regular session untouched — no pill, rows stay answer-only', async () => {
    const { container } = render(<Harness message={toolMessage()} />)

    expect(await screen.findByText('all done')).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="bot-activity-pill"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-tool-summary]')).toHaveLength(0)
  })
})
