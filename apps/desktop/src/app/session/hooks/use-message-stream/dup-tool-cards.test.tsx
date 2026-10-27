import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { type ChatMessage, chatMessageText } from '@/lib/chat-messages'

import { type GatewayFrame, playFrames } from './test-harness'

/**
 * A segment that owns tool calls is sealed as an interim IN PLACE, so the
 * sealed bubble keeps the cards of the tools that segment ran. When the same
 * segment then re-streams and completes — a superseded attempt, a reconnect
 * replay, a re-delivered seal — the duplicate-final collapse folds the live
 * bubble into the sealed one.
 *
 * That fold used to append the live bubble's tool parts unconditionally, so a
 * call the sealed bubble already carried landed in the reply a second time
 * under a `-dup-` id (renamed, not dropped, by
 * withUniqueToolCallIdsWithinMessage). Every tool card — delegate_task
 * subagents, terminal diffs — then rendered twice inside one reply.
 */

const SID = 'collapse-live-tools'
const TEXT = 'Both worktrees are clean and the fork is fetched.'

afterEach(cleanup)

const toolRound = (id: string, name: string): GatewayFrame[] => [
  ['tool.start', { name, tool_id: id, args: {} }],
  ['tool.complete', { name, tool_id: id, result: 'ok' }]
]

const assistantBubbles = (messages: unknown[]) =>
  (messages as ChatMessage[]).filter(message => message.role === 'assistant' && !message.hidden)

const cardIds = (messages: unknown[]) =>
  assistantBubbles(messages).flatMap(message =>
    message.parts.flatMap(part => (part.type === 'tool-call' && part.toolCallId ? [part.toolCallId] : []))
  )

describe('a re-streamed segment that already owns its tool cards', () => {
  it('folds the live bubble without doubling the cards it already shows', async () => {
    const messages = await playFrames(SID, [
      ['message.start', {}],
      ['message.delta', { text: TEXT }],
      ...toolRound('call-a', 'delegate_task'),
      ...toolRound('call-b', 'terminal'),
      // Seal AFTER the tools: the sealed interim keeps its cards.
      ['message.interim', { text: TEXT, already_streamed: true }],
      // The turn re-streams that segment and settles with the same reply.
      ['message.delta', { text: TEXT }],
      ...toolRound('call-a', 'delegate_task'),
      ...toolRound('call-b', 'terminal'),
      ['message.complete', { text: TEXT }]
    ])

    expect(cardIds(messages)).toEqual(['call-a', 'call-b'])
  })

  it('keeps one copy of the reply text when the turn settles on it', async () => {
    const messages = await playFrames(SID, [
      ['message.start', {}],
      ['message.delta', { text: TEXT }],
      ...toolRound('call-a', 'delegate_task'),
      ['message.interim', { text: TEXT, already_streamed: true }],
      ['message.delta', { text: TEXT }],
      ...toolRound('call-a', 'delegate_task'),
      ['message.complete', { text: TEXT }]
    ])

    const painted = assistantBubbles(messages)
      .map(message => chatMessageText(message))
      .join('\n')

    expect(painted.split(TEXT).length - 1).toBe(1)
  })
})
