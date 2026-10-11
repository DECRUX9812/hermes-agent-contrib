import { expect, it } from 'vitest'

import { roomWorkItems } from './group-room-work'
import type { GroupMessage } from './types'

const user = (thread: string, text: string, at: number): GroupMessage => ({
  at,
  from: { kind: 'user', name: 'You' },
  text,
  thread
})

const bot = (thread: string, name: string, at: number): GroupMessage => ({
  at,
  from: { kind: 'member', name },
  text: 'done',
  thread
})

it('reads each thread as a ticket: the ask, who is on it, and where it stands', () => {
  const log = [
    user('a', 'fix the header', 1),
    bot('a', 'coder', 2),
    bot('a', 'plugin', 3),
    user('b', 'ship the theme plugin', 4),
    user('c', 'which model should we use?', 5)
  ]

  const items = roomWorkItems(log, { running: true, waitingThreads: new Set(['b']) })

  // Needs-you first, then the live one, then the rest by recency.
  expect(items.map(item => [item.thread, item.status])).toEqual([
    ['b', 'waiting'],
    ['c', 'working'],
    ['a', 'answered']
  ])
  expect(items.find(item => item.thread === 'a')).toMatchObject({
    assignees: ['coder', 'plugin'],
    count: 3,
    lastIndex: 2,
    title: 'fix the header'
  })
})

it('calls a thread nobody has answered "open" once the room settles', () => {
  const [item] = roomWorkItems([user('a', 'anyone?', 1)], { running: false, waitingThreads: new Set() })

  expect(item?.status).toBe('open')
})
