/**
 * Sub-agent session hub — isolation, lifecycle, and the activity trail.
 *
 * Every session gets (a) a frozen snapshot of the durable context, (b) a
 * capability object with exactly three methods, and (c) a wall clock budget.
 * There is no code path from a session to the `ContextStore`: the only way its
 * work becomes durable is a summary, and only the orchestrator may promote one.
 *
 * Lifecycle: queued → running → (awaiting_input) → done | failed | cancelled |
 * timeout. Terminal states are final; `sweep()` is what turns a hung session
 * into a `timeout` without a timer per session.
 */

import { hygiene } from './hygiene'
import { projectContext } from './context'
import type { ContextStore } from './context'
import type {
  ActivityEvent,
  ActivityType,
  DurableContext,
  ModelRef,
  OrchestratorSession,
  ScopedContext,
  SessionBudget,
  SessionCapability,
  SessionReturn,
  SessionStatus,
  SpawnSpec,
  Summary
} from './types'
import { TERMINAL_SESSION } from './types'

const DEFAULT_BUDGET: SessionBudget = { maxToolCalls: 40, maxWallS: 900 }

export interface SessionView {
  currentAction: string
  elapsedS: number
  lastEvent: ActivityEvent | undefined
  session: OrchestratorSession
  summary: Summary | undefined
}

type Listener = (event: ActivityEvent) => void

export interface SessionHubDeps {
  maxActiveSessions?: number
  nextId?: () => string
  now?: () => string
}

export class SessionHub {
  private readonly sessions = new Map<string, OrchestratorSession>()
  private readonly summaries = new Map<string, Summary>()
  private readonly returns = new Map<string, SessionReturn>()
  private readonly events: ActivityEvent[] = []
  private readonly listeners = new Set<Listener>()
  private readonly maxActive: number
  private readonly nextId: () => string
  private readonly now: () => string
  private seq = 0

  constructor(deps: SessionHubDeps = {}) {
    this.maxActive = deps.maxActiveSessions ?? 8
    this.nextId = deps.nextId ?? (() => `s-${Math.random().toString(36).slice(2, 10)}`)
    this.now = deps.now ?? (() => new Date().toISOString())
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  spawn(spec: SpawnSpec, ctx: DurableContext, model: ModelRef): OrchestratorSession {
    if (this.active().length >= this.maxActive) {
      throw new Error(`session cap reached (${this.maxActive}); cancel or wait before spawning`)
    }
    const session: OrchestratorSession = {
      budget: { ...DEFAULT_BUDGET, ...spec.budget },
      contextRevisionAtSpawn: ctx.revision,
      endedAt: null,
      model: spec.model ?? model,
      scopedContext: freezeContext(projectContext(ctx, spec.selectors)),
      scopedInstructions: spec.scopedInstructions,
      sessionId: this.nextId(),
      startedAt: this.now(),
      status: 'running',
      statusReason: null,
      title: spec.title,
      workspace: spec.workspace ?? { kind: 'none' }
    }
    this.sessions.set(session.sessionId, session)
    this.emit(session.sessionId, 'session.started', { goal: spec.title }, 'ok')

    return session
  }

  /** The only surface a sub-agent runtime should receive. */
  capability(sessionId: string): SessionCapability {
    this.require(sessionId) // fail fast on an unknown session

    // Always read the CURRENT record: a capability captured before a cancel or
    // a failure must not keep writing into a terminal session.
    const live = () => this.require(sessionId)

    return {
      emit: (event): void => {
        if (TERMINAL_SESSION.has(live().status)) return
        this.emit(sessionId, event.type, event.payload, event.outcome)
      },
      readScopedContext: (): Readonly<ScopedContext> => live().scopedContext,
      return: (value): void => {
        if (TERMINAL_SESSION.has(live().status)) return
        this.returns.set(sessionId, value)
        this.transition(sessionId, 'done', null)
        this.finish(sessionId, value, false)
      }
    }
  }

  complete(sessionId: string, value: SessionReturn): Summary {
    this.returns.set(sessionId, value)
    this.transition(sessionId, 'done', null)

    return this.finish(sessionId, value, false)
  }

  cancel(sessionId: string, reason: string): { session: OrchestratorSession; summary: Summary | undefined } {
    this.require(sessionId)
    if (!TERMINAL_SESSION.has(this.require(sessionId).status)) this.transition(sessionId, 'cancelled', reason)
    const partial = this.finish(sessionId, this.returns.get(sessionId), true)

    // Re-read: the caller needs the terminal record, not the pre-transition one.
    return { session: this.require(sessionId), summary: partial }
  }

  fail(sessionId: string, reason: string): Summary | undefined {
    if (!TERMINAL_SESSION.has(this.require(sessionId).status)) this.transition(sessionId, 'failed', reason)

    return this.finish(sessionId, this.returns.get(sessionId), true)
  }

  /** Turn hung sessions into `timeout` and salvage whatever they returned. */
  sweep(nowMs = Date.parse(this.now())): OrchestratorSession[] {
    const timedOut: OrchestratorSession[] = []
    for (const session of this.sessions.values()) {
      if (TERMINAL_SESSION.has(session.status) || !session.startedAt) continue
      const elapsed = (nowMs - Date.parse(session.startedAt)) / 1000
      if (elapsed <= session.budget.maxWallS) continue
      this.transition(session.sessionId, 'timeout', `exceeded ${session.budget.maxWallS}s`)
      this.finish(session.sessionId, this.returns.get(session.sessionId), true)
      timedOut.push(session)
    }

    return timedOut
  }

  // ── reads ────────────────────────────────────────────────────────────────

  get(sessionId: string): OrchestratorSession | undefined {
    return this.sessions.get(sessionId)
  }

  all(): OrchestratorSession[] {
    return [...this.sessions.values()]
  }

  active(): OrchestratorSession[] {
    return this.all().filter(s => !TERMINAL_SESSION.has(s.status))
  }

  summary(sessionId: string): Summary | undefined {
    return this.summaries.get(sessionId)
  }

  eventsFor(sessionId?: string): ActivityEvent[] {
    return sessionId ? this.events.filter(e => e.sessionId === sessionId) : [...this.events]
  }

  /** What the side panel renders for one row. */
  view(sessionId: string): SessionView {
    const session = this.require(sessionId)
    const events = this.eventsFor(sessionId)
    const last = events.at(-1)
    const end = session.endedAt ? Date.parse(session.endedAt) : Date.parse(this.now())

    return {
      currentAction: describeAction(session, last),
      elapsedS: session.startedAt ? Math.max(0, Math.round((end - Date.parse(session.startedAt)) / 1000)) : 0,
      lastEvent: last,
      session,
      summary: this.summaries.get(sessionId)
    }
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener)

    return () => this.listeners.delete(listener)
  }

  // ── internals ────────────────────────────────────────────────────────────

  private finish(sessionId: string, value: SessionReturn | undefined, partial: boolean): Summary {
    const session = this.require(sessionId)
    const existing = this.summaries.get(sessionId)
    if (existing) return existing

    const draft = value?.summary ?? {}
    const summary = hygiene(sessionId, `sm-${sessionId}`, draft, {
      knownFactTexts: [],
      now: this.now()
    })
    const marked: Summary = {
      ...summary,
      partial,
      // A partial summary can never carry a decision: nothing was verified.
      decisionsNeeded: partial ? [] : summary.decisionsNeeded,
      validation: partial
        ? { ...summary.validation, fixes: [...summary.validation.fixes, 'partial:session ended early'] }
        : summary.validation
    }
    this.summaries.set(sessionId, marked)
    this.emit(sessionId, 'summary.ready', { state: marked.validation.state, partial }, marked.validation.state === 'malformed' ? 'error' : 'ok')

    return marked
  }

  private transition(sessionId: string, status: SessionStatus, reason: string | null): void {
    const session = this.require(sessionId)
    if (TERMINAL_SESSION.has(session.status)) return
    this.sessions.set(sessionId, {
      ...session,
      endedAt: TERMINAL_SESSION.has(status) ? this.now() : session.endedAt,
      status,
      statusReason: reason
    })
    const type: ActivityType =
      status === 'failed'
        ? 'session.failed'
        : status === 'cancelled'
          ? 'session.cancelled'
          : status === 'timeout'
            ? 'session.timeout'
            : 'session.progress'
    // `done` is announced by summary.ready in finish(); a second progress event
    // would duplicate it in the panel trail.
    if (status !== 'running' && status !== 'done') {
      const outcome = status === 'failed' || status === 'timeout' ? 'error' : 'ok'
      this.emit(sessionId, type, { reason }, outcome)
    }
  }

  private emit(sessionId: string, type: ActivityType, payload: Record<string, unknown>, outcome: 'error' | 'ok' | 'skipped'): void {
    const event: ActivityEvent = {
      at: this.now(),
      eventId: `ev-${++this.seq}`,
      outcome,
      payload,
      sessionId,
      type
    }
    this.events.push(event)
    for (const l of this.listeners) l(event)
  }

  private require(sessionId: string): OrchestratorSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`unknown session ${sessionId}`)

    return session
  }
}

function freezeContext(ctx: ScopedContext): ScopedContext {
  return Object.freeze({
    ...ctx,
    constraints: Object.freeze([...ctx.constraints]) as unknown as string[],
    facts: Object.freeze([...ctx.facts]) as unknown as string[]
  })
}

/** One line the panel can show: what this session is doing right now. */
export function describeAction(session: OrchestratorSession, last?: ActivityEvent): string {
  if (session.status === 'failed') return session.statusReason ?? 'failed'
  if (session.status === 'cancelled') return session.statusReason ?? 'cancelled'
  if (session.status === 'timeout') return session.statusReason ?? 'timed out'
  if (session.status === 'done') return 'returned a summary'
  if (session.status === 'awaiting_input') return session.statusReason ?? 'waiting for an answer'
  if (!last) return 'starting'
  const tool = typeof last.payload.tool === 'string' ? last.payload.tool : undefined
  const line = typeof last.payload.line === 'string' ? last.payload.line : undefined
  if (last.type === 'tool.used') return tool ? `running ${tool}` : line ?? 'running a tool'

  return line ?? 'working'
}
