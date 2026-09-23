import type { GatewayEvent } from '@hermes/shared'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChatMessage, GatewayEventPayload } from '@/lib/chat-messages'
import { $agentReactions } from '@/store/reactions-local'
import { $messages } from '@/store/session'
import type { MessageReaction } from '@/types/hermes'

import { handleDesktopBridgeEvent } from './desktop-bridge'
import type { GatewayEventContext } from './types'

const ACTIVE_SID = 'foreground-session'
const BACKGROUND_SID = 'background-session'
const BACKGROUND_ROW_ID = 4242
const AGENT_REACTIONS: MessageReaction[] = [{ at: 1_700_000_000, author: 'agent', emoji: '❤️' }]

function assistantMessage(id: string, rowId?: number): ChatMessage {
  return {
    id,
    parts: [{ text: 'text', type: 'text' }],
    role: 'assistant',
    ...(rowId === undefined ? {} : { rowId })
  }
}

function reactionContext(isActiveEvent: boolean, rowId = BACKGROUND_ROW_ID): GatewayEventContext {
  const payload: GatewayEventPayload = { reactions: AGENT_REACTIONS, role: 'assistant', row_id: rowId }
  const sessionId = isActiveEvent ? ACTIVE_SID : BACKGROUND_SID
  const event = { payload, session_id: sessionId, type: 'message.reaction' } as GatewayEvent<'message.reaction'>

  return {
    deps: {} as GatewayEventContext['deps'],
    event,
    explicitSid: sessionId,
    fromActiveSource: () => true,
    isActiveEvent,
    occurredAt: 1_700_000_000,
    payload,
    scheduleConfigRefresh: () => undefined,
    sessionId
  }
}

describe('handleDesktopBridgeEvent message.reaction', () => {
  afterEach(() => {
    $messages.set([])
    $agentReactions.set({})
  })

  it('never mutates the foreground transcript for a background session', () => {
    // A background session's row id can numerically collide with a foreground
    // row id (per-profile DBs mint their own ids), and the role fallback would
    // otherwise stamp that foreign id onto an optimistic foreground bubble.
    $messages.set([assistantMessage('fg-hydrated', BACKGROUND_ROW_ID), assistantMessage('fg-live')])
    const before = $messages.get()

    // Durable-row leg: the event's row_id collides with a foreground rowId.
    expect(handleDesktopBridgeEvent(reactionContext(false))).toBe(true)
    expect($messages.get()).toEqual(before)

    // Live leg: no row-id match — the fallback targets the newest optimistic
    // bubble of that role, which is foreground state.
    expect(handleDesktopBridgeEvent(reactionContext(false, 9999))).toBe(true)
    expect($messages.get()).toEqual(before)
    expect($agentReactions.get()).toEqual({})
  })

  it('paints an active session reaction on the hydrated and the live legs', () => {
    $messages.set([assistantMessage('fg-hydrated', BACKGROUND_ROW_ID), assistantMessage('fg-live')])

    // Durable-row leg: in-place update on the bubble already carrying rowId.
    expect(handleDesktopBridgeEvent(reactionContext(true))).toBe(true)
    expect($messages.get()[0]).toMatchObject({ id: 'fg-hydrated', reactions: AGENT_REACTIONS })
    expect($agentReactions.get()[BACKGROUND_ROW_ID]).toEqual(AGENT_REACTIONS)

    // Live leg: no row-id match — stamp the now-known row id plus the
    // reactions onto the newest optimistic bubble of that role.
    expect(handleDesktopBridgeEvent(reactionContext(true, 7777))).toBe(true)
    expect($messages.get().find(message => message.id === 'fg-live')).toMatchObject({
      reactions: AGENT_REACTIONS,
      rowId: 7777
    })
    expect($agentReactions.get()[7777]).toEqual(AGENT_REACTIONS)
  })
})
