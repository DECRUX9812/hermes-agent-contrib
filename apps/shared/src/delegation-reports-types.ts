export type DelegationReportOutcome = 'done' | 'needs_decision' | 'failed'
export type DelegationReportSummarySource = 'model' | 'heuristic'

export interface DelegationReport {
  delegation_id: string
  state: string
  outcome: DelegationReportOutcome
  title: string
  summary: string
  summary_source: DelegationReportSummarySource
  task_count: number
  completed_count: number
  failed_count: number
  duration_seconds?: number | null
  completed_at?: number | null
  delivery_state?: string
  child_session_ids?: Record<string, string>
  group?: string | null
}

export interface DelegationReportsResult {
  reports: DelegationReport[]
}

export interface SessionAskResult {
  answer: string
  resolved_id: string
  messages_considered: number
  truncated: boolean
}
