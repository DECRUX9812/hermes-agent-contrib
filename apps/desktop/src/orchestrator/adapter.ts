/**
 * Bridge between the existing sub-agent store and the orchestrator view models.
 *
 * `$subagentsBySession` already carries everything the activity panel needs
 * (status, goal, current tool, duration, summary) — it just speaks a different
 * shape than `PanelRowView`. Rather than fork a second renderer, the rail maps
 * the store into the panel rows and the activity section gets the same
 * semantics the orchestrator engine produces.
 *
 * Pure functions: no store reads, so both directions stay testable.
 */

import type { PanelRowView } from './panel'
import { formatElapsed } from './panel'
import type { ContextSpotView } from './panel'
import type { DurableContext, OrchestratorSession } from './types'
import { deriveContextSpot } from './panel'

/** The subset of the app's `SubagentProgress` this adapter needs. */
export interface SubagentLike {
  currentTool?: string
  durationSeconds?: number
  goal: string
  id: string
  startedAt: number
  status: 'completed' | 'failed' | 'interrupted' | 'queued' | 'running'
  summary?: string
  updatedAt?: number
}

const STATUS_MAP: Record<SubagentLike['status'], PanelRowView['status']> = {
  completed: 'done',
  failed: 'failed',
  interrupted: 'cancelled',
  queued: 'queued',
  running: 'running'
}

const LABEL_MAP: Record<SubagentLike['status'], string> = {
  completed: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted',
  queued: 'Queued',
  running: 'Running'
}

export function panelRowsFromSubagents(items: readonly SubagentLike[], nowMs = Date.now()): PanelRowView[] {
  return items.map((item, index) => {
    const status = STATUS_MAP[item.status]
    const ended = item.status === 'running' || item.status === 'queued' ? nowMs : (item.updatedAt ?? nowMs)
    const elapsed = item.durationSeconds ?? Math.max(0, Math.round((ended - item.startedAt) / 1000))

    return {
      badge: status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : null,
      canCancel: status === 'running' || status === 'queued',
      currentAction: actionLine(item),
      elapsedLabel: formatElapsed(elapsed),
      hasSummary: Boolean(item.summary),
      headline: item.summary ? firstLine(item.summary) : '',
      index: index + 1,
      lastEventAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : null,
      sessionId: item.id,
      status,
      statusLabel: LABEL_MAP[item.status],
      title: item.goal || `Worker #${index + 1}`
    }
  })
}

function actionLine(item: SubagentLike): string {
  if (item.status === 'failed') return 'failed'
  if (item.status === 'interrupted') return 'interrupted'
  if (item.status === 'completed') return 'returned a summary'
  if (item.status === 'queued') return 'queued'
  if (item.currentTool) return `running ${item.currentTool}`

  return 'working'
}

function firstLine(text: string): string {
  const line = text.split('\n').find(l => l.trim().length > 0) ?? ''

  return line.length > 140 ? `${line.slice(0, 139)}…` : line
}

/**
 * The Homie Spot view for whatever durable context exists right now. An empty
 * context is a legitimate answer — the component renders it as an explicit
 * "no objective yet" state, never as an unexplained blank.
 */
export function spotFromContext(
  ctx: DurableContext,
  sessions: readonly OrchestratorSession[] = [],
  opts: { stale?: boolean; nowMs?: number } = {}
): ContextSpotView {
  return deriveContextSpot(ctx, sessions, opts)
}
