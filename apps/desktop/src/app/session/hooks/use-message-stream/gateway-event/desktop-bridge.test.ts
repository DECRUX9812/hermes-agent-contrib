import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'
import { $agentReactions } from '@/store/reactions-local'
import { $messages, setMessages } from '@/store/session'

import { handleDesktopBridgeEvent } from './desktop-bridge'
import type { GatewayEventContext } from './types'

function context(isActiveEvent: boolean): GatewayEventContext {
  return {
    deps: {
      activeGatewayProfile: 'default',
      activeSessionIdRef: { current: 'foreground' },
      appendAssistantDelta: vi.fn(),
      appendReasoningDelta: vi.fn(),
      compactedTurnRef: { current: new Set() },
      completeAssistantMessage: vi.fn(),
      failAssistantMessage: vi.fn(),
      finalizeInterimAssistantMessage: vi.fn(),
      flushQueuedDeltas: vi.fn(),
      hydrateFromStoredSession: vi.fn(async () => undefined),
      lastCwdInfoSessionRef: { current: null },
      nativeSubagentSessionsRef: { current: new Set() },
      queryClient: {} as GatewayEventContext['deps']['queryClient'],
      refreshHermesConfig: vi.fn(async () => undefined),
      scheduleSessionsRefresh: vi.fn(),
      sessionInterrupted: vi.fn(() => false),
      sessionStateByRuntimeIdRef: { current: new Map() },
      updateSessionState: vi.fn(),
      upsertToolCall: vi.fn()
    },
    event: { type: 'message.reaction' },
    explicitSid: isActiveEvent ? 'foreground' : 'background',
    fromActiveSource: () => true,
    isActiveEvent,
    occurredAt: 1_700_000_100,
    payload: {
      row_id: 42,
      role: 'assistant',
      reactions: [{ author: 'agent', emoji: '👍', at: 1_700_000_100 }]
    },
    scheduleConfigRefresh: vi.fn(),
    sessionId: isActiveEvent ? 'foreground' : 'background'
  }
}

const optimisticAssistant: ChatMessage = {
  id: 'live-1',
  role: 'assistant',
  parts: [{ type: 'text', text: 'hi' }]
}

describe('handleDesktopBridgeEvent message.reaction', () => {
  beforeEach(() => {
    $messages.set([{ ...optimisticAssistant }])
    $agentReactions.set({})
  })

  it('stamps the row id onto the newest optimistic bubble for the active session', () => {
    expect(handleDesktopBridgeEvent(context(true))).toBe(true)

    const [message] = $messages.get()
    expect(message.rowId).toBe(42)
    expect(message.reactions).toEqual([{ author: 'agent', emoji: '👍', at: 1_700_000_100 }])
    expect($agentReactions.get()[42]).toEqual([{ author: 'agent', emoji: '👍', at: 1_700_000_100 }])
  })

  it('leaves the foreground transcript untouched for a background session', () => {
    expect(handleDesktopBridgeEvent(context(false))).toBe(true)

    expect($messages.get()).toEqual([optimisticAssistant])
    expect($agentReactions.get()[42]).toBeUndefined()
  })
})
