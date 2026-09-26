import { beforeEach, describe, expect, it } from 'vitest'

import { createClientSessionState } from '@/lib/chat-runtime'
import type { SessionInfo } from '@/types/hermes'

import { $pinnedSessionIds } from './layout'
import {
  $unreadFinishedSessionIds,
  setCronSessions,
  setMessagingSessions,
  setSessions
} from './session'
import { finishedSessionIds, idleOlderThanSessionIds } from './session-bulk-archive'
import { clearAllSessionStates, publishSessionState } from './session-states'

const DAY_S = 86_400

function session(id: string, over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    archived: false,
    cwd: null,
    ended_at: null,
    id,
    input_tokens: 0,
    is_active: false,
    last_active: 1_800_000_000,
    message_count: 2,
    model: null,
    output_tokens: 0,
    preview: null,
    source: null,
    started_at: 1_800_000_000,
    title: id,
    tool_call_count: 0,
    ...over
  }
}

beforeEach(() => {
  setSessions([])
  setMessagingSessions([])
  setCronSessions([])
  $unreadFinishedSessionIds.set([])
  $pinnedSessionIds.set([])
  clearAllSessionStates()
})

describe('finishedSessionIds', () => {
  it('takes the idle rows across all three rail pools', () => {
    setSessions([session('s1')])
    setMessagingSessions([session('m1')])
    setCronSessions([session('c1')])

    expect(finishedSessionIds().sort()).toEqual(['c1', 'm1', 's1'])
  })

  it('keeps the unseen-result signal out of the sweep', () => {
    setSessions([session('read'), session('unseen')])
    $unreadFinishedSessionIds.set(['unseen'])

    expect(finishedSessionIds()).toEqual(['read'])
  })

  it('never sweeps a pinned or live session', () => {
    setSessions([session('pinned'), session('busy'), session('done')])
    $pinnedSessionIds.set(['pinned'])
    publishSessionState('rt-busy', { ...createClientSessionState('busy'), busy: true })

    expect(finishedSessionIds()).toEqual(['done'])
  })

  it('honors the server-side pin flag, not only the local hint', () => {
    setSessions([session('pinned', { pinned: true }), session('plain')])

    expect(finishedSessionIds()).toEqual(['plain'])
  })
})

describe('idleOlderThanSessionIds', () => {
  it('applies the age cutoff to last activity', () => {
    const nowMs = 1_800_000_000_000
    setSessions([
      session('fresh', { last_active: nowMs / 1000 - DAY_S }),
      session('stale', { last_active: nowMs / 1000 - 40 * DAY_S })
    ])

    expect(idleOlderThanSessionIds(30, nowMs)).toEqual(['stale'])
  })

  it('falls back to started_at when the row was never active', () => {
    const nowMs = 1_800_000_000_000
    setSessions([session('old', { last_active: 0, started_at: nowMs / 1000 - 60 * DAY_S })])

    expect(idleOlderThanSessionIds(30, nowMs)).toEqual(['old'])
    expect(idleOlderThanSessionIds(90, nowMs)).toEqual([])
  })
})
