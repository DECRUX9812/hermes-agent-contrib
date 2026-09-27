/**
 * Per-owner attention counts — the projection Bot Mode's roster badge reads.
 *
 * Two invariants are pinned:
 *  - attribution follows the SESSION'S proven owner, never the ambient
 *    gateway — two connections can both expose a profile named 'ops';
 *  - one conversation counts once, however many stored ids (compression
 *    lineage aliases) its claim is published under.
 */

import { describe, expect, it } from 'vitest'

import type { AttentionItem } from './attention-inbox'
import { collectAttentionCounts, ownerScopeKey } from './attention-owner-counts'
import type { SessionOwnerScope } from './session-request-router'

const item = (kind: AttentionItem['kind'], sessionId: null | string, index = 0): AttentionItem => ({
  id: `${kind}:${sessionId ?? ''}:${index}`,
  kind,
  sessionId,
  title: 'something needs you'
})

// A compressed conversation: s2 is the live tip of the lineage rooted at s1.
const lineageSessions = [
  { id: 's2', _lineage_ids: ['s1', 's2'], _lineage_root_id: 's1' },
  { id: 's1', _lineage_ids: ['s1', 's2'] }
]

describe('ownerScopeKey', () => {
  it('keeps an explicit connection in the key and leaves bare profiles bare', () => {
    expect(ownerScopeKey({ connectionId: 'ssh-1', profile: 'ops' })).toBe('conn:ssh-1::ops')
    expect(ownerScopeKey({ connectionId: 'local', profile: 'ops' })).toBe('conn:local::ops')
    expect(ownerScopeKey({ connectionId: 'ssh-1', profile: 'ops', targetProfile: 'ops-2' })).toBe('conn:ssh-1::ops-2')
    expect(ownerScopeKey('ops')).toBe('ops')
    expect(ownerScopeKey(null)).toBeNull()
    expect(ownerScopeKey(undefined)).toBeNull()
  })
})

describe('collectAttentionCounts', () => {
  it('attributes inbox items to the session owner, skipping app-level rows', () => {
    const resolveOwner = (id: string): SessionOwnerScope =>
      id === 'rt-1' ? { connectionId: 'ssh-1', profile: 'ops' } : id === 'rt-2' ? 'ops' : undefined

    const counts = collectAttentionCounts({
      dotById: {},
      items: [item('approval', 'rt-1'), item('clarify', 'rt-2'), item('sudo', null)],
      resolveOwner,
      sessions: [],
      storedIdForRuntime: () => null
    })

    expect(counts['conn:ssh-1::ops']).toBe(1)
    expect(counts.ops).toBe(1)
    // The app-level (sessionId=null) item can never be attributed — it must
    // not land on any owner.
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('never attributes an unresolvable owner instead of guessing', () => {
    const counts = collectAttentionCounts({
      dotById: { ghost: 'unread' },
      items: [item('approval', 'rt-x')],
      resolveOwner: () => undefined,
      sessions: [],
      storedIdForRuntime: () => null
    })

    expect(counts).toEqual({})
  })

  it('counts one unread per conversation, not per lineage alias', () => {
    const counts = collectAttentionCounts({
      // The claim lands on EVERY alias of the lineage — two keys, one chat.
      dotById: { s1: 'unread', s2: 'unread' },
      items: [],
      resolveOwner: () => 'ops',
      sessions: lineageSessions,
      storedIdForRuntime: () => null
    })

    expect(counts.ops).toBe(1)
  })

  it('does not double count a needs-input the inbox already itemized', () => {
    const counts = collectAttentionCounts({
      dotById: { s9: 'needs-input' },
      items: [item('clarify', 'rt-9')],
      resolveOwner: id => (id === 'rt-9' || id === 's9' ? 'ops' : undefined),
      sessions: [],
      storedIdForRuntime: id => (id === 'rt-9' ? 's9' : null)
    })

    expect(counts.ops).toBe(1)
  })

  it('keeps a needs-input with no itemized request', () => {
    const counts = collectAttentionCounts({
      dotById: { s9: 'needs-input' },
      items: [],
      resolveOwner: () => 'ops',
      sessions: [],
      storedIdForRuntime: () => null
    })

    expect(counts.ops).toBe(1)
  })
})
