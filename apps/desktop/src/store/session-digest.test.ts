import { afterEach, describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages/types'
import { createClientSessionState } from '@/lib/chat-runtime'
import type { TodoItem } from '@/lib/todos'

import { clearClarifyRequest } from './clarify'
import { $compactingSessions } from './compaction'
import { $backgroundStatusBySession } from './composer-status'
import { clearApprovalRequest } from './prompts'
import { $providerWaitSessions } from './provider-wait'
import { $sessionDigestById, deriveSessionDigest } from './session-digest'
import { clearAllSessionStates, publishSessionState } from './session-states'
import { $subagentsBySession, type SubagentProgress } from './subagents'
import { $todosBySession } from './todos'
import { $draftingToolSessions } from './tool-drafting'

const assistantMessage = (parts: ChatMessage['parts'], pending = false): ChatMessage =>
  ({ id: 'a1', parts, pending, role: 'assistant' }) as ChatMessage

const toolPart = (toolName: string, args: unknown = {}, pending = true) =>
  ({ type: 'tool-call', toolCallId: `${toolName}-1`, toolName, args, ...(pending ? {} : { result: { ok: true } }) }) as never

const subagent = (overrides: Partial<SubagentProgress>): SubagentProgress =>
  ({
    filesRead: [],
    filesWritten: [],
    goal: 'Research the fix',
    id: 'sub1',
    startedAt: 0,
    status: 'running',
    stream: [],
    taskCount: 1,
    taskIndex: 0,
    updatedAt: 0,
    ...overrides
  }) as SubagentProgress

const todo = (status: TodoItem['status'], content = 'Fix the bug'): TodoItem => ({ content, id: 't1', status })

afterEach(() => {
  clearAllSessionStates()
  clearClarifyRequest()
  clearApprovalRequest()
  $backgroundStatusBySession.set({})
  $compactingSessions.set({})
  $draftingToolSessions.set({})
  $providerWaitSessions.set({})
  $subagentsBySession.set({})
  $todosBySession.set({})
})

describe('deriveSessionDigest', () => {
  it('says nothing for idle and draft rows', () => {
    expect(deriveSessionDigest('idle', {})).toBeNull()
    expect(deriveSessionDigest('draft', {})).toBeNull()
  })

  it('leads needs-input with the pending question', () => {
    const digest = deriveSessionDigest('needs-input', {
      clarify: {
        choices: null,
        multiSelect: false,
        question: 'Which environment should I target?\nPick one',
        requestId: 'r1',
        sessionId: 'rt1'
      }
    })

    expect(digest).toBe('Which environment should I target? Pick one')
  })

  it('falls back to the approval command, then the generic wait label', () => {
    expect(
      deriveSessionDigest('needs-input', {
        approval: { command: 'rm -rf dist', description: '', sessionId: 'rt1' }
      })
    ).toBe('Approve: rm -rf dist')

    expect(deriveSessionDigest('needs-input', {})).toBe('Waiting for your answer')
  })

  it('reports compaction and provider waits before anything else while working', () => {
    expect(deriveSessionDigest('working', { compacting: true })).toBe('Summarizing thread')
    expect(deriveSessionDigest('working', { providerWait: '⏳ still waiting on provider (12s)' })).toBe(
      '⏳ still waiting on provider (12s)'
    )
    // A spinner rewrite without the explained-wait shape is presentation noise.
    expect(deriveSessionDigest('working', { providerWait: 'vibing…' })).toBe('Session running')
  })

  it('names the tool being drafted while its arguments stream', () => {
    expect(deriveSessionDigest('working', { drafting: { name: 'write_file', since: 0 } })).toBe('Editing')
  })

  it('summarizes the pending tool call in the live message', () => {
    const state = createClientSessionState('s1', [
      assistantMessage([toolPart('read_file', { path: '/repo/wiring.tsx' })], true)
    ])

    expect(deriveSessionDigest('working', { state: { ...state, busy: true } })).toBe('Exploring wiring.tsx')
  })

  it('says "writing a reply" once the live bubble has text and no pending tool', () => {
    const state = createClientSessionState('s1', [
      assistantMessage(
        [
          toolPart('read_file', { path: '/repo/wiring.tsx' }, false),
          { type: 'text', text: 'The bug is in the fallback path' } as never
        ],
        true
      )
    ])

    expect(deriveSessionDigest('working', { state: { ...state, busy: true } })).toBe('Writing a reply')
  })

  it('prefers a running subagent over the pending tool that spawned it', () => {
    const state = createClientSessionState('s1', [assistantMessage([toolPart('delegate_task')], true)])

    expect(
      deriveSessionDigest('working', {
        state: { ...state, busy: true },
        subagents: [subagent({ goal: 'Check the migrations' })]
      })
    ).toBe('Check the migrations')

    expect(
      deriveSessionDigest('working', {
        state: { ...state, busy: true },
        subagents: [subagent({ id: 'a' }), subagent({ id: 'b' })]
      })
    ).toBe('2 agents running')
  })

  it('falls back to the background process, then the in-progress plan step', () => {
    expect(
      deriveSessionDigest('background', {
        background: [{ id: 'p1', state: 'running', title: 'npm run build', type: 'background' }]
      })
    ).toBe('npm run build')

    expect(
      deriveSessionDigest('working', {
        state: { ...createClientSessionState('s1'), busy: true },
        todos: [todo('completed', 'Find it'), { content: 'Patch the bug', id: 't2', status: 'in_progress' }]
      })
    ).toBe('1/2 · Patch the bug')
  })

  it('labels a stalled turn as quiet and a bare working turn as running', () => {
    expect(deriveSessionDigest('stalled', {})).toBe('Still running — quiet for a while')
    expect(deriveSessionDigest('working', {})).toBe('Session running')
  })

  it('previews the unseen reply for an unread session', () => {
    const state = createClientSessionState('s1', [
      assistantMessage([{ type: 'text', text: 'Fixed.\n\nAll tests pass now.' } as never])
    ])

    expect(deriveSessionDigest('unread', { state })).toBe('Fixed. All tests pass now.')
    expect(deriveSessionDigest('unread', {})).toBe('Finished — unread')
  })
})

describe('$sessionDigestById', () => {
  it('projects a runtime-keyed live state onto the stored session id', () => {
    publishSessionState('rt1', {
      ...createClientSessionState('s1', [assistantMessage([toolPart('read_file', { path: '/repo/x.ts' })], true)]),
      busy: true
    })

    // The rail row knows 's1'; the live state arrived under runtime id 'rt1'.
    expect($sessionDigestById.get().s1).toBe('Exploring x.ts')
  })

  it('trades the action line for the unread marker when the turn settles', () => {
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: true })

    expect($sessionDigestById.get().s1).toBe('Session running')

    // The settled turn produced output nobody read: the digest becomes the
    // unread note rather than going silent or keeping a stale action.
    publishSessionState('rt1', { ...createClientSessionState('s1'), busy: false })

    expect($sessionDigestById.get().s1).toBe('Finished — unread')
  })
})
