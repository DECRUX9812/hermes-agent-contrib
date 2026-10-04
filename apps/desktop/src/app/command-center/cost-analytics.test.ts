import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/types/hermes'

import { formatUsd, profileSpendRows, sessionSpendRows } from './cost-analytics'

const session = (over: Partial<SessionInfo>): SessionInfo => ({ id: 's', title: '', ...over }) as SessionInfo

describe('formatUsd', () => {
  it('rounds to whole cents like the sidebar usage totals', () => {
    expect(formatUsd(3.456)).toBe('$3.46')
  })

  it('keeps sub-cent spend honest instead of rounding to $0.00', () => {
    expect(formatUsd(0.004)).toBe('<$0.01')
  })

  it('renders missing/negative cost as zero', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(Number.NaN)).toBe('$0.00')
  })
})

describe('profileSpendRows', () => {
  it('orders by spend, keeping zero-cost profiles in the list', () => {
    const rows = profileSpendRows({ a: { cost_usd: 0, tokens: 5 }, b: { cost_usd: 2, tokens: 10 } })

    expect(rows.map(r => r.key)).toEqual(['b', 'a'])
    expect(rows[1].cost).toBe(0)
  })
})

describe('sessionSpendRows', () => {
  it('prefers actual cost, falls back to estimated, drops zero-cost rows', () => {
    const rows = sessionSpendRows(
      [
        session({ id: 'a', actual_cost_usd: 1.5, estimated_cost_usd: 9 }),
        session({ id: 'b', estimated_cost_usd: 0.5 }),
        session({ id: 'c' }),
        session({ id: 'd', actual_cost_usd: null, estimated_cost_usd: null })
      ],
      10
    )

    expect(rows.map(r => [r.key, r.cost])).toEqual([
      ['a', 1.5],
      ['b', 0.5]
    ])
  })

  it('caps the list at the requested limit', () => {
    const rows = sessionSpendRows(
      [
        session({ id: 'a', estimated_cost_usd: 1 }),
        session({ id: 'b', estimated_cost_usd: 2 }),
        session({ id: 'c', estimated_cost_usd: 3 })
      ],
      2
    )

    expect(rows.map(r => r.key)).toEqual(['c', 'b'])
  })
})
