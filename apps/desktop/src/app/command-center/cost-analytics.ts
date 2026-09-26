/**
 * Local spend aggregation for the Command Center Usage section. Every input
 * is data the renderer already holds — the analytics payload (per-day,
 * per-model) and the session list (per-session, per-profile usage sums) — so
 * the helpers are pure and the whole section stays behind the
 * `$costAnalyticsEnabled` opt-in.
 */

import { sessionTitle } from '@/lib/chat-runtime'
import type { ProfileUsage } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

/** Sidebar convention (`chat/sidebar/chrome.tsx`): whole cents as `$1.23`,
 *  honest placeholder under a cent instead of rounding spend to `$0.00`. */
export function formatUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) {
    return '$0.00'
  }

  return cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`
}

export interface SpendRow {
  cost: number
  key: string
  label: string
  tokens?: number
}

/** Per-profile spend: the backend already sums `session.list` usage per
 *  profile, so this only orders the rows (most spend first). Profiles with
 *  no recorded spend stay in the list — a zero row is information. */
export function profileSpendRows(usage: Record<string, ProfileUsage>): SpendRow[] {
  return Object.entries(usage)
    .map(([profile, entry]) => ({ cost: entry.cost_usd, key: profile, label: profile, tokens: entry.tokens }))
    .sort((a, b) => b.cost - a.cost)
}

/** Per-session spend over the loaded session window, most expensive first.
 *  Rows without recorded cost are dropped (a zero-cost list is noise). */
export function sessionSpendRows(sessions: readonly SessionInfo[], limit: number): SpendRow[] {
  return sessions
    .map(session => ({
      cost: session.actual_cost_usd || session.estimated_cost_usd || 0,
      key: session.id,
      label: sessionTitle(session)
    }))
    .filter(row => row.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, limit)
}
