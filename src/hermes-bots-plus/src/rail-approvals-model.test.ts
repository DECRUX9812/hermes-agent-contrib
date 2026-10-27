import { describe, expect, it, vi } from 'vitest'

import {
  decideJournal,
  isMissingMethod,
  journalView,
  listJournal,
  outcomeTone,
  type JournalRow,
  withoutJournalled
} from './rail-approvals-model'

const row = (id: string, status: string, at = 1): JournalRow => ({
  command: `cmd ${id}`,
  created_at: at,
  decided_at: status === 'pending' ? null : at + 1,
  request_id: id,
  status
})

const missing = Object.assign(new Error('unknown method: fork.approvals.list'), { code: -32601 })

describe('rail approvals journal', () => {
  it('lists rows for the stored session and says null when the gateway keeps no journal', async () => {
    const request = vi.fn(async () => ({ approvals: [row('a', 'pending'), { status: 'pending' }] }))
    await expect(listJournal(request as never, 'stored-1')).resolves.toEqual([row('a', 'pending')])
    expect(request).toHaveBeenCalledWith('fork.approvals.list', { session_id: 'stored-1' })

    const old = vi.fn(async () => Promise.reject(missing))
    await expect(listJournal(old as never, 'stored-1')).resolves.toBeNull()

    const broken = vi.fn(async () => Promise.reject(new Error('socket closed')))
    await expect(listJournal(broken as never, 'stored-1')).rejects.toThrow('socket closed')
  })

  it('decides through the journal and keeps the recorded row', async () => {
    const recorded = { ...row('a', 'allowed'), choice: 'once' as const }
    const request = vi.fn(async () => ({ approval: recorded, resolved: true }))
    const ids = { requestId: 'a', runtimeSessionId: 'rt-1', storedSessionId: 'stored-1' }

    await expect(decideJournal(request as never, ids, 'once')).resolves.toEqual({
      approval: recorded,
      choice: 'once',
      resolved: true
    })
    expect(request).toHaveBeenCalledWith('fork.approvals.decide', {
      choice: 'once',
      request_id: 'a',
      session_id: 'stored-1'
    })
  })

  it('falls back to the stock respond RPC on a gateway without the journal', async () => {
    const request = vi.fn(async (method: string) => (method === 'fork.approvals.decide' ? Promise.reject(missing) : {}))
    const ids = { requestId: 'a', runtimeSessionId: 'rt-1', storedSessionId: 'stored-1' }

    await expect(decideJournal(request as never, ids, 'deny')).resolves.toEqual({ choice: 'deny', resolved: true })
    expect(request).toHaveBeenLastCalledWith('approval.respond', {
      all: false,
      choice: 'deny',
      request_id: 'a',
      session_id: 'rt-1'
    })
    await expect(decideJournal(request as never, { ...ids, runtimeSessionId: null }, 'deny')).rejects.toBe(missing)
  })

  it('orders waiting rows oldest first and settled rows newest first, capped', () => {
    const rows = [row('p2', 'pending', 5), row('p1', 'pending', 2), ...[1, 2, 3, 4, 5, 6].map(n => row(`d${n}`, 'denied', n))]
    const view = journalView(rows, new Set(['p2']))

    expect(view.pending.map(r => r.request_id)).toEqual(['p1'])
    expect(view.recent.map(r => r.request_id)).toEqual(['d6', 'd5', 'd4', 'd3', 'd2'])
  })

  it('drops attention items the journal already shows and keeps other kinds', () => {
    const items = [
      { id: 'approval:a', kind: 'approval' },
      { id: 'b', kind: 'approval' },
      { id: 'c', kind: 'clarify' }
    ]

    expect(withoutJournalled(items, [row('a', 'pending')]).map(i => i.id)).toEqual(['b', 'c'])
    expect(withoutJournalled(items, null)).toHaveLength(3)
  })

  it('reads error shapes and outcome tones', () => {
    expect(isMissingMethod({ message: 'Method not found' })).toBe(true)
    expect(isMissingMethod(new Error('timeout'))).toBe(false)
    expect(outcomeTone(row('a', 'allowed'))).toBe('ok')
    expect(outcomeTone(row('a', 'denied'))).toBe('bad')
    expect(outcomeTone(row('a', 'expired'))).toBe('muted')
  })
})
