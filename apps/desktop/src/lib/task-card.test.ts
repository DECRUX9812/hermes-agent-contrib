import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { formatElapsed, taskStartedMs, taskSteps } from './task-card'

const tool = (toolName: string, args: object, done = true) => ({
  type: 'tool-call' as const,
  toolCallId: `${toolName}:${JSON.stringify(args)}`,
  toolName,
  args,
  argsText: JSON.stringify(args),
  ...(done ? { result: 'ok' } : {})
})

const turn = (parts: unknown[], prior: ChatMessage[] = []): ChatMessage[] => [
  ...prior,
  { id: 'u', role: 'user', parts: [{ type: 'text', text: 'go' }], timestamp: 1_700_000_000 } as ChatMessage,
  { id: 'a', role: 'assistant', parts } as ChatMessage
]

describe('taskSteps', () => {
  it('narrates only the latest turn, newest three, in the transcript’s words', () => {
    const earlier = turn([tool('web_search', { query: 'old question' })])

    const steps = taskSteps(
      turn(
        [
          tool('read_file', { path: '/a/one.ts' }),
          tool('read_file', { path: '/a/two.ts' }),
          tool('web_search', { query: 'parks' }),
          tool('browser_navigate', { url: 'https://chase.com/login' }, false)
        ],
        earlier
      ),
      true
    )

    expect(steps).toHaveLength(3)
    expect(steps.map(step => step.label).join(' | ')).not.toContain('old question')
    expect(steps.at(-1)).toMatchObject({ live: true })
    expect(steps.at(-1)?.label).toContain('chase.com')
    expect(steps.slice(0, 2).every(step => !step.live)).toBe(true)
  })

  it('reads an unfinished call as done once the turn is no longer busy', () => {
    const [step] = taskSteps(turn([tool('browser_navigate', { url: 'https://x.dev' }, false)]), false)

    expect(step?.live).toBe(false)
  })
})

describe('task timing', () => {
  it('anchors on the latest user message, accepting backend seconds', () => {
    expect(taskStartedMs(turn([]))).toBe(1_700_000_000_000)
  })

  it('formats elapsed time compactly', () => {
    expect(formatElapsed(12_000)).toBe('12s')
    expect(formatElapsed(571_000)).toBe('9m 31s')
    expect(formatElapsed(3_840_000)).toBe('1h 4m')
  })
})
