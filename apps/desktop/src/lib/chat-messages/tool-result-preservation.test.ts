import { fromThreadMessageLike, getAutoStatus } from '@assistant-ui/core/internal'
import { describe, expect, it } from 'vitest'

import { buildToolView } from '@/components/assistant-ui/tool/fallback-model'
import { toRuntimeMessage } from '@/lib/chat-runtime'

import { storedToolMessagePart, upsertToolPart } from './tool-parts'
import type { ChatMessagePart } from './types'

describe('live tool result evidence', () => {
  it('preserves every JSON value and display hints through the real runtime adapter and replay', () => {
    const values = [
      'plain text\n',
      '',
      '{"answer":1}',
      '[1,false]',
      0,
      false,
      null,
      [],
      [1, false],
      { summary: 'original', output: 'ok' }
    ]

    for (const [index, result] of values.entries()) {
      const tool_id = `call-${index}`

      const parts = upsertToolPart(
        [],
        { name: 'terminal', tool_id, result, summary: 'abbreviated', duration_s: 0 },
        'complete',
        2
      )

      const [part] = parts
      expect(part.type).toBe('tool-call')

      if (part.type !== 'tool-call') {
        throw new Error('Missing tool call')
      }

      expect(part.result).toBe(result)
      expect(part.toolResultMetadata).toMatchObject({ summary: 'abbreviated', duration_s: 0 })

      const replayed = upsertToolPart(parts, { name: 'terminal', tool_id, message: 'completed' }, 'complete', 3)
      expect((replayed[0] as typeof part).result).toBe(result)

      const runtime = fromThreadMessageLike(
        toRuntimeMessage({ id: tool_id, role: 'assistant', parts: replayed }),
        tool_id,
        getAutoStatus(false, false, false, false, undefined)
      )

      const received = runtime.content[0] as typeof part
      expect(received.result).toEqual(result)
      expect(received.toolResultMetadata).toMatchObject({ summary: 'abbreviated', message: 'completed' })

      if (typeof result === 'object' && result && 'summary' in result) {
        expect((received.result as typeof result).summary).toBe(result.summary)
      }
    }
  })

  it('distinguishes a missing completion result from empty results and keeps parallel completions separate', () => {
    let parts: ChatMessagePart[] = []

    for (const [tool_id, command] of [
      ['a', 'echo a'],
      ['b', 'echo b']
    ]) {
      parts = upsertToolPart(parts, { name: 'terminal', tool_id, args: { command } }, 'running', 1)
    }

    parts = upsertToolPart(parts, { name: 'terminal', tool_id: 'b', result: '' }, 'complete', 2)
    parts = upsertToolPart(parts, { name: 'terminal', tool_id: 'a', summary: 'done' }, 'complete', 3)
    expect(parts).toHaveLength(2)
    const [missing, empty] = parts

    if (missing.type !== 'tool-call' || empty.type !== 'tool-call') {
      throw new Error('Missing tool call')
    }

    expect(missing.result).toBeUndefined()
    expect(missing.completedAt).toBe(3)
    expect(buildToolView(missing, '').status).toBe('warning')
    expect(empty.result).toBe('')
    expect(buildToolView(empty, '').status).toBe('success')
  })
})

describe('browser thumbnail metadata', () => {
  it('keeps a validated capture reference on live and stored tool parts', () => {
    const [live] = upsertToolPart(
      [],
      {
        name: 'browser_snapshot',
        result: { success: true },
        thumbnail: { id: 'capture-1', title: 'Example', url: 'https://example.com' },
        tool_id: 'browser-call-1'
      },
      'complete',
      2
    )

    expect(live.type).toBe('tool-call')
    if (live.type !== 'tool-call') {
      throw new Error('Missing live browser tool')
    }
    expect(live.toolResultMetadata?.thumbnail).toEqual({
      id: 'capture-1',
      title: 'Example',
      url: 'https://example.com'
    })

    const stored = storedToolMessagePart(
      {
        content: '{"success":true}',
        display_metadata: JSON.stringify({
          tool_result_metadata: {
            thumbnail: { id: 'capture-2', title: 'Stored page' }
          }
        }),
        role: 'tool',
        timestamp: 3,
        tool_call_id: 'browser-call-2',
        tool_name: 'browser_snapshot'
      },
      0
    )

    expect(stored.type).toBe('tool-call')
    if (stored.type !== 'tool-call') {
      throw new Error('Missing stored browser tool')
    }
    expect(stored.toolResultMetadata?.thumbnail).toEqual({ id: 'capture-2', title: 'Stored page' })
  })
})
