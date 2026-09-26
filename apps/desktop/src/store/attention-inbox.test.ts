import { beforeEach, describe, expect, it } from 'vitest'

import { $pendingAttentionReveal, collectAttentionItems, requestAttentionReveal, takeAttentionReveal } from './attention-inbox'
import type { NotificationHistoryEntry } from './notifications'

const emptySources = {
  approvals: {},
  clarify: {},
  errors: [] as NotificationHistoryEntry[],
  secrets: {},
  sudo: {},
  vaultCode: {},
  vaultSave: {},
  vaultUnlock: {}
}

const errorEntry = (overrides: Partial<NotificationHistoryEntry>): NotificationHistoryEntry => ({
  createdAt: 1,
  id: 'n1',
  kind: 'error',
  message: 'turn failed',
  sessionId: 'sess-1',
  ...overrides
})

describe('collectAttentionItems', () => {
  it('is empty when no source has anything pending', () => {
    expect(collectAttentionItems(emptySources)).toEqual([])
  })

  it('flattens every entry of an approval queue, not just the head', () => {
    const items = collectAttentionItems({
      ...emptySources,
      approvals: {
        'sess-1': [
          { command: 'rm -rf build', description: 'delete build dir', requestId: 'a1', sessionId: 'sess-1' },
          { command: 'npm publish', description: 'publish package', requestId: 'a2', sessionId: 'sess-1' }
        ]
      }
    })

    expect(items).toHaveLength(2)
    expect(items.map(item => item.title)).toEqual(['rm -rf build', 'npm publish'])
    expect(items[0]?.kind).toBe('approval')
  })

  it('collects every pending request kind', () => {
    const items = collectAttentionItems({
      ...emptySources,
      clarify: {
        'sess-2': { choices: ['a', 'b'], multiSelect: false, question: 'which?', requestId: 'c1', sessionId: 'sess-2' }
      },
      secrets: {
        'sess-1': { envVar: 'OPENAI_API_KEY', prompt: 'paste key', requestId: 's1', sessionId: 'sess-1' }
      },
      sudo: { 'sess-1': { command: 'brew install jq', requestId: 'u1', sessionId: 'sess-1' } },
      vaultCode: { 'sess-1': { hint: 'check SMS', requestId: 'vc1', sessionId: 'sess-1', site: 'bank.com' } },
      vaultSave: { 'sess-1': { origin: 'https://x', requestId: 'vs1', sessionId: 'sess-1', site: 'x.com' } },
      vaultUnlock: { 'sess-1': { backend: '1password', displayName: '1Password', requestId: 'vu1', sessionId: 'sess-1' } }
    })

    expect(items.map(item => item.kind)).toEqual([
      'clarify',
      'sudo',
      'secret',
      'vault-unlock',
      'vault-save',
      'vault-code'
    ])
    expect(items.map(item => item.id)).toEqual([
      'clarify:sess-2:c1',
      'sudo:sess-1:u1',
      'secret:sess-1:s1',
      'vault-unlock:sess-1:vu1',
      'vault-save:sess-1:vs1',
      'vault-code:sess-1:vc1'
    ])
  })

  it('keeps app-level prompts with a null sessionId', () => {
    const items = collectAttentionItems({
      ...emptySources,
      sudo: { '': { requestId: 'u1', sessionId: null } }
    })

    expect(items).toEqual([
      expect.objectContaining({ id: 'sudo::u1', kind: 'sudo', sessionId: null })
    ])
  })

  it('lists session-scoped error notices, deduped, newest first — after pendings', () => {
    const items = collectAttentionItems({
      ...emptySources,
      // Newest-first, mirroring $notificationHistory's ordering.
      errors: [
        errorEntry({ createdAt: 6, id: 'n6', message: 'other session', sessionId: 'sess-2' }),
        errorEntry({ createdAt: 5, id: 'n5', message: 'global', sessionId: null }),
        errorEntry({ createdAt: 4, id: 'n4', kind: 'info', message: 'not an error' }),
        errorEntry({ createdAt: 3, id: 'n3', message: 'second' }),
        errorEntry({ createdAt: 2, id: 'n2', message: 'first' }),
        errorEntry({ createdAt: 1, id: 'n1', message: 'first' }) // older dup of n2
      ],
      approvals: {
        'sess-9': [{ command: 'x', description: 'y', requestId: 'a1', sessionId: 'sess-9' }]
      }
    })

    expect(items.map(item => item.kind)).toEqual(['approval', 'error', 'error', 'error'])
    expect(items.slice(1).map(item => item.title)).toEqual(['other session', 'second', 'first'])
  })

  it('falls back to the message as title when an error has none', () => {
    const items = collectAttentionItems({
      ...emptySources,
      errors: [errorEntry({ title: 'LLM timeout' })]
    })

    expect(items[0]).toEqual(
      expect.objectContaining({ detail: 'turn failed', title: 'LLM timeout' })
    )
  })
})

describe('pending attention reveal', () => {
  beforeEach(() => {
    $pendingAttentionReveal.set(null)
  })

  it('is consumed by the session it names, once', () => {
    requestAttentionReveal('sess-1')

    expect(takeAttentionReveal('sess-1')).toBe(true)
    expect(takeAttentionReveal('sess-1')).toBe(false)
  })

  it('does not fire for other sessions or empty ids', () => {
    requestAttentionReveal('sess-1')

    expect(takeAttentionReveal('sess-2')).toBe(false)
    expect(takeAttentionReveal(null)).toBe(false)
    expect($pendingAttentionReveal.get()?.sessionId).toBe('sess-1')
  })

  it('a newer request replaces an unconsumed one', () => {
    requestAttentionReveal('sess-1')
    requestAttentionReveal('sess-2')

    expect(takeAttentionReveal('sess-1')).toBe(false)
    expect(takeAttentionReveal('sess-2')).toBe(true)
  })
})
