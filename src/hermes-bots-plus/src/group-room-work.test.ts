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

it('reads who is working on which thread from the members’ own room sessions', async () => {
  const { roomLiveWork } = await import('./group-room-work')
  const members = [{ name: 'coder' }, { name: 'plugin' }] as never

  // One session per member per thread; only live dots count.
  const live = roomLiveWork(
    { 'thread:a::coder': 's-coder-a', 'thread:b::plugin': 's-plugin-b', 'thread:b::coder': 's-coder-b' },
    { 's-coder-a': 'working', 's-plugin-b': 'idle', 's-coder-b': 'background' },
    members
  )

  expect([...live].map(([thread, names]) => [thread, [...names]])).toEqual([
    ['a', ['coder']],
    ['b', ['coder']]
  ])

  // The room round long settled, but coder is grinding in thread a: it reads as working.
  const [item] = roomWorkItems([user('a', 'fix it', 1), bot('a', 'coder', 2)], {
    live,
    running: false,
    waitingThreads: new Set()
  })

  expect(item).toMatchObject({ status: 'working', working: ['coder'] })
})
