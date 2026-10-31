import { describe, expect, it } from 'vitest'

import { panelRowsFromSubagents, spotFromContext, type SubagentLike } from './adapter'
import { spotState } from './panel'
import { bootstrapContext } from './context'

const NOW = Date.parse('2026-10-30T18:10:00Z')

const worker = (over: Partial<SubagentLike> = {}): SubagentLike => ({
  goal: 'audit the composer',
  id: 'sa-1',
  startedAt: NOW - 90_000,
  status: 'running',
  ...over
})

describe('subagent adapter', () => {
  it('maps the live store shape onto panel rows', () => {
    const rows = panelRowsFromSubagents([worker({ currentTool: 'rg' })], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      canCancel: true,
      currentAction: 'running rg',
      index: 1,
      status: 'running',
      statusLabel: 'Running',
      title: 'audit the composer'
    })
    expect(rows[0].elapsedLabel).toBe('1m 30s')
  })

  it('gives terminal rows a badge and no cancel affordance', () => {
    const rows = panelRowsFromSubagents(
      [
        worker({ id: 'a', status: 'failed', updatedAt: NOW }),
        worker({ id: 'b', status: 'interrupted', updatedAt: NOW }),
        worker({ id: 'c', status: 'completed', summary: 'done: 3 findings', updatedAt: NOW })
      ],
      NOW
    )
    expect(rows.map(r => r.badge)).toEqual(['failed', 'cancelled', null])
    expect(rows.every(r => r.canCancel === false)).toBe(true)
    expect(rows[2].headline).toBe('done: 3 findings')
    expect(rows[2].currentAction).toBe('returned a summary')
  })

  it('keeps only the first summary line and caps it', () => {
    const rows = panelRowsFromSubagents([worker({ status: 'completed', summary: `first line\nsecond line` })], NOW)
    expect(rows[0].headline).toBe('first line')
    const long = panelRowsFromSubagents([worker({ status: 'completed', summary: 'x'.repeat(400) })], NOW)
    expect(long[0].headline.length).toBeLessThanOrEqual(140)
  })

  it('falls back to an indexed title for an untitled worker', () => {
    expect(panelRowsFromSubagents([worker({ goal: '' })], NOW)[0].title).toBe('Worker #1')
  })
})

describe('spot state', () => {
  const ready = spotFromContext({ ...bootstrapContext('local'), objective: 'ship it', revision: 1 })

  it('treats a missing or empty context as an explicit empty state', () => {
    expect(spotState(null)).toBe('empty')
    expect(spotState(spotFromContext(bootstrapContext('local')))).toBe('empty')
  })

  it('reports error ahead of everything else', () => {
    expect(spotState(ready, 'gateway unreachable')).toBe('error')
  })

  it('is ready once the orchestrator knows something', () => {
    expect(spotState(ready)).toBe('ready')
  })
})
