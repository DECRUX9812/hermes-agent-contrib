/**
 * View models for the two surfaces. Pure selectors, so the UI is a render
 * function and the state rules are testable without React.
 *
 * Separation contract (tested): the CONTEXT SPOT renders only what the
 * orchestrator knows (durable context + counts); the ACTIVITY PANEL renders
 * only what is happening (sessions + their events). No row may appear in both,
 * and the spot never shows a transient action line.
 */

import type { ActivityEvent, ContextEntry, DurableContext, OrchestratorSession, Summary } from './types'
import { TERMINAL_SESSION } from './types'
import { describeAction } from './sessions'

export interface SpotGlyph {
  sessionId: string
  status: OrchestratorSession['status']
  title: string
}

export interface ContextSpotView {
  active: SpotGlyph[]
  activeCount: number
  constraints: string[]
  empty: boolean
  moreConstraints: number
  moreDecisions: number
  objective: string
  pendingDecisions: { id: string; question: string }[]
  recentPromoted: { at: string; entryId: string; text: string }[]
  stale: boolean
  tokenCount: number
}

export interface PanelRowView {
  badge: 'cancelled' | 'failed' | 'timeout' | null
  canCancel: boolean
  currentAction: string
  elapsedLabel: string
  hasSummary: boolean
  headline: string
  index: number
  lastEventAt: string | null
  sessionId: string
  status: OrchestratorSession['status']
  statusLabel: string
  title: string
}

export const SPOT_LIMITS = { constraints: 4, decisions: 2, promoted: 3, glyphs: 3 } as const

export function deriveContextSpot(
  ctx: DurableContext,
  sessions: readonly OrchestratorSession[],
  opts: { entries?: readonly ContextEntry[]; stale?: boolean; nowMs?: number } = {}
): ContextSpotView {
  const activeSessions = sessions.filter(s => !TERMINAL_SESSION.has(s.status))
  const pending = ctx.openDecisions
  const recent = recentPromotions(ctx, opts.entries ?? [])
  const empty = !ctx.objective && !ctx.constraints.length && !ctx.facts.length && !pending.length

  return {
    active: activeSessions.slice(0, SPOT_LIMITS.glyphs).map(s => ({ sessionId: s.sessionId, status: s.status, title: s.title })),
    activeCount: activeSessions.length,
    constraints: ctx.constraints.slice(0, SPOT_LIMITS.constraints),
    empty,
    moreConstraints: Math.max(0, ctx.constraints.length - SPOT_LIMITS.constraints),
    moreDecisions: Math.max(0, pending.length - SPOT_LIMITS.decisions),
    objective: ctx.objective,
    pendingDecisions: pending.slice(0, SPOT_LIMITS.decisions).map(d => ({ id: d.id, question: d.question })),
    recentPromoted: recent.slice(-SPOT_LIMITS.promoted).reverse(),
    stale: opts.stale ?? false,
    tokenCount: ctx.tokenCount
  }
}

export function derivePanelRows(
  sessions: readonly OrchestratorSession[],
  summaries: ReadonlyMap<string, Summary>,
  events: readonly ActivityEvent[],
  nowMs = Date.now()
): PanelRowView[] {
  return sessions
    .map((session, index) => {
      const mine = events.filter(e => e.sessionId === session.sessionId)
      const summary = summaries.get(session.sessionId)
      const end = session.endedAt ? Date.parse(session.endedAt) : nowMs
      const elapsedS = session.startedAt ? Math.max(0, Math.round((end - Date.parse(session.startedAt)) / 1000)) : 0

      return {
        badge: badgeFor(session),
        canCancel: !TERMINAL_SESSION.has(session.status),
        currentAction: describeAction(session, mine.at(-1)),
        elapsedLabel: formatElapsed(elapsedS),
        hasSummary: Boolean(summary),
        headline: summary?.headline ?? '',
        index: index + 1,
        lastEventAt: mine.at(-1)?.at ?? null,
        sessionId: session.sessionId,
        status: session.status,
        statusLabel: STATUS_LABEL[session.status],
        title: session.title
      }
    })
    .reverse() // newest first
}

const STATUS_LABEL: Record<OrchestratorSession['status'], string> = {
  awaiting_input: 'Awaiting answer',
  cancelled: 'Cancelled',
  done: 'Done',
  failed: 'Failed',
  queued: 'Queued',
  running: 'Running',
  timeout: 'Timed out'
}

function badgeFor(session: OrchestratorSession): PanelRowView['badge'] {
  if (session.status === 'failed' || session.status === 'cancelled' || session.status === 'timeout') return session.status

  return null
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${seconds % 60}s`

  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function recentPromotions(ctx: DurableContext, entries: readonly ContextEntry[]) {
  if (entries.length) {
    return entries
      .filter(e => ctx.promoted.includes(e.entryId))
      .map(e => ({ at: e.provenance.promotedAt, entryId: e.entryId, text: e.text }))
  }

  // Fallback when only the context document is available.
  return ctx.facts.slice(-3).map(f => ({ at: ctx.updatedAt ?? '', entryId: f.id, text: f.text }))
}
