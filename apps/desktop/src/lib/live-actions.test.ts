/**
 * The Live feed's contract with the transcript: every tool call surfaces once,
 * in call order, with its full input and full output — the grouped summary
 * the transcript shows ("ran 3 commands") never stands in for the raw record.
 */

import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { deriveLiveActions } from './live-actions'

const longOutput = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')

function message(id: string, parts: unknown[]): ChatMessage {
  return { id, role: 'assistant', parts } as ChatMessage
}

const call = (id: string, toolName: string, args: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'tool-call',
  toolCallId: id,
  toolName,
  args,
  argsText: JSON.stringify(args),
  ...extra
})

describe('deriveLiveActions', () => {
  it('keeps every call, oldest first, across bubbles', () => {
    const actions = deriveLiveActions([
      message('b', [call('t3', 'read_file', { path: '/a.md' }, { timestamp: 30, completedAt: 31, result: 'x' })]),
      message('a', [
        { type: 'text', text: 'On it.' },
        call(
          't1',
          'terminal',
          { command: 'ls' },
          { timestamp: 10, completedAt: 11, result: { output: 'a', exit_code: 0 } }
        ),
        call('t2', 'terminal', { command: 'wc -l *' }, { timestamp: 20 })
      ])
    ])

    expect(actions.map(a => a.id)).toEqual(['t1', 't2', 't3'])
    expect(actions.map(a => a.status)).toEqual(['ok', 'running', 'ok'])
  })

  it('shows the command and its whole output, never a truncated tail', () => {
    const [action] = deriveLiveActions([
      message('a', [
        call(
          't1',
          'terminal',
          { command: 'seq 400', timeout: 30 },
          {
            timestamp: 1,
            completedAt: 2,
            result: JSON.stringify({ output: longOutput, exit_code: 0, error: null })
          }
        )
      ])
    ])

    expect(action.target).toBe('seq 400')
    expect(action.output).toBe(longOutput)
    // The target is not repeated in the leftover input; other args still are.
    expect(action.input).toContain('timeout')
    expect(action.input).not.toContain('seq 400')
  })

  it('marks a non-zero exit as an error even when the tool itself succeeded', () => {
    const [action] = deriveLiveActions([
      message('a', [
        call(
          't1',
          'terminal',
          { command: 'false' },
          { timestamp: 1, completedAt: 2, result: { output: '', exit_code: 1 } }
        )
      ])
    ])

    expect(action.exitCode).toBe(1)
    expect(action.status).toBe('error')
  })

  it('shows an unknown tool its raw args and raw result', () => {
    const [action] = deriveLiveActions([
      message('a', [call('t1', 'mcp__x__thing', { alpha: 1 }, { timestamp: 1, completedAt: 2, result: { beta: [2] } })])
    ])

    expect(action.target).toBe('')
    expect(JSON.parse(action.input)).toEqual({ alpha: 1 })
    expect(JSON.parse(action.output)).toEqual({ beta: [2] })
  })

  it('collapses a replayed call id to its latest state', () => {
    const actions = deriveLiveActions([
      message('a', [call('t1', 'terminal', { command: 'ls' }, { timestamp: 1 })]),
      message('b', [
        call(
          't1',
          'terminal',
          { command: 'ls' },
          { timestamp: 1, completedAt: 3, result: { output: 'done', exit_code: 0 } }
        )
      ])
    ])

    expect(actions).toHaveLength(1)
    expect(actions[0].output).toBe('done')
  })
})
