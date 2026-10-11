import { expect, it } from 'vitest'

import { roomCatchUp } from './group-room-catchup'
import { deriveRoomHandoffs } from './group-room-handoffs'
import { roomWorkItems } from './group-room-work'
import type { GroupMessage } from './types'

const members = [{ name: 'coder' }, { name: 'plugin' }] as never

const msg = (from: string, text: string, at: number, thread: string): GroupMessage => ({
  at,
  from: from === 'You' ? { kind: 'user', name: 'You' } : { kind: 'member', name: from },
  text,
  thread
})

it('reports what changed per thread since the last visit, what waits on you first', () => {
  const log = [
    msg('You', 'fix the header', 100, 'a'),
    msg('coder', 'old reply, already seen', 150, 'a'),
    msg('You', 'theme plugin', 160, 'b'),
    msg('coder', '@plugin handoff: write tokens · done when: tests green', 210, 'a'),
    msg('plugin', 'Delivered — 12 tests passed', 220, 'a'),
    msg('plugin', 'a question about b', 230, 'b')
  ]

  const handoffs = deriveRoomHandoffs(log, members, { now: 300 })
  const items = roomWorkItems(log, { running: false, waitingThreads: new Set(['b']) })

  const catchUp = roomCatchUp(log, 200, { escalations: [], handoffs, items, waiting: new Set(['b']) })

  expect(catchUp.total).toBe(3)
  // The thread with a question for the user leads, then the busiest one.
  expect(catchUp.lines.map(line => [line.thread, line.fresh, line.question])).toEqual([
    ['b', 1, true],
    ['a', 2, false]
  ])
  expect(catchUp.lines[1]?.delivered).toEqual(['write tokens'])
})

it('says nothing about threads that did not move', () => {
  const log = [msg('You', 'hi', 1, 'a'), msg('coder', 'hello', 2, 'a')]
  const items = roomWorkItems(log, { running: false, waitingThreads: new Set() })

  expect(roomCatchUp(log, 5, { escalations: [], handoffs: [], items, waiting: new Set() }).lines).toEqual([])
})
