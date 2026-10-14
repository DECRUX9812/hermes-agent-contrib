import { afterEach, describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages/types'
import { createClientSessionState } from '@/lib/chat-runtime'

import { setSessions } from './session'
import { latestToolCall, sessionLiveGroup, sessionLiveSummary } from './session-live'
import { clearAllSessionStates, publishSessionState } from './session-states'
import { $todosBySession } from './todos'

const toolMessage = (id: string, calls: { args: string; done?: boolean; name: string }[]): ChatMessage => ({
  id,
  role: 'assistant',
  parts: calls.map((call, index) => ({
    type: 'tool-call',
    toolCallId: `${id}-${index}`,
    toolName: call.name,
    args: JSON.parse(call.args),
    argsText: call.args,
    timestamp: 100 + index,
    ...(call.done ? { completedAt: 200 + index, result: '{}' } : {})
  })) as ChatMessage['parts']
})

afterEach(() => {
  clearAllSessionStates()
  $todosBySession.set({})
  setSessions([])
})

describe('sessionLiveGroup', () => {
  it('puts a session waiting on the user in its own group', () => {
    expect(sessionLiveGroup('needs-input')).toBe('needs-you')
  })

  it('counts quiet, background and delegated work as working', () => {
    for (const state of ['working', 'stalled', 'background'] as const) {
      expect(sessionLiveGroup(state)).toBe('working')
    }
  })

  it('treats everything without a live turn as done', () => {
    for (const state of ['unread', 'idle', 'draft'] as const) {
      expect(sessionLiveGroup(state)).toBe('done')
    }
  })
})

describe('latestToolCall', () => {
  it('returns the newest call with its target and running status', () => {
    const messages = [
      toolMessage('a', [{ args: '{"path":"src/old.ts"}', done: true, name: 'read_file' }]),
      toolMessage('b', [{ args: '{"command":"npm test"}', name: 'terminal' }])
    ]

    expect(latestToolCall(messages)).toMatchObject({ name: 'terminal', status: 'running', target: 'npm test' })
  })

  it('reports nothing for a transcript without tool calls', () => {
    expect(latestToolCall([{ id: 'u', parts: [{ text: 'hi', type: 'text' }], role: 'user' }])).toBeNull()
    expect(latestToolCall(undefined)).toBeNull()
  })
})

describe('sessionLiveSummary', () => {
  it('reports a working session with its current tool, plan step and progress', () => {
    publishSessionState('rt-1', {
      ...createClientSessionState('stored-1', [toolMessage('m', [{ args: '{"query":"flaky"}', name: 'search' }])]),
      busy: true,
      turnStartedAt: 1_000
    })
    $todosBySession.set({
      'rt-1': [
        { content: 'Find the flaky test', id: '1', status: 'completed' },
        { content: 'Fix it', id: '2', status: 'in_progress' },
        { content: 'Dropped', id: '3', status: 'cancelled' },
        { content: 'Open a PR', id: '4', status: 'pending' }
      ]
    })

    const summary = sessionLiveSummary('stored-1').get()

    expect(summary).toMatchObject({
      group: 'working',
      runtimeId: 'rt-1',
      step: 'Fix it',
      todoDone: 1,
      todoTotal: 3,
      turnStartedAt: 1_000
    })
    expect(summary.tool).toMatchObject({ name: 'search', status: 'running', target: 'flaky' })
  })

  it('moves a session to needs-you while it waits on an answer', () => {
    publishSessionState('rt-2', { ...createClientSessionState('stored-2'), busy: true, needsInput: true })

    expect(sessionLiveSummary('stored-2').get().group).toBe('needs-you')
  })

  it('drops the turn clock once the session is done', () => {
    publishSessionState('rt-3', { ...createClientSessionState('stored-3'), busy: false, turnStartedAt: 5 })

    expect(sessionLiveSummary('stored-3').get()).toMatchObject({ group: 'done', turnStartedAt: null })
  })

  it('keeps its reference across updates that change nothing it reports', () => {
    publishSessionState('rt-4', { ...createClientSessionState('stored-4'), busy: true, turnStartedAt: 7 })

    const store = sessionLiveSummary('stored-4')
    const seen: unknown[] = []
    const unsubscribe = store.subscribe(value => seen.push(value))

    publishSessionState('rt-4', { ...createClientSessionState('stored-4'), busy: true, turnStartedAt: 7, cwd: '/x' })
    unsubscribe()

    expect(seen).toHaveLength(1)
  })
})
