/**
 * The Activity view's contract: one task per request, the calls made answering
 * it as that task's steps, and a status that tells the truth about the turn —
 * live while the session is busy, stopped or failed when the reply was.
 */

import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { activityVerb, currentStep, deriveActivityTasks } from './activity-tasks'

const user = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }], timestamp: 100, ...extra }) as ChatMessage

const assistant = (id: string, parts: unknown[], extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, role: 'assistant', parts, ...extra }) as ChatMessage

const call = (id: string, toolName: string, args: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName,
  args,
  argsText: JSON.stringify(args),
  ...extra
})

const done = (at: number, result: unknown = 'ok') => ({ timestamp: at, completedAt: at + 1, result })

describe('deriveActivityTasks', () => {
  it('opens one task per request and files each call under the request it answered', () => {
    const tasks = deriveActivityTasks([
      user('u1', 'Compare bots and modes\nfocus on the side pane'),
      assistant('a1', [
        call('t1', 'read_file', { path: 'src/plugins/hermes-bots/bot-card.tsx' }, done(101)),
        call('t2', 'terminal', { command: 'git status\n--short' }, done(102, { output: '', exit_code: 0 })),
        { type: 'text', text: 'Read the roster code. The pane needs tabs.' }
      ]),
      user('u2', 'Ship it'),
      assistant('a2', [call('t3', 'write_file', { path: '/tmp/x/pane.tsx', content: '…' }, done(201))])
    ])

    expect(tasks.map(task => task.title)).toEqual(['Compare bots and modes', 'Ship it'])
    expect(tasks[0].steps.map(step => [step.verb, step.subject])).toEqual([
      ['read', 'bot-card.tsx'],
      ['ran', 'git status']
    ])
    expect(tasks[0].outcome).toBe('Read the roster code.')
    expect(tasks[1].steps.map(step => step.id)).toEqual(['t3'])
  })

  it('marks only the newest task running while the session is busy, even between calls', () => {
    const messages = [
      user('u1', 'First'),
      assistant('a1', [call('t1', 'terminal', { command: 'ls' }, done(10))]),
      user('u2', 'Second'),
      assistant('a2', [call('t2', 'read_file', { path: 'a.md' }, done(20))])
    ]

    expect(deriveActivityTasks(messages, { busy: true }).map(task => task.status)).toEqual(['done', 'running'])
    expect(deriveActivityTasks(messages).map(task => task.status)).toEqual(['done', 'done'])
  })

  it('a call still waiting on its result keeps its task running and is the step a row names', () => {
    const [task] = deriveActivityTasks([
      user('u1', 'Check the build'),
      assistant('a1', [
        call('t1', 'terminal', { command: 'npm ci' }, done(10)),
        call('t2', 'terminal', { command: 'npm run build' }, { timestamp: 12 }),
        call('t3', 'read_file', { path: 'log.txt' }, done(13))
      ])
    ])

    expect(task.status).toBe('running')
    expect(task.completedAt).toBeNull()
    expect(currentStep(task)?.id).toBe('t2')
  })

  it('tells a failed or stopped reply apart from a finished one, and counts failed calls', () => {
    const tasks = deriveActivityTasks([
      user('u1', 'Deploy'),
      assistant('a1', [call('t1', 'terminal', { command: 'make' }, done(10, { output: 'no', exit_code: 2 }))], {
        error: 'provider down'
      }),
      user('u2', 'Try again'),
      assistant('a2', [{ type: 'text', text: 'Half' }], { interrupted: true })
    ])

    expect(tasks.map(task => task.status)).toEqual(['error', 'stopped'])
    expect(tasks[0].errorCount).toBe(1)
  })

  it('keeps work the agent started on its own, and drops a request-less greeting', () => {
    const tasks = deriveActivityTasks([
      assistant('intro', [{ type: 'text', text: 'Hi, I am Muse.' }]),
      assistant('resume', [call('t1', 'memory', { action: 'add' }, done(5))])
    ])

    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('')
    expect(tasks[0].steps[0].verb).toBe('remembered')
  })

  it('a replayed completion updates its step instead of adding a second one', () => {
    const [task] = deriveActivityTasks([
      user('u1', 'Go'),
      assistant('a1', [call('t1', 'terminal', { command: 'sleep 1' }, { timestamp: 1 })]),
      assistant('a1-sealed', [call('t1', 'terminal', { command: 'sleep 1' }, done(1, { output: '', exit_code: 0 }))])
    ])

    expect(task.steps).toHaveLength(1)
    expect(task.steps[0].action.status).toBe('ok')
  })

  it('a runtime notice in the user role does not open a task', () => {
    const tasks = deriveActivityTasks([
      user('u1', 'Real request'),
      user('n1', 'Context compressed', { userOriginated: false }),
      assistant('a1', [call('t1', 'web_search', { query: 'gpu deals' }, done(3))])
    ])

    expect(tasks.map(task => task.title)).toEqual(['Real request'])
    expect(tasks[0].steps[0].subject).toBe('gpu deals')
  })
})

describe('activityVerb', () => {
  it('names tool families by prefix and falls back to a neutral verb', () => {
    expect(activityVerb('browser_click')).toBe('browsed')
    expect(activityVerb('kanban_create')).toBe('tracked')
    expect(activityVerb('some_plugin_tool')).toBe('used')
  })
})
