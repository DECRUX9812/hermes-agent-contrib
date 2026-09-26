import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HermesGateway } from '@/hermes'

import { $gateway } from './gateway'
import {
  $sessionAskPending,
  $sessionAskThreads,
  askSessionQuestion,
  clearSessionAskThread,
  dropSessionAskForProfile,
  migrateSessionAskForProfile,
  sessionAskKey,
  sessionAskPendingFor,
  sessionAskThreadFor,
  type SessionAskTurn
} from './session-ask'

const turn = (question: string, answer = `a:${question}`, extra: Partial<SessionAskTurn> = {}): SessionAskTurn => ({
  answer,
  askedAt: Date.now(),
  question,
  truncated: false,
  ...extra
})

describe('session-ask companion thread store', () => {
  beforeEach(() => {
    $sessionAskThreads.set({})
    $sessionAskPending.set({})
    $gateway.set(null)
  })

  it('keys threads by (profile, session) so profiles stay islands', () => {
    expect(sessionAskKey('work', 's1')).not.toBe(sessionAskKey('personal', 's1'))
    expect(sessionAskKey(null, 's1')).toBe(sessionAskKey(undefined, 's1'))
    expect(sessionAskKey(' work ', 's1')).toBe(sessionAskKey('work', 's1'))
  })

  it('rejects without a gateway or a question and never marks pending', async () => {
    await expect(askSessionQuestion(null, 's1', 'hi')).rejects.toThrow()
    await expect(askSessionQuestion(null, 's1', '  ')).rejects.toThrow()
    expect(sessionAskPendingFor(null, 's1')).toBe(false)
    expect(sessionAskThreadFor(null, 's1')).toEqual([])
  })

  it('appends the answered turn and replays prior pairs as history', async () => {
    const request = vi.fn(async () => ({
      answer: 'it wrote src/api.py',
      messages_considered: 4,
      resolved_id: 's1',
      truncated: false
    }))

    $gateway.set({ request } as unknown as HermesGateway)

    $sessionAskThreads.set({ [sessionAskKey('work', 's1')]: [turn('first q')] })
    const saved = await askSessionQuestion('work', 's1', 'and the tests?')

    expect(saved.answer).toBe('it wrote src/api.py')
    const [method, params] = request.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(method).toBe('session.ask')
    expect(params.session_id).toBe('s1')
    expect(params.history).toEqual([{ answer: 'a:first q', question: 'first q' }])
    expect(sessionAskThreadFor('work', 's1')).toHaveLength(2)
    // Islands: another profile sees no thread for the same session id.
    expect(sessionAskThreadFor('personal', 's1')).toEqual([])
    expect(sessionAskPendingFor('work', 's1')).toBe(false)
  })

  it('clears pending and keeps the thread when the RPC fails', async () => {
    $gateway.set({
      request: vi.fn(async () => {
        throw new Error('session.ask failed')
      })
    } as unknown as HermesGateway)

    await expect(askSessionQuestion(null, 's1', 'why?')).rejects.toThrow('session.ask failed')
    expect(sessionAskPendingFor(null, 's1')).toBe(false)
    expect(sessionAskThreadFor(null, 's1')).toEqual([])
  })

  it('rejects a second ask while one is in flight', async () => {
    let resolveRequest: (value: unknown) => void = () => undefined
    $gateway.set({
      request: vi.fn(() => new Promise(resolve => (resolveRequest = resolve)))
    } as unknown as HermesGateway)

    const inFlight = askSessionQuestion(null, 's1', 'first?')
    await expect(askSessionQuestion(null, 's1', 'second?')).rejects.toThrow('already in flight')
    resolveRequest({ answer: 'ok', messages_considered: 1, resolved_id: 's1', truncated: false })
    await expect(inFlight).resolves.toMatchObject({ answer: 'ok' })
    expect(sessionAskPendingFor(null, 's1')).toBe(false)
  })

  it('re-homes threads on a local profile rename and drops them on delete', () => {
    $sessionAskThreads.set({
      [sessionAskKey('old', 's1')]: [turn('q1')],
      [sessionAskKey('old', 's2')]: [turn('q2')],
      [sessionAskKey('other', 's3')]: [turn('q3')]
    })

    migrateSessionAskForProfile('old', 'new')
    expect(sessionAskThreadFor('new', 's1')).toHaveLength(1)
    expect(sessionAskThreadFor('old', 's1')).toEqual([])
    expect(sessionAskThreadFor('other', 's3')).toHaveLength(1)

    dropSessionAskForProfile('new')
    expect(sessionAskThreadFor('new', 's1')).toEqual([])
    expect(sessionAskThreadFor('new', 's2')).toEqual([])
    expect(sessionAskThreadFor('other', 's3')).toHaveLength(1)

    // A remote-scoped delete must not reach the local keys.
    $sessionAskThreads.set({ [sessionAskKey('work', 's4')]: [turn('q4')] })
    dropSessionAskForProfile('work', { connectionId: 'homelab', profile: 'work' })
    expect(sessionAskThreadFor('work', 's4')).toHaveLength(1)
  })

  it('clears only the target thread', () => {
    $sessionAskThreads.set({
      [sessionAskKey(null, 's1')]: [turn('q1')],
      [sessionAskKey(null, 's2')]: [turn('q2')]
    })
    clearSessionAskThread(null, 's1')
    expect(sessionAskThreadFor(null, 's1')).toEqual([])
    expect(sessionAskThreadFor(null, 's2')).toHaveLength(1)
  })
})
