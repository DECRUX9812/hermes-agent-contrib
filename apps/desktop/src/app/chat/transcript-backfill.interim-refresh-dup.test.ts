import { describe, expect, it } from 'vitest'

import { graftRefreshedTailOntoBackfill } from '@/app/chat/transcript-backfill'
import { type ChatMessage, chatMessageText, toChatMessages } from '@/lib/chat-messages'
import type { SessionMessage } from '@/types/hermes'

/**
 * A turn streamed on this window leaves SEVERAL bubbles: the interim
 * commentary the agent wrote beside its tool calls is sealed as its own
 * bubble (no durable row id — nothing persisted it), and the settled reply
 * carries the turn's final row id. A background refresh then re-reads that
 * same turn from the store, where `toChatMessages` folds it into ONE message
 * addressed by its first source row.
 *
 * The graft binds the settled bubble to the fold by row id, keeps the
 * interim as an unaddressed "leading" row in front of it, and paints the
 * turn twice: the hydrated fold with the whole turn, and the interim's copy
 * of the commentary that fold already carries.
 */

const userRow = (rowId: number, text: string): SessionMessage =>
  ({ id: rowId, role: 'user', content: text, timestamp: 1_000 + rowId }) as SessionMessage

const assistantRow = (rowId: number, text: string, toolCalls?: unknown): SessionMessage =>
  ({
    id: rowId,
    role: 'assistant',
    content: text,
    timestamp: 1_000 + rowId,
    ...(toolCalls ? { tool_calls: toolCalls } : {})
  }) as SessionMessage

const toolRow = (rowId: number, text: string, callId: string, name = 'terminal'): SessionMessage =>
  ({
    id: rowId,
    role: 'tool',
    content: text,
    timestamp: 1_000 + rowId,
    tool_call_id: callId,
    tool_name: name
  }) as SessionMessage

const COMMENTARY = 'Both worktrees are clean and the fork is fetched.'

/** The turn as the store holds it, once the agent finished it. */
const storedTurn = (): SessionMessage[] => [
  userRow(5, 'go'),
  assistantRow(6, COMMENTARY, [
    { id: 'call-a', function: { arguments: '{}', name: 'delegate_task' }, type: 'function' }
  ]),
  toolRow(7, 'dispatched', 'call-a', 'delegate_task'),
  toolRow(8, '+7 -3', 'call-b'),
  assistantRow(9, 'Done.')
]

/** The same turn as this window streamed it: interim bubble + settled reply. */
const streamedWindow = (): ChatMessage[] => [
  { id: '1005-0-user', parts: [{ text: 'go', type: 'text' }], role: 'user', rowId: 5 },
  {
    id: 'assistant-interim-1',
    interim: true,
    parts: [
      { completedAt: 2_000, text: COMMENTARY, type: 'text' },
      { completedAt: 2_000, toolCallId: 'call-a', toolName: 'delegate_task', type: 'tool-call' },
      { completedAt: 2_000, toolCallId: 'call-b', toolName: 'terminal', type: 'tool-call' }
    ],
    role: 'assistant'
  },
  {
    durableComplete: true,
    id: '1009-1-assistant',
    parts: [{ sourceRowId: 9, text: 'Done.', type: 'text' }],
    persistedTurn: { complete: true, row_ids: [9] },
    role: 'assistant',
    rowId: 9
  }
]

const copiesOf = (messages: ChatMessage[], needle: string) =>
  messages.filter(message => chatMessageText(message).includes(needle)).length

describe('a background refresh over a turn this window streamed', () => {
  it('paints the interim commentary once, not twice', () => {
    const grafted = graftRefreshedTailOntoBackfill(toChatMessages(storedTurn()), streamedWindow())

    expect(copiesOf(grafted, COMMENTARY)).toBe(1)
  })

  it('paints the turn once', () => {
    const grafted = graftRefreshedTailOntoBackfill(toChatMessages(storedTurn()), streamedWindow())
    const turnRows = grafted.filter(message => message.role === 'assistant')

    expect(turnRows.filter(message => chatMessageText(message).trim().length > 0)).toHaveLength(1)
  })
})
