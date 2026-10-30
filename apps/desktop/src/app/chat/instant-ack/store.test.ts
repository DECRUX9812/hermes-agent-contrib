import { beforeEach, describe, expect, it } from 'vitest'

import { armReceiptForSend } from './arm-at-send'
import { armInstantAck, clearInstantAck, noteInstantAck, readInstantAck, resetInstantAcks } from './store'

const KEY = 'stored-session-1'

describe('instant ack store', () => {
  beforeEach(() => {
    resetInstantAcks()
  })

  it('keeps a line per session, so a tile never narrates the primary chat', () => {
    armInstantAck('a', 'fix the sidebar', 1000)
    armInstantAck('b', 'rework the pricing copy', 1001)

    expect(readInstantAck('a')?.detail).toBe('fix the sidebar')
    expect(readInstantAck('b')?.detail).toBe('rework the pricing copy')
    expect(readInstantAck('c')).toBeNull()
  })

  it('arms nothing without a session key or without words', () => {
    expect(armInstantAck(null, 'fix the sidebar')).toBeNull()
    expect(armInstantAck(KEY, '')).toBeNull()
    expect(readInstantAck(KEY)).toBeNull()
  })

  it('drops the line on hand-off rather than leaving a stale claim', () => {
    armInstantAck(KEY, 'fix the sidebar', 1000)
    noteInstantAck(KEY, { at: 1500, type: 'hand-off' })

    expect(readInstantAck(KEY)).toBeNull()
  })

  it('ignores events for a session that armed nothing', () => {
    noteInstantAck(KEY, { at: 1500, detail: 'Editing', type: 'tool-start' })
    noteInstantAck('never-armed', { at: 1500, type: 'waiting' })

    expect(readInstantAck(KEY)).toBeNull()
    expect(readInstantAck('never-armed')).toBeNull()
  })

  it('leaves unrelated sessions untouched when one clears', () => {
    armInstantAck('a', 'fix the sidebar', 1000)
    armInstantAck('b', 'rework the pricing copy', 1000)
    clearInstantAck('a')

    expect(readInstantAck('a')).toBeNull()
    expect(readInstantAck('b')?.detail).toBe('rework the pricing copy')
  })
})

describe('armReceiptForSend', () => {
  beforeEach(() => {
    resetInstantAcks()
  })

  it('arms the restated ask on the send itself, with no await in between', () => {
    const armed = armReceiptForSend(KEY, 'fix the sidebar overflow')

    expect(armed).toBe(true)
    expect(readInstantAck(KEY)).toMatchObject({ detail: 'fix the sidebar overflow', state: 'receipt' })
  })

  it('takes the path synchronously: the store is readable on the same tick', () => {
    // No `await`, no flush, no timer: if arming were deferred the row would
    // paint a frame or more after the keypress, which is the whole bug.
    armReceiptForSend(KEY, 'check the tunnels')

    expect(readInstantAck(KEY)?.state).toBe('receipt')
  })

  it('arms nothing when the prompt has no honest restatement', () => {
    expect(armReceiptForSend(KEY, '   ')).toBe(false)
    expect(readInstantAck(KEY)).toBeNull()
  })

  it('names a slash command as the command, not its arguments', () => {
    armReceiptForSend(KEY, '/compress now please')

    expect(readInstantAck(KEY)?.detail).toBe('/compress')
  })
})
