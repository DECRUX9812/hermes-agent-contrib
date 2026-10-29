import { describe, expect, it } from 'vitest'

import {
  mergeUsage,
  SESSION_CONTEXT_USAGE_KEYS,
  SESSION_SCOPED_USAGE_KEYS,
  SESSION_VOLATILE_USAGE_KEYS,
  sessionScopedUsageLayer
} from './usage-tick.js'

interface StoredUsage {
  active_subagents?: number
  avg_latency_s?: number
  avg_tps?: number
  cache_hit_pct?: number
  calls: number
  compressions?: number
  context_percent?: number
  context_used?: number
  cost_usd?: number
  input: number
  output: number
  plan_gauge?: { id: string; label: string; used_bp: number }
  total: number
}

const STORED: StoredUsage = {
  avg_tps: 42.1,
  cache_hit_pct: 87,
  calls: 14,
  compressions: 1,
  context_percent: 21,
  context_used: 42_000,
  cost_usd: 0.31,
  input: 1000,
  output: 200,
  plan_gauge: { id: 'day', label: 'Daily', used_bp: 100 },
  total: 1200
}

describe('sessionScopedUsageLayer', () => {
  it('covers every session-scoped field the snapshot can omit', () => {
    // The Python builders omit absent figures rather than sending zeros
    // (`tui_usage` docstring). Volatile fields are runtime-derived — they
    // cannot outlive the agent that produced them; context fields are the
    // session's own persisted occupancy and only a switch clears them.
    // If a new session-scoped field joins the wire it joins a list, or it
    // leaks across sessions like #146430.
    expect(SESSION_SCOPED_USAGE_KEYS).toEqual(
      expect.arrayContaining([...SESSION_VOLATILE_USAGE_KEYS, ...SESSION_CONTEXT_USAGE_KEYS])
    )
    expect(SESSION_VOLATILE_USAGE_KEYS).toContain('cache_hit_pct')
    expect(SESSION_VOLATILE_USAGE_KEYS).toContain('avg_tps')
    expect(SESSION_SCOPED_USAGE_KEYS).not.toContain('plan_gauge')
    expect(SESSION_SCOPED_USAGE_KEYS).not.toContain('input')
  })

  it('clears volatile fields an authoritative snapshot omits, keeps the rest', () => {
    // The session's own snapshot (session.info event) carries its counters and
    // its context occupancy but no cache-hit or throughput figure — fresh
    // runtime, no reads / no latency history yet.
    const snapshot: Partial<StoredUsage> = {
      calls: 3,
      context_percent: 9,
      context_used: 18_000,
      input: 500,
      output: 60,
      total: 560
    }

    const next = {
      ...mergeUsage(STORED, snapshot),
      ...sessionScopedUsageLayer(snapshot, SESSION_VOLATILE_USAGE_KEYS)
    }

    expect(next.cache_hit_pct).toBeUndefined()
    expect(next.avg_tps).toBeUndefined()
    expect(next.compressions).toBeUndefined()
    expect(next.cost_usd).toBeUndefined()
    // Same session: context occupancy and counters still merge. The gauge is
    // mergeUsage's own affair — a complete payload (it carries `calls`) that
    // omits it means no window plan, so it drops.
    expect(next.context_percent).toBe(9)
    expect(next.calls).toBe(3)
    expect(next.plan_gauge).toBeUndefined()
  })

  it('keeps volatile fields the snapshot reports', () => {
    const snapshot: Partial<StoredUsage> = {
      avg_tps: 11.5,
      cache_hit_pct: 62,
      calls: 3,
      input: 500,
      output: 60,
      total: 560
    }

    const next = {
      ...mergeUsage(STORED, snapshot),
      ...sessionScopedUsageLayer(snapshot, SESSION_VOLATILE_USAGE_KEYS)
    }

    expect(next.cache_hit_pct).toBe(62)
    expect(next.avg_tps).toBe(11.5)
  })

  it('clears every session-scoped field on a session switch snapshot', () => {
    // A different session's authoritative snapshot: the full layer clears
    // volatile AND context fields it omits — the previous conversation's
    // occupancy figures must not paint under the new session's header.
    const snapshot: Partial<StoredUsage> = { calls: 3, input: 500, output: 60, total: 560 }
    const next = { ...mergeUsage(STORED, snapshot), ...sessionScopedUsageLayer(snapshot) }

    expect(next.cache_hit_pct).toBeUndefined()
    expect(next.context_percent).toBeUndefined()
    expect(next.context_used).toBeUndefined()
    expect(next.calls).toBe(3)
    // Complete payload + omitted gauge = no window plan (mergeUsage contract).
    expect(next.plan_gauge).toBeUndefined()
  })

  it('clears the whole session-scoped set on a bare session switch', () => {
    // The preview clear runs before the resume round-trip returns: undefined
    // snapshot = drop every session-scoped figure, keep nothing of the old
    // session's numbers.
    const next = { ...STORED, ...sessionScopedUsageLayer(undefined) }

    for (const key of SESSION_SCOPED_USAGE_KEYS) {
      expect(next[key as keyof StoredUsage]).toBeUndefined()
    }

    // Window-scoped and counter state are not the preview's business.
    expect(next.plan_gauge).toEqual(STORED.plan_gauge)
    expect(next.input).toBe(STORED.input)
  })

  it('does not change mergeUsage for mid-turn partial ticks', () => {
    // A mid-session tick omitting a figure means "no update" — the layer is
    // for authoritative snapshots, not ticks.
    const tick: Partial<StoredUsage> = { calls: 15, input: 1100 }
    const merged = mergeUsage(STORED, tick)

    expect(merged.cache_hit_pct).toBe(87)
    expect(merged.avg_tps).toBe(42.1)
  })
})
