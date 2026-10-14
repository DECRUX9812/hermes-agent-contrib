import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { collectOverviewCards } from './collector'

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    last_active: 1_000,
    title: `Session ${id}`,
    ...overrides
  } as SessionInfo
}

const EMPTY = {
  attentionSessionIds: [],
  dotStates: {},
  finishedSessionIds: [],
  openSessionIds: [],
  sessions: [],
  workingSessionIds: []
} as const

describe('collectOverviewCards', () => {
  it('orders needs-you before working before done', () => {
    const cards = collectOverviewCards({
      ...EMPTY,
      attentionSessionIds: ['needs'],
      dotStates: { done: 'idle', needs: 'needs-input', work: 'working' },
      finishedSessionIds: ['done'],
      sessions: [session('needs'), session('work'), session('done')],
      workingSessionIds: ['work']
    })

    expect(cards).toHaveLength(3)
    expect(cards.map(card => card.storedSessionId)).toEqual(['needs', 'work', 'done'])
    expect(cards.map(card => card.group)).toEqual(['needs-you', 'working', 'done'])
    expect(cards[0]).toEqual({ group: 'needs-you', storedSessionId: 'needs', title: 'Session needs' })
    expect(cards[2]).toEqual({ group: 'done', storedSessionId: 'done', title: 'Session done' })
  })

  it('sorts the most recently active first within a group', () => {
    const cards = collectOverviewCards({
      ...EMPTY,
      dotStates: { a: 'working', b: 'working', c: 'working' },
      sessions: [
        session('a', { last_active: 100 }),
        session('b', { last_active: 300 }),
        session('c', { last_active: 200 })
      ],
      workingSessionIds: ['a', 'b', 'c']
    })

    expect(cards).toHaveLength(3)
    expect(cards.map(card => card.storedSessionId)).toEqual(['b', 'c', 'a'])
    expect(cards.every(card => card.group === 'working')).toBe(true)
  })

  it('de-duplicates lineage aliases to a single card', () => {
    const sessions = [
      session('new-id', { _lineage_ids: ['old-id'], _lineage_root_id: 'old-id' }),
      session('old-id', { _lineage_root_id: 'old-id' })
    ]

    const cards = collectOverviewCards({
      ...EMPTY,
      dotStates: { 'new-id': 'working', 'old-id': 'working' },
      sessions,
      workingSessionIds: ['old-id', 'new-id']
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]?.group).toBe('working')
    expect(cards[0]?.title).toBe('Session new-id')
  })

  it('includes sessions finished this run and sessions open in a pane', () => {
    const cards = collectOverviewCards({
      ...EMPTY,
      dotStates: { finished: 'unread', open: 'idle', selected: 'idle' },
      finishedSessionIds: ['finished'],
      openSessionIds: ['open', 'selected', null, undefined],
      sessions: [session('finished'), session('open'), session('selected')]
    })

    expect(cards).toHaveLength(3)
    expect(cards.map(card => card.storedSessionId).sort()).toEqual(['finished', 'open', 'selected'])
    expect(cards.find(card => card.storedSessionId === 'finished')?.group).toBe('done')
    expect(cards.every(card => card.title.startsWith('Session '))).toBe(true)
  })

  it('falls back to the id when no session row exists', () => {
    const cards = collectOverviewCards({ ...EMPTY, workingSessionIds: ['ghost'] })

    expect(cards).toHaveLength(1)
    expect(cards).toEqual([{ group: 'done', storedSessionId: 'ghost', title: 'ghost' }])
  })

  it('returns nothing when every list is empty', () => {
    expect(collectOverviewCards({ ...EMPTY, sessions: [session('idle')] })).toEqual([])
  })
})
