/**
 * Durable orchestrator context.
 *
 * One document per profile, mutated by exactly one door: `promote()`. A
 * promotion is versioned (CAS on `revision`), idempotent (content hash), and
 * auditable (the entry keeps its summary + session provenance). Sub-agents hold
 * no reference to this object — they receive a frozen `ScopedContext` snapshot
 * and hand back a summary, which is the only thing that can become an entry.
 *
 * Persistence is deliberately out of scope: the app wraps this in an atom and
 * writes `value()` after a successful promote. Keeping the store synchronous is
 * what makes the concurrency rules testable.
 */

import { compactFacts, contentHash, estimateTokens } from './hygiene'
import type {
  ContextEntry,
  ContextFact,
  DurableContext,
  EntryKind,
  OpenDecision,
  OrchestratorPolicy,
  ScopedContext,
  Summary
} from './types'

export type PromoteResult =
  | { entryId: string; revision: number; state: 'promoted' }
  | { entryId: string; state: 'duplicate' }
  | { currentRevision: number; state: 'conflict' }
  | { reason: string; state: 'rejected' }

export interface PromoteOptions {
  /** CAS token the caller read. Omit to force-apply (bootstrap/repair only). */
  expectedRevision?: number
  /** Why this was promoted — recorded on the entry, shown in the audit trail. */
  reason?: string
  kind?: EntryKind
}

export interface ContextStoreDeps {
  now?: () => string
  nextEntryId?: () => string
}

const DEFAULT_POLICY: OrchestratorPolicy = {
  contextTtlHours: 720,
  maxActiveSessions: 8,
  maxContextTokens: 32000,
  summaryMaxChars: 1200
}

export function bootstrapContext(profileId: string, contextId = `ctx-${profileId}`): DurableContext {
  return {
    constraints: [],
    contextId,
    facts: [],
    objective: '',
    openDecisions: [],
    promoted: [],
    profileId,
    revision: 0,
    tokenCount: 0,
    updatedAt: null
  }
}

/** Pure reducer: the whole promotion semantics live here. */
export function applyEntry(ctx: DurableContext, entry: ContextEntry, policy: OrchestratorPolicy): DurableContext {
  const next: DurableContext = {
    ...ctx,
    constraints: [...ctx.constraints],
    facts: [...ctx.facts],
    openDecisions: [...ctx.openDecisions],
    promoted: [...ctx.promoted, entry.entryId],
    revision: ctx.revision + 1,
    updatedAt: entry.provenance.promotedAt
  }

  switch (entry.kind) {
    case 'objective':
      next.objective = entry.text
      break
    case 'constraint':
      if (!next.constraints.some(c => c.toLowerCase() === entry.text.toLowerCase())) next.constraints.push(entry.text)
      break
    case 'decision': {
      // A promoted decision closes the matching open question, or opens one.
      const decisionId = entry.decisionId
      next.openDecisions = decisionId
        ? next.openDecisions.filter(d => d.id !== decisionId)
        : [...next.openDecisions, toDecision(entry)]
      break
    }
    case 'fact':
    case 'outcome': {
      const fact: ContextFact = {
        id: entry.entryId,
        sourceEntry: entry.entryId,
        text: entry.text,
        unverified: entry.unverified
      }
      next.facts.push(fact)
      break
    }
  }

  // Budget: compact weakest facts first, then keep the objective/constraints intact.
  if (estimateContextTokens(next) > policy.maxContextTokens) {
    const budget = Math.floor(policy.maxContextTokens * 0.6) * 4
    next.facts = compactFacts(next.facts, budget)
  }
  next.tokenCount = estimateContextTokens(next)

  return next
}

function toDecision(entry: ContextEntry): OpenDecision {
  return { askedAt: entry.provenance.promotedAt, id: entry.entryId, options: [], question: entry.text }
}

export function estimateContextTokens(ctx: DurableContext): number {
  return estimateTokens(
    [ctx.objective, ...ctx.constraints, ...ctx.facts.map(f => f.text), ...ctx.openDecisions.map(d => d.question)].join(' ')
  )
}

/** The slice a sub-agent may see. Always a fresh object: never a live handle. */
export function projectContext(ctx: DurableContext, selectors: { constraints?: boolean; facts?: number; objective?: boolean } = {}): ScopedContext {
  const { constraints = true, facts = 8, objective = true } = selectors

  return {
    constraints: constraints ? [...ctx.constraints] : [],
    facts: facts > 0 ? ctx.facts.slice(-facts).map(f => f.text) : [],
    objective: objective ? ctx.objective : '',
    revision: ctx.revision
  }
}

export class ContextStore {
  private current: DurableContext
  private readonly now: () => string
  private readonly nextEntryId: () => string
  private readonly policy: OrchestratorPolicy

  constructor(context: DurableContext, deps: ContextStoreDeps & { policy?: Partial<OrchestratorPolicy> } = {}) {
    this.current = context
    this.policy = { ...DEFAULT_POLICY, ...deps.policy }
    this.now = deps.now ?? (() => new Date().toISOString())
    this.nextEntryId = deps.nextEntryId ?? (() => `ce-${Math.random().toString(36).slice(2, 10)}`)
  }

  get policyView(): OrchestratorPolicy {
    return this.policy
  }

  value(): DurableContext {
    return this.current
  }

  /** Is the context old enough to be flagged? Drives the amber dot in the spot. */
  isStale(nowMs = Date.parse(this.now())): boolean {
    if (!this.current.updatedAt) return false

    return (nowMs - Date.parse(this.current.updatedAt)) / 3_600_000 > this.policy.contextTtlHours
  }

  /**
   * The single mutation door.
   *
   * Rejections are values, not exceptions, so the UI can explain them:
   * `duplicate` names the existing entry, `conflict` carries the revision to
   * retry against, `rejected` carries the validation reason.
   */
  promote(summary: Summary, opts: PromoteOptions = {}): PromoteResult {
    if (summary.validation.state === 'malformed' || summary.validation.state === 'empty') {
      return { reason: `not promotable: ${summary.validation.state}`, state: 'rejected' }
    }
    if (opts.expectedRevision !== undefined && opts.expectedRevision !== this.current.revision) {
      return { currentRevision: this.current.revision, state: 'conflict' }
    }

    const kind = opts.kind ?? inferKind(summary)
    const entryId = this.nextEntryId()
    const entry: ContextEntry = {
      contentHash: summary.contentHash,
      contextId: this.current.contextId,
      entryId,
      kind,
      provenance: { promotedAt: this.now(), sessionId: summary.sessionId, summaryId: summary.summaryId },
      revisionAtPromotion: this.current.revision,
      text: kind === 'objective' ? summary.headline : summary.result || summary.headline,
      unverified: summary.facts.every(f => f.unverified)
    }

    const duplicate = this.findDuplicate(entry.contentHash)
    if (duplicate) return { entryId: duplicate.entryId, state: 'duplicate' }

    this.current = applyEntry(this.current, entry, this.policy)
    this.remember(entry)

    return { entryId, revision: this.current.revision, state: 'promoted' }
  }

  /** Facts already in context — the hygiene layer uses this to drop repeats. */
  knownFactTexts(): string[] {
    return this.current.facts.map(f => f.text)
  }

  private findDuplicate(hash: string): ContextEntry | undefined {
    // Entries are not retained wholesale in the context document; the hash of
    // the promoted text is, through `facts[].sourceEntry` + `promoted` order.
    // Callers that need full entry records persist them separately; for dedupe
    // within one process, we track hashes alongside the ids.
    return this.hashIndex.get(hash)
  }

  private readonly hashIndex = new Map<string, ContextEntry>()

  /** Test/repair hook: seed the dedupe index from persisted entries. */
  seedEntries(entries: readonly ContextEntry[]): void {
    for (const e of entries) this.hashIndex.set(e.contentHash, e)
  }

  /** Record the entry in the dedupe index after a successful promote. */
  private remember(entry: ContextEntry): void {
    this.hashIndex.set(entry.contentHash, entry)
  }

  static bootstrap(profileId: string, contextId?: string): ContextStore {
    return new ContextStore(bootstrapContext(profileId, contextId))
  }
}

function inferKind(summary: Summary): EntryKind {
  if (summary.decisionsNeeded.length > 0) return 'decision'

  return summary.facts.length > 0 ? 'fact' : 'outcome'
}

export const __test = { contentHash }
