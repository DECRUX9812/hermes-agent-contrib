import { expect, it } from 'vitest'

import {
  decidedLine,
  decideLine,
  deriveRoomVotes,
  parseDecisionLine,
  voteConsensus,
  voteLine
} from './group-room-votes'
import type { GroupMember, GroupMessage } from './types'

const user = (thread: string, text: string, at: number): GroupMessage => ({
  at,
  from: { kind: 'user', name: 'You' },
  text,
  thread
})

const bot = (thread: string, name: string, text: string, at: number): GroupMessage => ({
  at,
  from: { kind: 'member', name },
  text,
  thread
})

const TEAM = [{ name: 'coder' }, { name: 'plugin' }, { name: 'art' }] as GroupMember[]

it('reads the decision line back in the shape the composer sends it', () => {
  const line = decideLine('ship the rewrite or keep the old one?', ['ship', 'keep'])

  expect(parseDecisionLine(line)).toEqual({
    options: ['ship', 'keep'],
    question: 'ship the rewrite or keep the old one?'
  })
})

it('ignores anything that is not a decision line', () => {
  expect(parseDecisionLine('@coder handoff: unify replies · due: 30m')).toBeNull()
  expect(parseDecisionLine('decide later, tired')).toBeNull()
  expect(parseDecisionLine('')).toBeNull()
})

it('tallies picks said in plain words, last one wins, and passes never count', () => {
  const log = [
    user('a', decideLine('ship or keep?', ['ship', 'keep']), 1),
    bot('a', 'coder', 'ship it, the rewrite is cleaner', 2),
    bot('a', 'plugin', 'keep — the old one is battle tested', 3),
    bot('a', 'art', '(pass)', 4),
    // coder changes their mind after reading the pushback.
    bot('a', 'coder', voteLine('keep'), 5)
  ]

  const [vote] = deriveRoomVotes(log, TEAM)

  expect(vote).toMatchObject({
    decided: '',
    missing: ['art'],
    question: 'ship or keep?',
    thread: 'a',
    votes: { coder: 'keep', plugin: 'keep' }
  })
})

it('matches the longest option first, so "ship now" never votes for "ship"', () => {
  const log = [
    user('a', decideLine('which rollout?', ['ship', 'ship now', 'hold']), 1),
    bot('a', 'coder', 'ship now — waiting buys us nothing', 2)
  ]

  expect(deriveRoomVotes(log, TEAM)[0]!.votes).toEqual({ coder: 'ship now' })
})

it('only reads picks inside the decision’s own thread', () => {
  const log = [
    user('a', decideLine('ship or keep?', ['ship', 'keep']), 1),
    bot('b', 'coder', 'ship', 2),
    user('b', 'unrelated thread', 3)
  ]

  expect(deriveRoomVotes(log, TEAM)[0]!.votes).toEqual({})
})

it('reads the user’s call, typed by hand or sent by the card’s button', () => {
  const base = [user('a', decideLine('ship or keep?', ['ship', 'keep']), 1), bot('a', 'coder', 'ship', 2)]

  expect(deriveRoomVotes([...base, user('a', decidedLine('ship'), 3)], TEAM)[0]).toMatchObject({
    decided: 'ship',
    decidedIndex: 2
  })

  expect(
    deriveRoomVotes([...base, user('a', 'Decided: keep, the risk is not worth it now', 3)], TEAM)[0]
  ).toMatchObject({
    decided: 'keep',
    decidedIndex: 2
  })
})

it('reads where the team stands against everyone asked, not just the votes cast', () => {
  const of = (votes: Record<string, string>, missing: string[]) =>
    ({
      decided: '',
      missing,
      votes
    }) as never

  // Nothing cast yet.
  expect(voteConsensus(of({}, ['coder', 'plugin', 'art']), TEAM)).toBe('waiting')

  // All three agree, nobody left to ask.
  expect(voteConsensus(of({ coder: 'ship', plugin: 'ship', art: 'ship' }, []), TEAM)).toBe('unanimous')

  // 2 of 3 is a majority even though one is still missing.
  expect(voteConsensus(of({ coder: 'ship', plugin: 'ship' }, ['art']), TEAM)).toBe('majority')

  // A 1-1 tie is a split, not a majority.
  expect(voteConsensus(of({ coder: 'ship', plugin: 'keep' }, ['art']), TEAM)).toBe('split')

  // A 2-1 lead over three asked is a majority, not a split.
  expect(voteConsensus(of({ coder: 'ship', plugin: 'ship', art: 'keep' }, []), TEAM)).toBe('majority')
})
