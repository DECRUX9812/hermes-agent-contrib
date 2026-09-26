import { beforeEach, describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/hermes'

import { $sessions } from './session'
import { $sessionRecapDismissedIds, dismissSessionRecap, isSessionRecapDismissed } from './session-recap'

const row = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo =>
  ({ id, message_count: 1, source: 'cli', started_at: 0, title: id, ...extra }) as SessionInfo

beforeEach(() => {
  window.localStorage.clear()
  $sessionRecapDismissedIds.set([])
  $sessions.set([])
})

describe('session recap dismissal', () => {
  it('stores the durable lineage root so dismissal survives compression', () => {
    $sessions.set([row('root'), row('tip', { _lineage_root_id: 'root', _lineage_ids: ['root', 'tip'] })])

    dismissSessionRecap('tip')

    expect($sessionRecapDismissedIds.get()).toEqual(['root'])
    expect(isSessionRecapDismissed('tip')).toBe(true)
    expect(isSessionRecapDismissed('root')).toBe(true)
    expect(isSessionRecapDismissed('other')).toBe(false)
  })

  it('persists under the connection-scoped localStorage key', () => {
    dismissSessionRecap('session-a')

    expect(window.localStorage.getItem('chat.recapDismissedSessionIds')).toBe('["session-a"]')
  })

  it('is idempotent and resolves ids missing from the loaded list', () => {
    dismissSessionRecap('gone')
    dismissSessionRecap('gone')

    expect($sessionRecapDismissedIds.get()).toEqual(['gone'])
    expect(isSessionRecapDismissed('gone')).toBe(true)
  })
})
