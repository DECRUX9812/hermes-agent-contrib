import { beforeEach, describe, expect, it, vi } from 'vitest'

import { recordAgentReaction } from '@/store/reactions-local'
import { setMessages } from '@/store/session'
import { $activeTip, $retiredTips, $tipsEnabled, dismissTip, resetTips, retireActiveTip } from '@/store/tips'

import { handleDesktopBridgeEvent } from './desktop-bridge'
import type { GatewayEventContext } from './types'

vi.mock('@/app/right-sidebar/terminal/agent-terminal-stream', () => ({ writeAgentTerminalChunk: vi.fn() }))
vi.mock('@/app/right-sidebar/terminal/terminals', () => ({ closeAgentTerminalByProc: vi.fn() }))
vi.mock('@/store/pane-focus', () => ({ applyDesktopLayoutPreset: vi.fn(), revealDesktopPane: vi.fn() }))
vi.mock('@/store/reactions-local', () => ({ recordAgentReaction: vi.fn() }))
vi.mock('@/store/session', () => ({ setMessages: vi.fn() }))

const tipShow = (text: string): GatewayEventContext =>
  ({
    event: { type: 'tip.show' },
    isActiveEvent: true,
    payload: { selector: '[data-tour="model-pill"]', text }
  }) as unknown as GatewayEventContext

const reactionEvent = (isActiveEvent: boolean): GatewayEventContext =>
  ({
    event: { session_id: isActiveEvent ? 'sess-foreground' : 'sess-background', type: 'message.reaction' },
    isActiveEvent,
    payload: {
      reactions: [{ at: 1, author: 'agent', emoji: '👍' }],
      role: 'assistant',
      row_id: 42
    }
  }) as unknown as GatewayEventContext

beforeEach(() => {
  dismissTip()
  resetTips()
  $tipsEnabled.set(true)
  vi.clearAllMocks()
})

describe('tip.show bridge (#117216)', () => {
  it('a ✕-closed agent tip does not come back on the next tip.show of the same content', () => {
    handleDesktopBridgeEvent(tipShow('Choose a model here.'))
    const tipId = $activeTip.get()?.tipId

    expect(tipId).toMatch(/^agent:/)

    retireActiveTip()
    expect($retiredTips.get()).toContain(tipId)

    handleDesktopBridgeEvent(tipShow('Choose a model here.'))
    expect($activeTip.get()).toBeNull()

    // Different content is a different tip and still shows.
    handleDesktopBridgeEvent(tipShow('Attach files with the paperclip.'))
    expect($activeTip.get()?.text).toBe('Attach files with the paperclip.')
  })
})

describe('message.reaction bridge (#118748)', () => {
  it('paints the reaction when the event belongs to the session on screen', () => {
    handleDesktopBridgeEvent(reactionEvent(true))

    expect(setMessages).toHaveBeenCalledTimes(1)
  })

  it('never mutates the foreground transcript for a background session', () => {
    // Session A is on screen; session B's react_to_message event arrives
    // tagged with session_id=B. The optimistic fallback must not stamp B's
    // row_id onto A's in-flight bubble, and the overlay must not record a
    // row id from B's state.db.
    handleDesktopBridgeEvent(reactionEvent(false))

    expect(setMessages).not.toHaveBeenCalled()
    expect(recordAgentReaction).not.toHaveBeenCalled()
  })
})
