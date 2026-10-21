import { describe, expect, it } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import type { ChatMessage } from '@/lib/chat-messages'
import type { SessionInfo } from '@/types/hermes'

import { collectMissionControlCards } from './collector'

function createMessage(id: string, parts: unknown[]): ChatMessage {
  return { id, parts, role: 'assistant' } as ChatMessage
}

function toolCall(id: string, toolName: string, args: unknown, timestamp: number) {
  return {
    args,
    argsText: JSON.stringify(args),
    timestamp,
    toolCallId: id,
    toolName,
    type: 'tool-call'
  }
}

describe('collectMissionControlCards', () => {
  const sessions: SessionInfo[] = [
    {
      id: 'stored-1',
      title: 'Fix auth bug'
    } as SessionInfo,
    {
      id: 'stored-2',
      title: 'Generate report'
    } as SessionInfo,
    {
      id: 'stored-idle',
      title: 'Idle session'
    } as SessionInfo
  ]

  it('collects working sessions with titles and latest activity', () => {
    const sessionStates: Record<string, ClientSessionState> = {
      'rt-1': {
        busy: true,
        messages: [
          createMessage('m1', [
            toolCall('tc-1', 'terminal', { command: 'git status' }, 10),
            toolCall('tc-2', 'terminal', { command: 'npm test' }, 20)
          ])
        ],
        storedSessionId: 'stored-1'
      } as unknown as ClientSessionState
    }

    const cards = collectMissionControlCards({
      getStoredSessionId: () => 'stored-1',
      sessions,
      sessionStates,
      workingSessionIds: ['rt-1']
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]).toEqual({
      latestAction: expect.objectContaining({
        id: 'tc-2',
        target: 'npm test',
        tool: 'terminal'
      }),
      runtimeId: 'rt-1',
      storedSessionId: 'stored-1',
      title: 'Fix auth bug'
    })
  })

  it('excludes non-working sessions even if present in sessions or sessionStates', () => {
    const sessionStates: Record<string, ClientSessionState> = {
      'rt-1': {
        busy: true,
        messages: [createMessage('m1', [toolCall('tc-1', 'terminal', { command: 'cargo build' }, 10)])],
        storedSessionId: 'stored-1'
      } as unknown as ClientSessionState,
      'rt-idle': {
        busy: false,
        messages: [createMessage('m2', [toolCall('tc-2', 'terminal', { command: 'echo done' }, 5)])],
        storedSessionId: 'stored-idle'
      } as unknown as ClientSessionState
    }

    const cards = collectMissionControlCards({
      getStoredSessionId: id => (id === 'rt-1' ? 'stored-1' : 'stored-idle'),
      sessions,
      sessionStates,
      // Only rt-1 is mid-turn / working
      workingSessionIds: ['rt-1']
    })

    expect(cards).toHaveLength(1)
    expect(cards[0].runtimeId).toBe('rt-1')
    expect(cards.some(c => c.runtimeId === 'rt-idle')).toBe(false)
    expect(cards.some(c => c.storedSessionId === 'stored-idle')).toBe(false)
  })

  it('handles state-less runtime ids by producing a card without an activity line (latestAction null)', () => {
    const sessionStates: Record<string, ClientSessionState> = {}

    const cards = collectMissionControlCards({
      getStoredSessionId: () => 'stored-2',
      sessions,
      sessionStates,
      // rt-2 has no state in sessionStates yet
      workingSessionIds: ['rt-2']
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]).toEqual({
      latestAction: null,
      runtimeId: 'rt-2',
      storedSessionId: 'stored-2',
      title: 'Generate report'
    })
  })

  it('falls back gracefully when session metadata is completely missing', () => {
    const cards = collectMissionControlCards({
      getStoredSessionId: () => null,
      sessions: [],
      sessionStates: {},
      workingSessionIds: ['rt-unknown']
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]).toEqual({
      latestAction: null,
      runtimeId: 'rt-unknown',
      storedSessionId: 'rt-unknown',
      title: 'rt-unknown'
    })
  })
})
