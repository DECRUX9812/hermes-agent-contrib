import { describe, expect, it } from 'vitest'

import { SessionHub } from './sessions'
import { bootstrapContext } from './context'

const model = { id: 'deepseek-v4.1-flash', provider: 'opencode-go' }

const hub = () => {
  let t = Date.parse('2026-10-30T18:00:00Z')
  let n = 0

  return new SessionHub({
    maxActiveSessions: 2,
    nextId: () => `s-${++n}`,
    now: () => new Date((t += 1000)).toISOString()
  })
}

const ctx = () => ({
  ...bootstrapContext('orch-main'),
  constraints: ['no writes to the served tree'],
  facts: [{ id: 'f1', sourceEntry: 'ce-1', text: 'live commit 2f9269b01c' }],
  objective: 'ship the desktop fixes',
  revision: 7
})

const spec = (title = 'audit lane') => ({ scopedInstructions: 'read only', title })

describe('session hub', () => {
  it('gives each session a frozen snapshot of the context, not a handle', () => {
    const h = hub()
    const session = h.spawn(spec(), ctx(), model)
    expect(session.scopedContext.revision).toBe(7)
    expect(Object.isFrozen(session.scopedContext)).toBe(true)
    expect(Object.isFrozen(session.scopedContext.facts)).toBe(true)
    expect(() => (session.scopedContext as unknown as { objective: string }).objective = 'hacked').toThrow()
  })

  it('exposes exactly three capability methods, none of which write context', () => {
    const h = hub()
    const session = h.spawn(spec(), ctx(), model)
    const cap = h.capability(session.sessionId)
    expect(Object.keys(cap).sort()).toEqual(['emit', 'readScopedContext', 'return'])
    expect((cap as unknown as Record<string, unknown>).promote).toBeUndefined()
    expect((cap as unknown as Record<string, unknown>).writeContext).toBeUndefined()
  })

  it('enforces the active session cap', () => {
    const h = hub()
    h.spawn(spec('one'), ctx(), model)
    h.spawn(spec('two'), ctx(), model)
    expect(() => h.spawn(spec('three'), ctx(), model)).toThrow(/session cap/)
  })

  it('records the full lifecycle event trail', () => {
    const h = hub()
    const session = h.spawn(spec(), ctx(), model)
    const cap = h.capability(session.sessionId)
    cap.emit({ outcome: 'ok', payload: { tool: 'rg' }, type: 'tool.used' })
    cap.return({ result: 'found 3 issues', summary: { headline: 'audit done', result: 'found 3 issues' } })

    const types = h.eventsFor(session.sessionId).map(e => e.type)
    expect(types).toEqual(['session.started', 'tool.used', 'summary.ready'])
    expect(h.get(session.sessionId)?.status).toBe('done')
  })

  it('a completed session yields a pending summary that is not yet durable', () => {
    const h = hub()
    const session = h.spawn(spec(), ctx(), model)
    const summary = h.complete(session.sessionId, {
      result: 'shiki split landed',
      summary: { facts: [{ confidence: 0.9, text: 'JS down 44.7%' }], headline: 'shiki split', result: 'shiki split landed' }
    })
    expect(summary.promotion.state).toBe('pending')
    expect(summary.validation.state).toBe('valid')
  })

  it('cancelling produces a partial summary that can carry no decision', () => {
    const h = hub()
    const session = h.spawn(spec(), ctx(), model)
    const { session: after, summary } = h.cancel(session.sessionId, 'user stopped it')
    expect(after.status).toBe('cancelled')
    expect(after.statusReason).toBe('user stopped it')
    expect(summary?.partial).toBe(true)
    expect(summary?.decisionsNeeded).toEqual([])
    expect(h.eventsFor(session.sessionId).map(e => e.type)).toContain('session.cancelled')
  })

  it('sweeping turns a hung session into a timeout once the budget is blown', () => {
    const h = hub()
    const session = h.spawn({ ...spec(), budget: { maxWallS: 5 } }, ctx(), model)
    expect(h.sweep(Date.parse(session.startedAt!) + 1000)).toHaveLength(0)
    const timedOut = h.sweep(Date.parse(session.startedAt!) + 60_000)
    expect(timedOut.map(s => s.sessionId)).toEqual([session.sessionId])
    expect(h.get(session.sessionId)?.status).toBe('timeout')
  })

  it('a failed session is terminal and stops accepting activity', () => {
    const h = hub()
    const session = h.spawn(spec(), ctx(), model)
    const cap = h.capability(session.sessionId)
    h.fail(session.sessionId, 'gateway 500')
    const before = h.eventsFor(session.sessionId).length
    cap.emit({ outcome: 'ok', payload: { tool: 'late' }, type: 'tool.used' })
    expect(h.eventsFor(session.sessionId)).toHaveLength(before)
    expect(h.get(session.sessionId)?.status).toBe('failed')
  })

  it('describes the current action for the panel', () => {
    const h = hub()
    const session = h.spawn(spec(), ctx(), model)
    h.capability(session.sessionId).emit({ outcome: 'ok', payload: { tool: 'vitest' }, type: 'tool.used' })
    expect(h.view(session.sessionId).currentAction).toBe('running vitest')
    expect(h.view(session.sessionId).elapsedS).toBeGreaterThanOrEqual(0)
  })
})
