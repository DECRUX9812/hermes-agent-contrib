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

export type SessionActivityKind = 'approval' | 'session' | 'task' | 'tool'
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

export interface SessionTraceStep {
  at: number
  detail?: string
  id: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  target: string
  tool: string
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
  /** Raw tool calls behind the collapsed "technical details" toggle. */
  steps?: SessionTraceStep[]
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

const HOUSEKEEPING = /^(todo|memory|reaction|react|add_reaction|set_reaction|clarify)/i

function oneSentence(value: unknown, max = 240): string {
  const text = oneLine(value, 400)
  const first = text.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? text

  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

function stepTarget(row: Record<string, unknown>): string {
  for (const key of ['context', 'target', 'path', 'command', 'query', 'pattern', 'url', 'input']) {
    const value = oneLine(row[key], 120)

    if (value) {
      return value
    }
  }

  return ''
}

function stepStatus(row: Record<string, unknown>): SessionTraceStep['status'] {
  if (isFailure(row.status) || Boolean(row.error)) {
    return 'failed'
  }

  if (isCancelled(row.status)) {
    return 'cancelled'
  }

  return 'succeeded'
}

/** A session's persisted history grouped into user-meaningful tasks.
 *
 * A task starts at a user row and closes at the next one. Housekeeping tools
 * (todo/memory/reactions/clarify) never become steps. Steps dedupe by
 * (tool, target), so the same inspection twice — or a failure followed by a
 * successful retry — is one row whose status is the LAST observation.
 */
export function activityFromHistory(ref: SessionRef, rows: unknown): SessionActivity[] {
  const out: SessionActivity[] = []

  let current: {
    id: string
    lastAt: number
    startedAt: number
    steps: Map<string, SessionTraceStep>
    summary: string
    title: string
  } | null = null

  let taskIndex = 0

  const flush = () => {
    if (!current) {
      return
    }

    const steps = [...current.steps.values()].sort(
      (left, right) => left.at - right.at || left.id.localeCompare(right.id)
    )

    if (steps.length) {
      const running = steps.some(step => step.status === 'running')
      const failed = steps.some(step => step.status === 'failed')
      const cancelled = steps.every(step => step.status === 'cancelled')

      out.push({
        detail: undefined,
        finishedAt: running ? null : current.lastAt,
        id: current.id,
        kind: 'task',
        profile: ref.profile,
        sessionId: ref.sessionId,
        startedAt: current.startedAt,
        status: running ? 'running' : failed ? 'failed' : cancelled ? 'cancelled' : 'succeeded',
        steps,
        summary: current.summary,
        title: current.title
      })
    }

    current = null
  }

  const open = (title: string, at: number) => ({
    id: `task:${ref.sessionId}:${taskIndex++}`,
    lastAt: at,
    startedAt: at,
    steps: new Map<string, SessionTraceStep>(),
    summary: '',
    title: oneLine(title, 80) || 'Session activity'
  })

  for (const [index, raw] of (Array.isArray(rows) ? rows : []).entries()) {
    if (!raw || typeof raw !== 'object') {
      continue
    }

    const row = raw as Record<string, unknown>
    const role = String(row.role ?? '')
    const at = timestampMs(row.timestamp) || timestampMs(row.started_at) || Date.now() + index

    if (role === 'user') {
      flush()
      current = open(oneLine(row.text, 500), at)
      current.lastAt = Math.max(current.lastAt, at)

      continue
    }

    if (role === 'assistant') {
      const text = oneLine(row.text, 500)

      if (text && current) {
        current.summary = oneSentence(text)
      }

      continue
    }

    if (role !== 'tool') {
      continue
    }

    const tool = cleanToolName(row.name)

    if (HOUSEKEEPING.test(tool)) {
      continue
    }

    if (!current) {
      current = open('Session activity', at)
    }

    const target = stepTarget(row)
    const key = `${tool}|${target}`

    const step: SessionTraceStep = {
      at,
      detail: oneLine(row.result ?? row.text, 4000) || undefined,
      id: oneLine(row.tool_call_id ?? row.tool_id ?? row.id, 120) || `${current.id}:${index}`,
      status: stepStatus(row),
      target,
      tool
    }

    const previous = current.steps.get(key)

    // Last observation wins: a retried failure that now succeeds is one
    // successful step, and a duplicate probe never becomes two rows.
    current.steps.set(key, previous ? { ...step, id: previous.id, at: Math.max(previous.at, at) } : step)
    current.lastAt = Math.max(current.lastAt, at)
  }

  flush()

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
      steps: winner.steps ?? loser.steps,
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
