import { type ThreadMessage } from '@assistant-ui/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime } from '@/components/assistant-ui/test-utils'
import { Thread } from '@/components/assistant-ui/thread'
import {
  TOOL_RUN_RENDERER_AREA,
  type ToolRunRendererContribution,
  type ToolRunRendererProps
} from '@/components/assistant-ui/tool/fallback'
import { registry } from '@/contrib/registry'
import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { $activeSessionId } from '@/store/session'
import { $botChatSessionIds, $sessionTiles, setSessionTileWorkspaceScope } from '@/store/session-states'
import { setShowToolActivityFromConfig } from '@/store/tool-activity'

stubThreadEnvironment()
stubThreadViewportSize()

const SID = 'sess-1'
const STORED = 'stored-1'
const createdAt = new Date('2026-06-03T00:00:00.000Z')
const metadata = { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }

const call = (toolCallId: string, toolName: string, args: Record<string, unknown>, result?: unknown) => ({
  type: 'tool-call',
  toolCallId,
  toolName,
  args,
  argsText: JSON.stringify(args),
  ...(result === undefined ? {} : { result })
})

function message(id: string, content: unknown[], running = false): ThreadMessage {
  return {
    id,
    role: 'assistant',
    content,
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    createdAt,
    metadata
  } as unknown as ThreadMessage
}

const diff = '--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1,2 @@\n-beforeEdit\n+afterEdit'

const mixed = () =>
  message('msg-mixed', [
    call('read-1', 'read_file', { path: '/repo/src/a.ts' }, { content: 'a' }),
    call('search-1', 'search_files', { query: 'test' }, { matches: [] }),
    call('edit-1', 'edit_file', { path: '/repo/demo.ts', content: 'afterEdit' }, { success: true, inline_diff: diff }),
    { type: 'text', text: 'Run completed.' }
  ])

function Harness({ value }: { value: ThreadMessage }) {
  return (
    <ThreadRuntime messages={[value]}>
      <Thread />
    </ThreadRuntime>
  )
}

const seen: ToolRunRendererProps[] = []
let dispose: (() => void) | undefined

function claim(draw?: ToolRunRendererContribution['render']) {
  const unregister = registry.register({
    id: 'cards:tool-run',
    area: TOOL_RUN_RENDERER_AREA,
    source: 'plugin:cards',
    data: {
      render:
        draw ??
        (props => {
          seen.push(props)

          return <div data-testid="plugin-run">{props.parts.map(part => part.toolName).join(',')}</div>
        })
    } satisfies ToolRunRendererContribution
  })

  dispose = typeof unregister === 'function' ? unregister : undefined
}

function markBotChat() {
  $sessionTiles.set([{ runtimeId: SID, storedSessionId: STORED } as never])
  setSessionTileWorkspaceScope(STORED, { workspaceMode: 'bots', workspaceOwnerKey: 'bot:alpha' })
}

beforeEach(() => {
  seen.length = 0
  clearAllPrompts()
  $activeSessionId.set(SID)
  setShowToolActivityFromConfig('on')
})

afterEach(() => {
  cleanup()
  dispose?.()
  dispose = undefined
  clearAllPrompts()
  $activeSessionId.set(null)
  setShowToolActivityFromConfig(undefined)
  $sessionTiles.set([])
  setSessionTileWorkspaceScope(STORED, { workspaceMode: 'sessions', workspaceOwnerKey: '' })
  $botChatSessionIds.set(new Set())
})

describe('tool run renderer seam', () => {
  it('keeps core rows in a Bot Chat when nothing is registered', async () => {
    markBotChat()
    const { container } = render(<Harness value={mixed()} />)

    expect(await screen.findByText('Run completed.')).toBeTruthy()
    expect(screen.queryByTestId('plugin-run')).toBeNull()
    await waitFor(() => expect(container.querySelector('[data-tool-summary]')).not.toBeNull())
  })

  it('hands a Bot Chat run its plain calls and keeps card tools in place', async () => {
    markBotChat()
    claim()
    const { container } = render(<Harness value={mixed()} />)

    expect((await screen.findByTestId('plugin-run')).textContent).toBe('read_file,search_files')
    expect(seen.at(-1)?.sessionId).toBe(SID)
    expect(container.querySelector('[data-tool-summary]')).toBeNull()
    expect(container.querySelector('[data-tool-row]')).toBeTruthy()
  })

  it('leaves non-bot sessions alone', async () => {
    claim()
    const { container } = render(<Harness value={mixed()} />)

    expect(await screen.findByText('Run completed.')).toBeTruthy()
    expect(screen.queryByTestId('plugin-run')).toBeNull()
    await waitFor(() => expect(container.querySelector('[data-tool-summary]')).not.toBeNull())
  })

  it('falls back to core rows when the renderer throws', async () => {
    markBotChat()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    claim(() => {
      throw new Error('boom')
    })
    const { container } = render(<Harness value={mixed()} />)

    expect(await screen.findByText('Run completed.')).toBeTruthy()
    await waitFor(() => expect(container.querySelector('[data-tool-summary]')).not.toBeNull())
  })

  it('names the call waiting on approval and scrolls to the prompt on review', async () => {
    markBotChat()

    const anchor = document.createElement('div')
    anchor.setAttribute('data-approval-stack', '')
    anchor.setAttribute('data-session-id', SID)
    anchor.scrollIntoView = vi.fn()
    document.body.appendChild(anchor)
    setApprovalRequest({ command: 'rm -rf /tmp/test', description: 'delete files', sessionId: SID })

    claim(props => (
      <button data-call={props.approvalCallId} onClick={props.onReviewApproval} type="button">
        Review
      </button>
    ))
    render(<Harness value={message('msg-approval', [call('term-approval', 'terminal', { command: 'rm -rf /tmp/test' })], true)} />)

    const review = await screen.findByRole('button', { name: 'Review' })
    expect(review.getAttribute('data-call')).toBe('term-approval')
    fireEvent.click(review)
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    anchor.remove()
  })
})
