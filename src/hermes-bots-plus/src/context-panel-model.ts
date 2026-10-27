/**
 * Pure readings behind the rail's context panel.
 *
 * The gauge reads the same two sources the core status bar does, in the same
 * order: the session's context breakdown when it carries a window size (it is
 * refreshed at turn end and after a summary), else the streamed usage stats.
 *
 * The timeline is built from `session.history`'s display projection: user
 * rows open a turn, tool rows are its steps, assistant text closes it. Rows
 * carry their own write time, so a step's "took" is the gap since the event
 * before it — the tool run plus the model's thinking that led to it. The
 * projection does not ship per-call durations or token counts, so neither is
 * claimed here.
 */

import { toolStepIdentity } from './tool-card-model'

export interface ContextSource {
  compressions?: number
  context_estimated?: boolean
  context_max?: number
  context_percent?: number
  context_used?: number
}

export interface ContextReading {
  compressions: number
  estimated: boolean
  max: number
  percent: number
  used: number
}

export type ContextTone = 'calm' | 'full' | 'warm'

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

export function contextReading(
  breakdown: ContextSource | null | undefined,
  usage: ContextSource | null | undefined
): ContextReading | null {
  const source = num(breakdown?.context_max) > 0 ? breakdown : num(usage?.context_max) > 0 ? usage : null

  if (!source) {
    return null
  }

  const max = num(source.context_max)
  const used = Math.max(0, num(source.context_used))
  const reported = num(source.context_percent)
  const percent = Math.round(Math.min(100, Math.max(0, reported > 0 ? reported : (used / max) * 100)))

  return {
    compressions: Math.max(num(usage?.compressions), num(breakdown?.compressions)),
    estimated: source.context_estimated === true,
    max,
    percent,
    used
  }
}

export function contextTone(percent: number): ContextTone {
  return percent >= 90 ? 'full' : percent >= 70 ? 'warm' : 'calm'
}

/** 950 → "950", 12_400 → "12.4k", 128_000 → "128k", 1_048_576 → "1.05M". */
export function shortTokens(value: number): string {
  const n = Math.max(0, Math.round(value))

  if (n < 1000) {
    return String(n)
  }

  if (n < 1_000_000) {
    const k = n / 1000

    return `${k < 100 ? Number(k.toFixed(1)) : Math.round(k)}k`
  }

  return `${Number((n / 1_000_000).toFixed(2))}M`
}

/** 420 → "420ms", 4_250 → "4.3s", 125_000 → "2m 05s". */
export function shortDuration(ms: number): string {
  const n = Math.max(0, Math.round(ms))

  if (n < 1000) {
    return `${n}ms`
  }

  if (n < 60_000) {
    return `${Number((n / 1000).toFixed(1))}s`
  }

  const minutes = Math.floor(n / 60_000)
  const seconds = Math.round((n % 60_000) / 1000)

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export interface TraceStep {
  context: string
  icon: string
  id: string
  name: string
  /** Gap since the previous event in the turn, in ms; absent without times. */
  took?: number
}

export interface TraceTurn {
  answered: boolean
  id: string
  index: number
  prompt: string
  steps: TraceStep[]
  slowest?: TraceStep
  /** First to last event of the turn, in ms. */
  span?: number
}

interface Row {
  context?: unknown
  display_kind?: unknown
  name?: unknown
  role?: unknown
  text?: unknown
  timestamp?: unknown
  tool_call_id?: unknown
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

const msOf = (value: unknown): number | undefined => {
  const n = num(value)

  return n > 0 ? (n < 1e12 ? n * 1000 : n) : undefined
}

const oneLine = (value: string, max = 140): string => {
  const flat = value.replace(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Turns, oldest first, from a `session.history` messages array. */
export function buildTrace(messages: unknown): TraceTurn[] {
  type OpenTurn = TraceTurn & { first?: number; last?: number }

  const turns: OpenTurn[] = []
  let current: null | OpenTurn = null

  const open = (prompt: string, at?: number): OpenTurn => {
    const turn = { answered: false, first: at, id: `turn-${turns.length + 1}`, index: turns.length + 1, last: at, prompt, steps: [] }

    turns.push(turn)

    return turn
  }

  for (const raw of Array.isArray(messages) ? messages : []) {
    if (!raw || typeof raw !== 'object') {
      continue
    }

    const row = raw as Row
    const role = str(row.role)
    const at = msOf(row.timestamp)

    if (role === 'user') {
      current = open(oneLine(str(row.text)), at)
      continue
    }

    if (role !== 'tool' && role !== 'assistant') {
      continue
    }

    const turn: OpenTurn = current ?? (current = open('', at))

    if (turn.first === undefined) {
      turn.first = at
    }

    if (role === 'tool') {
      const name = str(row.name) || 'tool'
      const identity = toolStepIdentity(name)
      const took = at !== undefined && turn.last !== undefined && at >= turn.last ? at - turn.last : undefined

      turn.steps.push({
        context: oneLine(str(row.context), 100),
        icon: identity.icon,
        id: str(row.tool_call_id) || `${turn.id}-step-${turn.steps.length + 1}`,
        name: identity.name,
        ...(took === undefined ? {} : { took })
      })
    } else if (str(row.text).trim()) {
      turn.answered = true
    }

    if (at !== undefined) {
      turn.last = at
    }
  }

  return turns.map(({ first, last, ...turn }) => {
    const timed = turn.steps.filter(step => step.took !== undefined)

    const slowest = timed.length
      ? timed.reduce((best, step) => ((step.took ?? 0) > (best.took ?? 0) ? step : best))
      : undefined

    return {
      ...turn,
      ...(slowest ? { slowest } : {}),
      ...(first !== undefined && last !== undefined && last >= first ? { span: last - first } : {})
    }
  })
}
