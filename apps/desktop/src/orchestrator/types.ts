/**
 * Orchestrator workspace — data model.
 *
 * Seven stores, per the design: profile identity, one durable context document,
 * append-only context entries, isolated sessions, messages, structured
 * summaries, activity events. Nothing here reaches into React or the gateway:
 * these are plain records so the promotion rules can be tested without a DOM,
 * a database, or a running agent.
 *
 * Invariant that matters most: `ContextEntry` is the ONLY record that may
 * mutate the durable context, and it is produced exclusively by promotion.
 */

export type EntryKind = 'constraint' | 'decision' | 'fact' | 'objective' | 'outcome'

export type SessionStatus =
  | 'awaiting_input'
  | 'cancelled'
  | 'done'
  | 'failed'
  | 'queued'
  | 'running'
  | 'timeout'

export const TERMINAL_SESSION: ReadonlySet<SessionStatus> = new Set<SessionStatus>([
  'cancelled',
  'done',
  'failed',
  'timeout'
])

export type ValidationState = 'empty' | 'malformed' | 'too-large' | 'valid' | 'valid-with-fixes'

export type PromotionState = 'held' | 'pending' | 'promoted' | 'rejected'

export interface ModelRef {
  id: string
  provider: string
}

export interface OrchestratorPolicy {
  contextTtlHours: number
  maxActiveSessions: number
  maxContextTokens: number
  summaryMaxChars: number
}

export interface Profile {
  createdAt: string
  displayName: string
  model: ModelRef
  policy: OrchestratorPolicy
  profileId: string
}

/** Frozen slice handed to a sub-agent. Never a live reference. */
export interface ScopedContext {
  constraints: string[]
  facts: string[]
  objective: string
  revision: number
}

export interface OpenDecision {
  askedAt: string
  id: string
  options: string[]
  question: string
}

export interface ContextFact {
  id: string
  sourceEntry: string
  text: string
  unverified?: boolean
}

export interface DurableContext {
  constraints: string[]
  contextId: string
  facts: ContextFact[]
  objective: string
  openDecisions: OpenDecision[]
  /** Ordered entry ids, oldest first. */
  promoted: string[]
  profileId: string
  /** CAS token. Every accepted promotion bumps it by exactly one. */
  revision: number
  tokenCount: number
  updatedAt: string | null
}

export interface ContextEntry {
  contentHash: string
  contextId: string
  decisionId?: string
  entryId: string
  kind: EntryKind
  provenance: { promotedAt: string; sessionId: string; summaryId: string }
  revisionAtPromotion: number
  supersedes?: string
  text: string
  unverified?: boolean
}

export interface SummaryDraftFact {
  confidence?: number
  text: string
  unverified?: boolean
}

export interface SummaryDraftDecision {
  options?: string[]
  question: string
  recommendation?: string
}

export interface SummaryDraftArtifact {
  kind: string
  ref: string
}

export interface SummaryDraft {
  artifacts?: SummaryDraftArtifact[]
  decisionsNeeded?: SummaryDraftDecision[]
  facts?: SummaryDraftFact[]
  headline?: string
  openQuestions?: string[]
  result?: string
}

export interface Summary {
  artifacts: SummaryDraftArtifact[]
  contentHash: string
  decisionsNeeded: SummaryDraftDecision[]
  facts: SummaryDraftFact[]
  headline: string
  openQuestions: string[]
  partial: boolean
  promotion: { decidedAt: string | null; entryIds: string[]; state: PromotionState }
  result: string
  schemaVersion: 1
  sessionId: string
  summaryId: string
  tokenCost: number
  validation: { dropped: number; fixes: string[]; state: ValidationState }
}

export interface SessionBudget {
  maxToolCalls: number
  maxWallS: number
}

export interface SpawnSpec {
  budget?: Partial<SessionBudget>
  model?: ModelRef
  scopedInstructions: string
  /** Which parts of the durable context this session may see. */
  selectors?: { constraints?: boolean; facts?: number; objective?: boolean }
  title: string
  workspace?: { kind: 'none' | 'worktree'; path?: string }
}

export interface OrchestratorSession {
  budget: SessionBudget
  contextRevisionAtSpawn: number
  endedAt: string | null
  model: ModelRef
  scopedContext: ScopedContext
  scopedInstructions: string
  sessionId: string
  startedAt: string | null
  status: SessionStatus
  statusReason: string | null
  title: string
  workspace: { kind: 'none' | 'worktree'; path?: string }
}

export type ActivityType =
  | 'promotion.accepted'
  | 'promotion.rejected'
  | 'session.cancelled'
  | 'session.failed'
  | 'session.progress'
  | 'session.started'
  | 'session.timeout'
  | 'summary.ready'
  | 'tool.used'

export interface ActivityEvent {
  at: string
  eventId: string
  outcome: 'error' | 'ok' | 'skipped'
  payload: Record<string, unknown>
  sessionId: string
  type: ActivityType
}

/** What a sub-agent is allowed to touch. Deliberately tiny. */
export interface SessionCapability {
  emit: (event: Omit<ActivityEvent, 'at' | 'eventId' | 'sessionId'>) => void
  readScopedContext: () => Readonly<ScopedContext>
  return: (value: SessionReturn) => void
}

export interface SessionReturn {
  result: string
  summary: SummaryDraft
}
