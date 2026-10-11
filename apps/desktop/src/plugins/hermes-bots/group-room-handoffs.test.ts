import { describe, expect, it } from 'vitest'

import { deriveRoomHandoffs, parseHandoffLine, roomEscalations } from './group-room-handoffs'
import type { GroupMessage } from './types'

const members = [{ name: 'hermes' }, { name: 'coder', title: 'Coder' }, { name: 'plugin' }] as never

const msg = (from: string, text: string, at: number, thread = 'a'): GroupMessage => ({
  at,
  from: from === 'You' ? { kind: 'user', name: 'You' } : { kind: 'member', name: from },
  text,
  thread
})

const MIN = 60_000

describe('parseHandoffLine', () => {
  it('reads the task, the finish line and the clock off one line', () => {
    expect(
      parseHandoffLine('Plan agreed.\n@Coder handoff: unify replies · done when: tests green · due: 30m', members)
    ).toEqual({ doneWhen: 'tests green', dueMinutes: 30, task: 'unify replies', to: 'coder' })
  })

  it('ignores a plain mention and an unknown name', () => {
    expect(parseHandoffLine('@coder can you look?', members)).toBeNull()
    expect(parseHandoffLine('@stranger handoff: anything', members)).toBeNull()
  })
})

describe('deriveRoomHandoffs', () => {
  const ask = msg('hermes', '@coder handoff: fix the header · done when: no box mid-log', 0)

  it('moves through accepted → delivered on the receiver’s own words in the thread', () => {
    const accepted = deriveRoomHandoffs([ask, msg('coder', 'On it.', MIN)], members, { now: 2 * MIN })
    expect(accepted[0]).toMatchObject({ from: 'hermes', status: 'accepted', to: 'coder' })

    const delivered = deriveRoomHandoffs(
      [ask, msg('coder', 'On it.', MIN), msg('coder', 'Done — commit 097f275, 1,119 tests passed', 5 * MIN)],
      members,
      { now: 6 * MIN }
    )

    expect(delivered[0]).toMatchObject({ replyIndex: 2, status: 'delivered' })
  })

  it('takes a decline with its reason, and ignores other threads and passes', () => {
    const [h] = deriveRoomHandoffs(
      [
        ask,
        msg('coder', 'Done elsewhere 1234567', MIN, 'b'),
        msg('coder', '(pass)', MIN),
        msg('coder', 'Declined: not my area', 2 * MIN)
      ],
      members
    )

    expect(h).toMatchObject({ reply: 'not my area', status: 'declined' })
  })

  it('reads the receiver mid-turn on the thread as working', () => {
    const [h] = deriveRoomHandoffs([ask], members, { live: new Map([['a', new Set(['coder'])]]), now: MIN })
    expect(h?.status).toBe('working')
  })

  it('nudges at 10 minutes and escalates to the user at 20', () => {
    expect(deriveRoomHandoffs([ask], members, { now: 9 * MIN })[0]?.stale).toBe('fresh')
    expect(deriveRoomHandoffs([ask], members, { now: 11 * MIN })[0]?.stale).toBe('nudge')
    const late = deriveRoomHandoffs([ask], members, { now: 21 * MIN })
    expect(late[0]?.stale).toBe('escalate')
    expect(roomEscalations(late, [ask]).map(e => e.kind)).toEqual(['stalled'])
  })
})

describe('roomEscalations', () => {
  it('calls three undelivered back-and-forth handoffs between two teammates a loop', () => {
    const log = [
      msg('You', 'ship the theme', 0),
      msg('hermes', '@coder handoff: build it', 1),
      msg('coder', '@hermes handoff: need the spec first', 2),
      msg('hermes', '@coder handoff: spec is in the thread, build it', 3)
    ]

    const handoffs = deriveRoomHandoffs(log, members, { now: 4 })

    expect(roomEscalations(handoffs, log).map(e => e.kind)).toEqual(['loop'])
    // The user stepping in resets the count.
    const reset = [...log, msg('You', 'coder, just build it', 5)]
    expect(roomEscalations(deriveRoomHandoffs(reset, members, { now: 6 }), reset)).toEqual([])
  })
})
