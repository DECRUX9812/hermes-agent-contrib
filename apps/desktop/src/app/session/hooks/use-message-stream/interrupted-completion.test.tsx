import type { GatewayEventName } from '@hermes/shared'
// #118628: a user-stopped turn's terminal frame carries status 'interrupted'
// and the partial reply the backend persisted (handle_api_interrupt appends
// the streamed partial to state.db; _turn_outcome reports it as the frame's
// text). The renderer must land it on the transcript — the flush queue's
// tail deltas die on the interrupted latch and cancelRun's seal only kept
// what had already painted, so without the frame's text the cached transcript
// is a strict truncation of state.db, and resumeTile's warm path republishes
// that lossy cache verbatim on reopen.
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { finalizeUserInterruptedMessages } from '@/app/session/hooks/use-prompt-actions/rewind'
import type { ClientSessionState } from '@/app/types'
import { type ChatMessage, chatMessageText, textPart } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'

import { type MessageStreamHarness, renderMessageStream } from './test-harness'

const SID = 'interrupted-completion-session'

const USER: ChatMessage = { id: 'user-1', parts: [textPart('watch the build')], role: 'user', timestamp: 1 }

let stream: MessageStreamHarness
let states: Map<string, ClientSessionState>

const event = (type: GatewayEventName, timestamp: number, payload: Record<string, unknown> = {}) =>
  act(() => stream.handleEvent({ payload: { ...payload, timestamp }, session_id: SID, type }))

/** Mirror cancelRun's state write: seal the live bubble, latch interrupted. */
const userStopped = () =>
  act(() => {
    const state = stream.state(SID)

    states.set(SID, {
      ...state,
      awaitingResponse: false,
      busy: false,
      interrupted: true,
      messages: finalizeUserInterruptedMessages(state.messages, state.streamId),
      needsInput: false,
      pendingBranchGroup: null,
      streamId: null
    })
  })

const assistantTexts = () =>
  stream
    .state(SID)
    .messages.filter(m => m.role === 'assistant')
    .map(chatMessageText)

describe('message.complete for a user-stopped turn', () => {
  beforeEach(() => {
    states = new Map([[SID, createClientSessionState('stored-1', [USER])]])
    stream = renderMessageStream(SID, { states })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the persisted partial when Stop beat the first delta flush', () => {
    event('message.start', 100)
    // The reply streamed, but every delta is still sitting in the flush
    // queue — no bubble was ever seeded into the transcript.
    event('message.delta', 101, { text: 'half-written assistant reply' })
    userStopped()

    // Backend interrupted mid-response: the partial row is in state.db and
    // the terminal frame carries it verbatim.
    event('message.complete', 102, { status: 'interrupted', text: 'half-written assistant reply' })

    expect(assistantTexts()).toEqual(['half-written assistant reply'])
  })

  it('extends the sealed stream bubble to the persisted partial', () => {
    event('message.start', 100)
    event('message.delta', 101, { text: 'half-written' })
    // A tool event forces the queued delta through mutateStream — the bubble
    // is seeded with only the flushed prefix.
    event('tool.start', 102, { args: { command: 'make' }, name: 'terminal', tool_id: 'call-1' })
    userStopped()

    event('message.complete', 103, { status: 'interrupted', text: 'half-written assistant reply' })

    expect(assistantTexts()).toEqual(['half-written assistant reply'])
    // The tool part the user watched run survives the merge.
    expect(
      stream
        .state(SID)
        .messages.at(-1)
        ?.parts.some(part => part.type === 'tool-call')
    ).toBe(true)
  })

  it('keeps sealed interim commentary when the partial belongs to a later response', () => {
    event('message.start', 100)
    event('message.delta', 101, { text: 'checking the build' })
    event('message.interim', 102, { text: 'checking the build' })
    userStopped()

    // The interrupted response's partial is unrelated to the sealed
    // commentary — it must land as its own bubble, not replace it.
    event('message.complete', 103, { status: 'interrupted', text: 'the build is halfway' })

    expect(assistantTexts()).toEqual(['checking the build', 'the build is halfway'])
  })

  it('still discards a raced full reply the user asked to stop', () => {
    event('message.start', 100)
    event('message.delta', 101, { text: 'half-written' })
    userStopped()

    // The turn finished before the interrupt landed: status 'complete' means
    // text is the full reply, not the retained partial — the user's Stop
    // still wins.
    event('message.complete', 102, { status: 'complete', text: 'the complete reply that raced the interrupt' })

    expect(assistantTexts()).toEqual([])
  })

  it('does not append an empty bubble for a text-less interrupted completion', () => {
    event('message.start', 100)
    userStopped()

    // Interrupt before the model produced anything: the gateway strips the
    // "waiting for model response" sentinel, so the frame carries no text.
    event('message.complete', 101, { status: 'interrupted', text: '' })

    expect(assistantTexts()).toEqual([])
  })
})
