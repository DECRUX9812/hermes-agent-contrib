import { describe, expect, it } from 'vitest'

import { applyEntry, ContextStore, projectContext } from './context'
import { hygiene } from './hygiene'
import type { ContextEntry, DurableContext } from './types'

const clock = () => {
  let t = Date.parse('2026-10-30T18:00:00Z')

  return { now: () => new Date((t += 1000)).toISOString() }
}

const store = () => {
  const { now } = clock()
  let n = 0

  return new ContextStore(
    { ...baseContext() },
    { nextEntryId: () => `ce-${++n}`, now }
  )
}

const baseContext = (): DurableContext => ({
  constraints: [],
  contextId: 'ctx-orch-main',
  facts: [],
  objective: '',
  openDecisions: [],
  promoted: [],
  profileId: 'orch-main',
  revision: 0,
  tokenCount: 0,
  updatedAt: null
})

const summaryOf = (result: string, extra: Record<string, unknown> = {}) =>
  hygiene('s-1', `sm-${result}`, { facts: [], headline: result, result, ...extra })

describe('durable context', () => {
  it('promotes a summary and bumps the revision by exactly one', () => {
    const s = store()
    const res = s.promote(summaryOf('shiki 44.7% smaller'))
    expect(res).toMatchObject({ state: 'promoted', revision: 1 })
    expect(s.value().promoted).toEqual(['ce-1'])
    expect(s.value().facts[0].text).toContain('shiki')
  })

  it('is idempotent: the same summary twice yields one entry', () => {
    const s = store()
    const summary = summaryOf('same result text')
    expect(s.promote(summary).state).toBe('promoted')
    const second = s.promote(summary)
    expect(second).toMatchObject({ state: 'duplicate', entryId: 'ce-1' })
    expect(s.value().revision).toBe(1)
    expect(s.value().facts).toHaveLength(1)
  })

  it('rejects a promotion whose CAS token is stale', () => {
    const s = store()
    s.promote(summaryOf('first'))
    const stale = s.promote(summaryOf('second'), { expectedRevision: 0 })
    expect(stale).toMatchObject({ state: 'conflict', currentRevision: 1 })
    expect(s.value().facts).toHaveLength(1)
  })

  it('refuses to promote an unvalidated summary', () => {
    const s = store()
    const empty = hygiene('s-1', 'sm-x', { result: '' })
    expect(s.promote(empty)).toMatchObject({ state: 'rejected' })
    expect(s.value().revision).toBe(0)
  })

  it('does not duplicate a constraint that already exists', () => {
    const s = store()
    const ctx = baseContext()
    const mk = (id: string, text: string): ContextEntry => ({
      contentHash: id,
      contextId: ctx.contextId,
      entryId: id,
      kind: 'constraint',
      provenance: { promotedAt: '2026-10-30T18:00:00Z', sessionId: 's', summaryId: id },
      revisionAtPromotion: 0,
      text
    })
    const once = applyEntry(ctx, mk('ce-a', 'no writes to the served tree'), s.policyView)
    const twice = applyEntry(once, mk('ce-b', 'No writes to the served tree'), s.policyView)
    expect(twice.constraints).toEqual(['no writes to the served tree'])
  })

  it('a promoted decision closes the matching open question', () => {
    const s = store()
    const ctx = baseContext()
    const withQuestion: DurableContext = {
      ...ctx,
      openDecisions: [{ askedAt: '2026-10-30T17:00:00Z', id: 'd1', options: ['a', 'b'], question: 'merge the WIP test?' }]
    }
    const resolved = applyEntry(
      withQuestion,
      {
        contentHash: 'h',
        contextId: ctx.contextId,
        decisionId: 'd1',
        entryId: 'ce-d',
        kind: 'decision',
        provenance: { promotedAt: '2026-10-30T18:00:00Z', sessionId: 's', summaryId: 'sm' },
        revisionAtPromotion: 0,
        text: 'decided: no'
      },
      s.policyView
    )
    expect(resolved.openDecisions).toHaveLength(0)
  })

  it('flags a context older than its TTL', () => {
    const s = store()
    s.promote(summaryOf('something promoted now'))
    expect(s.isStale(Date.parse(s.value().updatedAt!))).toBe(false)
    expect(s.isStale(Date.parse(s.value().updatedAt!) + 721 * 3_600_000)).toBe(true)
  })

  it('hands out a copy, never a live handle', () => {
    const s = store()
    s.promote(summaryOf('objective-ish result', { facts: [{ text: 'a fact' }] }))
    const scoped = projectContext(s.value(), { facts: 5 })
    scoped.facts.push('injected by a sub-agent')
    expect(s.value().facts.map(f => f.text)).not.toContain('injected by a sub-agent')
  })
})
