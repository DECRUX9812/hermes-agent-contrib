import { describe, expect, it } from 'vitest'

import { deriveContextSpot, derivePanelRows, formatElapsed } from './panel'
import { bootstrapContext } from './context'
import { hygiene } from './hygiene'
import type { ActivityEvent, DurableContext, OrchestratorSession } from './types'

const NOW = Date.parse('2026-10-30T18:10:00Z')

const session = (over: Partial<OrchestratorSession> = {}): OrchestratorSession => ({
  budget: { maxToolCalls: 40, maxWallS: 900 },
  contextRevisionAtSpawn: 3,
  endedAt: null,
  model: { id: 'deepseek-v4.1-flash', provider: 'opencode-go' },
  scopedContext: { constraints: [], facts: [], objective: '', revision: 3 },
  scopedInstructions: 'read only',
  sessionId: 's-1',
  startedAt: '2026-10-30T18:00:00Z',
  status: 'running',
  statusReason: null,
  title: 'audit lane',
  workspace: { kind: 'none' },
  ...over
})

const ctx = (over: Partial<DurableContext> = {}): DurableContext => ({
  ...bootstrapContext('orch-main'),
  constraints: ['c1', 'c2', 'c3', 'c4', 'c5'],
  facts: [{ id: 'f1', sourceEntry: 'ce-1', text: 'a fact' }],
  objective: 'ship the desktop fixes',
  openDecisions: [
    { askedAt: '2026-10-30T17:00:00Z', id: 'd1', options: [], question: 'merge the WIP test?' },
    { askedAt: '2026-10-30T17:05:00Z', id: 'd2', options: [], question: 'ship now?' },
    { askedAt: '2026-10-30T17:06:00Z', id: 'd3', options: [], question: 'third one?' }
  ],
  revision: 9,
  tokenCount: 800,
  updatedAt: '2026-10-30T17:59:00Z',
  ...over
})

const event = (over: Partial<ActivityEvent> = {}): ActivityEvent => ({
  at: '2026-10-30T18:05:00Z',
  eventId: 'ev-1',
  outcome: 'ok',
  payload: {},
  sessionId: 's-1',
  type: 'session.started',
  ...over
})

describe('context spot', () => {
  it('caps constraints, decisions and glyphs but reports the overflow', () => {
    const view = deriveContextSpot(ctx(), [session(), session({ sessionId: 's-2' }), session({ sessionId: 's-3' }), session({ sessionId: 's-4' })])
    expect(view.constraints).toHaveLength(4)
    expect(view.moreConstraints).toBe(1)
    expect(view.pendingDecisions).toHaveLength(2)
    expect(view.moreDecisions).toBe(1)
    expect(view.active).toHaveLength(3)
    expect(view.activeCount).toBe(4)
  })

  it('ignores terminal sessions when counting what is active', () => {
    const view = deriveContextSpot(ctx(), [session(), session({ sessionId: 's-2', status: 'done' })])
    expect(view.activeCount).toBe(1)
  })

  it('surfaces the stale flag it is given and never invents one', () => {
    expect(deriveContextSpot(ctx(), [], { stale: true }).stale).toBe(true)
    expect(deriveContextSpot(ctx(), []).stale).toBe(false)
  })

  it('is empty only when the orchestrator knows nothing', () => {
    expect(deriveContextSpot(bootstrapContext('orch-main'), []).empty).toBe(true)
    expect(deriveContextSpot(ctx(), []).empty).toBe(false)
  })

  it('shows at most three recent promotions, newest first', () => {
    const entries = ['ce-1', 'ce-2', 'ce-3', 'ce-4'].map((id, i) => ({
      contentHash: id,
      contextId: 'ctx-orch-main',
      entryId: id,
      kind: 'fact' as const,
      provenance: { promotedAt: `2026-10-30T18:0${i}:00Z`, sessionId: 's-1', summaryId: `sm-${i}` },
      revisionAtPromotion: i,
      text: `promoted ${id}`
    }))
    const view = deriveContextSpot(ctx({ promoted: ['ce-1', 'ce-2', 'ce-3', 'ce-4'] }), [], { entries })
    expect(view.recentPromoted).toHaveLength(3)
    expect(view.recentPromoted[0].entryId).toBe('ce-4')
  })
})

describe('activity panel', () => {
  it('renders newest first with status labels and a failure badge', () => {
    const rows = derivePanelRows(
      [session({ sessionId: 's-1', title: 'first' }), session({ sessionId: 's-2', status: 'failed', statusReason: 'gateway 500', title: 'second' })],
      new Map(),
      [event({ payload: { tool: 'rg' }, type: 'tool.used' })],
      NOW
    )
    expect(rows[0].title).toBe('second')
    expect(rows[0].badge).toBe('failed')
    expect(rows[0].statusLabel).toBe('Failed')
    expect(rows[1].currentAction).toBe('running rg')
    expect(rows[1].canCancel).toBe(true)
    expect(rows[0].canCancel).toBe(false)
  })

  it('shows the summary headline, never the raw result', () => {
    const summary = hygiene('s-1', 'sm-1', { headline: 'audit done', result: '7 findings across 3 files' })
    const rows = derivePanelRows([session()], new Map([['s-1', summary]]), [], NOW)
    expect(rows[0].headline).toBe('audit done')
    expect(rows[0].hasSummary).toBe(true)
    expect(JSON.stringify(rows[0])).not.toContain('7 findings')
  })

  it('formats elapsed time human-first', () => {
    expect(formatElapsed(9)).toBe('9s')
    expect(formatElapsed(125)).toBe('2m 5s')
    expect(formatElapsed(7300)).toBe('2h 1m')
  })

  it('separation contract: the spot carries no transient action line', () => {
    const spot = deriveContextSpot(ctx(), [session()])
    // The spot may name an active session (a glyph), but it must never carry the
    // transient "what is it doing right now" line — that belongs to the panel.
    expect(Object.keys(spot)).not.toContain('currentAction')
    expect(JSON.stringify(spot)).not.toContain('running rg')
    const rows = derivePanelRows([session()], new Map(), [event({ payload: { tool: 'rg' }, type: 'tool.used' })], NOW)
    expect(rows[0].currentAction).toBe('running rg')
  })
})
