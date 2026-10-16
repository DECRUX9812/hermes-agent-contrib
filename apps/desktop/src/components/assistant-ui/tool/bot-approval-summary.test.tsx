import { type ThreadMessage } from '@assistant-ui/react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '@/components/assistant-ui/test-utils'
import { Thread } from '@/components/assistant-ui/thread'
import { ApprovalComposerEntry } from '@/components/assistant-ui/tool/approval'
import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import { $botChatSessionIds, $sessionTiles, setSessionTileWorkspaceScope } from '@/store/session-states'
import { setShowToolActivityFromConfig } from '@/store/tool-activity'

stubThreadEnvironment()
stubThreadViewportSize()

const SID = 'sess-1'
const STORED = 'stored-1'
const createdAt = new Date('2026-06-03T00:00:00.000Z')

function runningTerminalMessage(): ThreadMessage {
  return {
    id: 'msg-terminal',
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'term-1',
        toolName: 'terminal',
        args: { command: 'npm test' },
        argsText: JSON.stringify({ command: 'npm test' })
      }
    ],
    status: { type: 'running' },
    createdAt,
    metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
  } as unknown as ThreadMessage
}

function Harness({ message }: { message: ThreadMessage }) {
  // The approval card lives above the composer, outside the transcript, so
  // the surface an approval belongs to renders both.
  return (
    <ThreadRuntime messages={[message]}>
      <Thread />
      <ApprovalComposerEntry runtimeSessionId={SID} storedSessionId={SID} />
    </ThreadRuntime>
  )
}

function markBotChat() {
  $sessionTiles.set([{ runtimeId: SID, storedSessionId: STORED } as never])
  setSessionTileWorkspaceScope(STORED, { workspaceMode: 'bots', workspaceOwnerKey: 'bot:alpha' })
}

function seedPendingApproval() {
  setApprovalRequest({ command: 'npm test', description: 'run tests', requestId: 'req-1', sessionId: SID })
}

function assistantMessageRoot(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-slot="aui_assistant-message-root"]')
}

beforeEach(() => {
  clearAllPrompts()
  $activeSessionId.set(SID)
  setShowToolActivityFromConfig('all')
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

describe('bot approval summary', () => {
  it('keeps the approval prompt actionable in a Bot Chat and drops the run summary next to it', async () => {
    markBotChat()
    seedPendingApproval()

    const { container } = render(<Harness message={runningTerminalMessage()} />)

    expect(await screen.findByRole('button', { name: /Allow once/ })).toBeTruthy()
    const stack = container.querySelector('[data-approval-stack]') as HTMLElement

    expect(within(stack).getByRole('button', { name: /Deny/ })).toBeTruthy()

    // The prompt survives the tool feed going dark.
    act(() => setShowToolActivityFromConfig('off'))

    expect(await screen.findByRole('button', { name: /Allow once/ })).toBeTruthy()
    const darkStack = container.querySelector('[data-approval-stack]') as HTMLElement

    expect(within(darkStack).getByRole('button', { name: /Deny/ })).toBeTruthy()

    // The bots pane's own tool cards are the run surface: the tool-only
    // bubble collapses next to the approval instead of doubling the run,
    // and the approval stack carries no run feed of its own.
    expect(assistantMessageRoot(container)?.getAttribute('data-approval-activity-only')).toBe('')
    expect(darkStack.querySelector('[data-slot="tool-activity-stack"]')).toBeNull()
  })

  it('collapses the run bubble only while the approval pends outside a Bot Chat', async () => {
    seedPendingApproval()

    const { container } = render(<Harness message={runningTerminalMessage()} />)

    expect(await screen.findByRole('button', { name: /Allow once/ })).toBeTruthy()
    expect(assistantMessageRoot(container)?.getAttribute('data-approval-activity-only')).toBe('')

    act(() => clearAllPrompts())

    await waitFor(() => {
      expect(assistantMessageRoot(container)?.hasAttribute('data-approval-activity-only')).toBe(false)
    })

    // With nothing pending the run summary stays in the transcript.
    expect(container.querySelector('[data-slot="tool-activity-stack"]')).not.toBeNull()
  })
})
