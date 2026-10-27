/**
 * Instant ack invariants (zero core). The receipt restates only the user's own
 * words; every later state is a real gateway event; a hand-off removes the
 * line; a send into a busy session (queue/steer) never arms a receipt; an ack
 * that never saw its turn start is dropped after the grace.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $instantAcks,
  ackToolKind,
  armInstantAck,
  feedInstantAck,
  IDLE_GRACE_MS,
  noteInstantAck,
  receiptFromPrompt,
  reduceInstantAck,
  sweepInstantAcks
} from './instant-ack'

vi.mock('@hermes/plugin-sdk', async () => ({ atom: (await import('nanostores')).atom }))

const RT = 'rt-1'

beforeEach(() => $instantAcks.set({}))

describe('receiptFromPrompt', () => {
  it('restates the first words of the ask without furniture or noise', () => {
    expect(receiptFromPrompt('### - [ ] fix the sidebar on https://x.dev today please, then ship it')).toEqual({
      kind: 'prompt',
      text: 'fix the sidebar on today please, then ship'
    })
  })

  it('names a slash command, and stays quiet with nothing honest to restate', () => {
    expect(receiptFromPrompt('/Compact now')).toEqual({ kind: 'command', text: '/compact' })
    expect(receiptFromPrompt('https://example.com')).toBeNull()
    expect(receiptFromPrompt('```\nlog\n```')).toBeNull()
  })
})

describe('ackToolKind', () => {
  it('maps known families and leaves unknown tools named as themselves', () => {
    expect(ackToolKind('terminal')).toBe('run')
    expect(ackToolKind('web_search')).toBe('search')
    expect(ackToolKind('browser_navigate')).toBe('browse')
    expect(ackToolKind('read_file')).toBe('read')
    expect(ackToolKind('patch')).toBe('edit')
    expect(ackToolKind('image_generate')).toBe('tool')
  })
})

describe('reduceInstantAck', () => {
  it('never promotes an unarmed session (background resume, routine kickoff)', () => {
    expect(reduceInstantAck(null, { name: 'terminal', type: 'tool-start' }, 1)).toBeNull()
    expect(reduceInstantAck(null, { type: 'waiting' }, 1)).toBeNull()
  })

  it('only a receipt turns into waiting; a named step keeps its name', () => {
    const armed = reduceInstantAck(null, { kind: 'prompt', storedId: 's', text: 'hi', type: 'arm' }, 1)
    expect(reduceInstantAck(armed, { type: 'waiting' }, 2)?.state).toBe('waiting')
    const working = reduceInstantAck(armed, { name: 'terminal', type: 'tool-start' }, 2)
    expect(reduceInstantAck(working, { type: 'waiting' }, 3)).toBe(working)
  })
})

describe('arm + feed', () => {
  it('a send into a busy session never arms (the queue row is its receipt)', () => {
    expect(armInstantAck(RT, 's', 'do the thing', true)).toBe(false)
    expect($instantAcks.get()).toEqual({})
  })

  it('receipt → first tool → hand-off on reply text, ignoring other sessions and empty frames', () => {
    expect(armInstantAck(RT, 's', 'check the deploy logs', false)).toBe(true)
    expect($instantAcks.get()[RT]).toMatchObject({ state: 'receipt', text: 'check the deploy logs' })

    feedInstantAck({ payload: { name: 'terminal' }, session_id: 'other', type: 'tool.start' })
    expect($instantAcks.get()[RT].state).toBe('receipt')

    feedInstantAck({ payload: { name: 'terminal' }, session_id: RT, type: 'tool.generating' })
    expect($instantAcks.get()[RT]).toMatchObject({ name: 'terminal', state: 'working', tool: 'run' })

    feedInstantAck({ payload: { text: '  ' }, session_id: RT, type: 'message.delta' })
    expect($instantAcks.get()[RT]).toBeDefined()

    feedInstantAck({ payload: { text: 'Done.' }, session_id: RT, type: 'message.delta' })
    expect($instantAcks.get()[RT]).toBeUndefined()
  })

  it.each(['tool.complete', 'approval.request', 'message.complete', 'error'])('%s hands off', type => {
    armInstantAck(RT, 's', 'hello there', false)
    feedInstantAck({ session_id: RT, type })
    expect($instantAcks.get()[RT]).toBeUndefined()
  })
})

describe('sweepInstantAcks', () => {
  it('keeps a fresh receipt while busy lags, drops it past the grace on an idle session', () => {
    noteInstantAck(RT, { kind: 'prompt', storedId: 's', text: 'hi', type: 'arm' }, 1000)
    sweepInstantAcks({}, 1000 + IDLE_GRACE_MS - 1)
    expect($instantAcks.get()[RT]).toBeDefined()
    sweepInstantAcks({ [RT]: true }, 1000 + IDLE_GRACE_MS + 5)
    expect($instantAcks.get()[RT]).toBeDefined()
    sweepInstantAcks({}, 1000 + IDLE_GRACE_MS)
    expect($instantAcks.get()[RT]).toBeUndefined()
  })

  it('drops a working ack as soon as its turn goes idle', () => {
    noteInstantAck(RT, { kind: 'prompt', storedId: 's', text: 'hi', type: 'arm' }, 1000)
    noteInstantAck(RT, { name: 'terminal', type: 'tool-start' }, 1001)
    sweepInstantAcks({}, 1002)
    expect($instantAcks.get()[RT]).toBeUndefined()
  })
})
