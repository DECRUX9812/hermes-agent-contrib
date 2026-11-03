/**
 * Session-scoped activity for Bot Mode.
 *
 * Bot Mode used to paint one shared "what the bot is doing" list: routine runs,
 * every conversation the bot owned, and prompts mirrored from every room. That
 * made two sessions look like one workflow, and an approval answered on one
 * session could visually settle a row belonging to another.
 *
 * This module is the explicit boundary. Every activity record names its
 * `(profile, sessionId)` owner, every reducer takes ONE session, and the store
 * is keyed by that pair. The UI can only read a feed through `activityFor`, so
 * a cross-session leak is a type error rather than a rendering bug.
 *
 * Pure by design: the component and the event bridge supply time, events and
 * RPC rows; nothing here reaches the gateway or the DOM.
 */

import { atom } from '@hermes/plugin-sdk'

export type SessionActivityKind = 'tool' | 'approval' | 'session'
export type SessionActivityStatus = 'running' | 'waiting' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'unavailable'

export interface SessionApproval {
  requestId: string
  kind: 'approval' | 'clarify'
  command: string
  description: string
  choices: string[]
  status: ApprovalStatus
  choice?: null | string
  decidedAt?: null | number
}

export interface SessionActivity {
  id: string
  profile: string
  sessionId: string
  kind: SessionActivityKind
  title: string
  status: SessionActivityStatus
  startedAt: number
  finishedAt?: null | number
  summary: string
  detail?: string
  approval?: SessionApproval
}

export interface SessionRef {
  profile: string
  sessionId: string
}

export interface SessionActivityPage {
  items: SessionActivity[]
  total: number
  hasMore: boolean
}

const DAY = 24 * 60 * 60 * 1000

export function activityKey(ref: SessionRef): string {
  return `${ref.profile}::${ref.sessionId}`
}

export function oneLine(value: unknown, max = 160): string {
  const line =
    String(value ?? '')
      .split('\n')
      .map(part => part.trim())
      .find(Boolean) ?? ''

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Gateway timestamps are seconds in some rows and milliseconds in others. */
export function timestampMs(value: unknown): number {
  const n = Number(value)

  if (!Number.isFinite(n) || n <= 0) {
    return 0
  }

  return n < 1e12 ? n * 1000 : n
}

function isFailure(status: unknown): boolean {
  const value = String(status ?? '').toLowerCase()

  return value === 'error' || value === 'failed' || value === 'failure'
}

function isCancelled(status: unknown): boolean {
  const value = String(status ?? '').toLowerCase()

  return value === 'cancelled' || value === 'canceled' || value === 'stopped' || value === 'interrupted'
}

function cleanToolName(value: unknown): string {
  const name = oneLine(value, 80)

  return name || 'Tool'
}

/** One tool row from `session.history` as an activity item. */
export function activityFromHistoryRow(
  ref: SessionRef,
  row: Record<string, unknown>,
  index: number
): SessionActivity | null {
  const role = String(row.role ?? '')

  if (role !== 'tool') {
    return null
  }

  const toolId = oneLine(row.tool_call_id ?? row.tool_id ?? row.id, 120)
  const id = toolId ? `tool:${toolId}` : `tool:${ref.sessionId}:${index}`
  const failed = isFailure(row.status) || Boolean(row.error)
  const cancelled = isCancelled(row.status)
  const at = timestampMs(row.timestamp) || timestampMs(row.started_at) || Date.now() + index

  return {
    detail: oneLine(row.result ?? row.text, 4000) || undefined,
    finishedAt: at,
    id,
    kind: 'tool',
    profile: ref.profile,
    sessionId: ref.sessionId,
    startedAt: at,
    status: failed ? 'failed' : cancelled ? 'cancelled' : 'succeeded',
    summary: oneLine(row.context, 200),
    title: cleanToolName(row.name)
  }
}

/** A session's persisted tool rows, oldest first, one item per tool call. */
export function activityFromHistory(ref: SessionRef, rows: unknown): SessionActivity[] {
  const out: SessionActivity[] = []

  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    if (!row || typeof row !== 'object') {
      continue
    }

    const item = activityFromHistoryRow(ref, row as Record<string, unknown>, index)

    if (item) {
      out.push(item)
    }
  }

  return sortActivity(out)
}

/** Sort oldest first; equal timestamps keep a stable id order for tests. */
export function sortActivity(items: readonly SessionActivity[]): SessionActivity[] {
  return [...items].sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
}

/** Merge one session's records without letting a late/double update win.
 *
 * Rules, in order:
 *  - a settled record beats a running one for the same id;
 *  - a later finish time wins;
 *  - an approval attached to either copy is never dropped;
 *  - ids absent from `incoming` are retained (pagination/history).
 */
export function mergeSessionActivity(
  existing: readonly SessionActivity[],
  incoming: readonly SessionActivity[]
): SessionActivity[] {
  const byId = new Map(existing.map(item => [item.id, item]))

  for (const next of incoming) {
    const current = byId.get(next.id)

    if (!current) {
      byId.set(next.id, next)

      continue
    }

    const currentSettled = current.status !== 'running' && current.status !== 'waiting'
    const nextSettled = next.status !== 'running' && next.status !== 'waiting'
    const winner = nextSettled || !currentSettled ? next : current
    const loser = winner === next ? current : next

    byId.set(next.id, {
      ...winner,
      approval: winner.approval ?? loser.approval,
      detail: winner.detail ?? loser.detail,
      finishedAt: Math.max(current.finishedAt ?? 0, next.finishedAt ?? 0) || null,
      startedAt: Math.min(current.startedAt, next.startedAt),
      summary: winner.summary || loser.summary
    })
  }

  return sortActivity([...byId.values()])
}

export function activityFromToolEvent(
  ref: SessionRef,
  eventType: string,
  payload: Record<string, unknown> | null | undefined,
  at = Date.now()
): SessionActivity | null {
  const data = payload ?? {}
  const toolId = oneLine(data.tool_id ?? data.tool_call_id ?? data.id, 120)

  if (!toolId) {
    return null
  }

  const name = cleanToolName(data.name)
  const failed = isFailure(data.status) || Boolean(data.error)
  const cancelled = isCancelled(data.status)
  const running = eventType === 'tool.start'
  const detail = oneLine(data.result ?? data.input ?? data.arguments ?? data.args, 4000) || undefined
  const summary = oneLine(data.preview ?? data.summary ?? data.context, 200)

  return {
    detail,
    finishedAt: running ? null : at,
    id: `tool:${toolId}`,
    kind: 'tool',
    profile: ref.profile,
    sessionId: ref.sessionId,
    startedAt: at,
    status: running ? 'running' : failed ? 'failed' : cancelled ? 'cancelled' : 'succeeded',
    summary,
    title: name
  }
}

export function approvalFromPrompt(
  ref: SessionRef,
  prompt: Record<string, unknown>,
  at = Date.now()
): SessionActivity | null {
  const requestId = oneLine(prompt.requestId ?? prompt.request_id, 200)

  if (!requestId) {
    return null
  }

  const kind = prompt.kind === 'clarify' ? 'clarify' : 'approval'
  const command = oneLine(prompt.command, 2000)
  const description = oneLine(prompt.question ?? prompt.description, 500)

  const choices = Array.isArray(prompt.choices)
    ? prompt.choices.filter((choice): choice is string => typeof choice === 'string' && Boolean(choice))
    : ['once', 'deny']

  return {
    approval: {
      choices,
      command,
      description,
      kind,
      requestId,
      status: 'pending'
    },
    detail: command || description,
    finishedAt: null,
    id: `approval:${requestId}`,
    kind: 'approval',
    profile: ref.profile,
    sessionId: ref.sessionId,
    startedAt: at,
    status: 'waiting',
    summary: description,
    title: kind === 'clarify' ? 'Question for you' : 'Approval needed'
  }
}

/** A settled decision, even when its request row was never in this feed. */
export function settledApprovalActivity(
  ref: SessionRef,
  requestId: string,
  status: ApprovalStatus,
  choice: null | string,
  at = Date.now(),
  prompt: Record<string, unknown> = {}
): SessionActivity {
  const item = approvalFromPrompt(ref, { ...prompt, requestId }, at)

  return {
    ...(item ?? {
      approval: {
        choices: [],
        command: '',
        description: '',
        kind: 'approval' as const,
        requestId,
        status: 'pending' as const
      },
      detail: '',
      id: `approval:${requestId}`,
      kind: 'approval' as const,
      profile: ref.profile,
      sessionId: ref.sessionId,
      startedAt: at,
      summary: '',
      title: 'Approval'
    }),
    approval: {
      ...(item?.approval ?? {
        choices: [],
        command: '',
        description: '',
        kind: 'approval' as const,
        requestId
      }),
      choice,
      decidedAt: at,
      status
    },
    finishedAt: at,
    status: status === 'approved' ? 'succeeded' : status === 'pending' ? 'waiting' : 'cancelled'
  }
}

/** Apply one decision to the feed, updating the linked task when present.
 *
 * The approval row is the fallback when the task already finished (or was
 * never observed): a decision is never dropped just because its task is gone.
 */
export function applyApprovalDecision(
  ref: SessionRef,
  items: readonly SessionActivity[],
  requestId: string,
  status: ApprovalStatus,
  choice: null | string,
  at = Date.now(),
  prompt: Record<string, unknown> = {}
): SessionActivity[] {
  const id = `approval:${requestId}`
  const existing = items.find(item => item.id === id || item.approval?.requestId === requestId)

  if (!existing) {
    return mergeSessionActivity(items, [settledApprovalActivity(ref, requestId, status, choice, at, prompt)])
  }

  const approval = {
    ...(existing.approval ?? {
      choices: [],
      command: '',
      description: '',
      kind: 'approval' as const,
      requestId
    }),
    choice,
    decidedAt: at,
    status
  }

  return mergeSessionActivity(items, [
    {
      ...existing,
      approval,
      finishedAt: at,
      status: status === 'approved' ? 'succeeded' : status === 'pending' ? 'waiting' : 'cancelled'
    }
  ])
}

/** Newest first, capped by `limit`; the returned flag drives "Load older". */
export function activityFor(
  store: Readonly<Record<string, readonly SessionActivity[]>>,
  ref: SessionRef,
  limit = 20
): SessionActivityPage {
  const all = store[activityKey(ref)] ?? []
  const ordered = [...all].sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id))
  const size = Math.max(0, Math.trunc(limit))

  return {
    hasMore: ordered.length > size,
    items: ordered.slice(0, size),
    total: ordered.length
  }
}

export function activityCounts(items: readonly SessionActivity[]): {
  failed: number
  running: number
  waiting: number
} {
  return {
    failed: items.filter(item => item.status === 'failed').length,
    running: items.filter(item => item.status === 'running').length,
    waiting: items.filter(item => item.status === 'waiting' || item.status === 'pending').length
  }
}

export function groupByDay(
  items: readonly SessionActivity[],
  now = Date.now()
): Array<{ at: number; items: SessionActivity[] }> {
  const groups: Array<{ at: number; items: SessionActivity[] }> = []

  for (const item of items) {
    const day = Math.floor(item.startedAt / DAY) * DAY
    const last = groups[groups.length - 1]

    if (last && last.at === day) {
      last.items.push(item)
    } else {
      groups.push({ at: day, items: [item] })
    }
  }

  return groups.sort((left, right) => right.at - left.at).map(group => ({ ...group, at: group.at || now }))
}

// ── store ───────────────────────────────────────────────────────────────────
// Keyed by `profile::sessionId`. Reads always go through `activityFor(ref)`, so
// no component ever receives the whole map.
export const $sessionActivity = atom<Record<string, SessionActivity[]>>({})

export function mergeIntoSession(ref: SessionRef, incoming: readonly SessionActivity[]): void {
  if (!incoming.length) {
    return
  }

  const key = activityKey(ref)
  $sessionActivity.set({
    ...$sessionActivity.get(),
    [key]: mergeSessionActivity($sessionActivity.get()[key] ?? [], incoming)
  })
}

export function decideInSession(
  ref: SessionRef,
  requestId: string,
  status: ApprovalStatus,
  choice: null | string,
  at = Date.now(),
  prompt: Record<string, unknown> = {}
): void {
  const key = activityKey(ref)
  $sessionActivity.set({
    ...$sessionActivity.get(),
    [key]: applyApprovalDecision(ref, $sessionActivity.get()[key] ?? [], requestId, status, choice, at, prompt)
  })
}

export function clearSessionActivity(ref?: SessionRef): void {
  if (!ref) {
    $sessionActivity.set({})

    return
  }

  const key = activityKey(ref)
  const next = { ...$sessionActivity.get() }

  delete next[key]
  $sessionActivity.set(next)
}
