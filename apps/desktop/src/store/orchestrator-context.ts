/**
 * Orchestrator (a.k.a. "Homie Spot") context store.
 *
 * Holds the one durable context document the workspace renders, plus the live
 * session list the activity section reads. Seeded from `bootstrapContext` so
 * the pane can render a real state — an empty objective — instead of blank
 * space on first run.
 *
 * Persistence is intentionally in-memory for now: the durable writer is the
 * promotion path in `src/orchestrator/context.ts`, and that lands with the
 * gateway bridge. Until then a reload returns the same honest empty state.
 */

import { atom, computed } from 'nanostores'

import { bootstrapContext } from '@/orchestrator/context'
import { deriveContextSpot, derivePanelRows, type ContextSpotView, type PanelRowView } from '@/orchestrator/panel'
import type { DurableContext, OrchestratorSession, Summary } from '@/orchestrator/types'

export const $orchestratorContext = atom<DurableContext>(bootstrapContext('local'))

export const $orchestratorSessions = atom<OrchestratorSession[]>([])

export const $orchestratorSummaries = atom<Record<string, Summary>>({})

export const $orchestratorContextError = atom<string | null>(null)

/** Everything the Homie Spot header renders. Recomputed on any store change. */
export const $contextSpot = computed(
  [$orchestratorContext, $orchestratorSessions, $orchestratorContextError],
  (ctx, sessions, error): ContextSpotView | null => (error ? null : deriveContextSpot(ctx, sessions))
)

export const $activityRows = computed(
  [$orchestratorSessions, $orchestratorSummaries],
  (sessions, summaries): PanelRowView[] => derivePanelRows(sessions, new Map(Object.entries(summaries)), [])
)

/** Set (or clear) the orchestrator's current objective — the one manual edit. */
export function setObjective(objective: string): void {
  const ctx = $orchestratorContext.get()
  $orchestratorContext.set({
    ...ctx,
    objective: objective.trim(),
    revision: ctx.revision + 1,
    updatedAt: new Date().toISOString()
  })
}

/** Test/repair seam: replace the whole document (used by the gateway bridge). */
export function replaceContext(ctx: DurableContext): void {
  $orchestratorContext.set(ctx)
  $orchestratorContextError.set(null)
}

export function reportContextError(message: string | null): void {
  $orchestratorContextError.set(message)
}
