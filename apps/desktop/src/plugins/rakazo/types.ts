export interface Bot {
  id: string
  name: string
  title: string
  description: string
  instructions: string
  color: string
  status: 'idle' | 'running' | 'waiting' | 'error' | 'suspended'
  approval_mode: 'auto' | 'strict'
  workspace_path: string
  model?: string
  run_count?: number
  created_at?: number
  last_run_at?: number
  preview?: string
  time_label?: string
}

export interface CardLine {
  k: string
  v: string
  icon?: string
}

export type MessageBlock =
  | { kind: 'text'; text: string }
  | { kind: 'card'; lines: CardLine[] }
  | { kind: 'ask'; text: string; detail?: string; actions?: Array<{ id: string; label: string }> }
  | { kind: 'subagent'; agentId: string; name: string; task: string; status: 'running' | 'completed' | 'failed'; result?: string }
  | { kind: 'meta'; text: string }
  | { kind: 'progress'; text: string }

export interface ThreadMessage {
  id: string
  role: 'user' | 'bot' | 'system'
  blocks: MessageBlock[]
  createdAt: string | number
  runId?: string
}

export interface Routine {
  id: string
  botId: string
  name: string
  prompt: string
  cron: string
  schedule_label: string
  active: boolean
  lastRunAt?: string | null
}

export interface ComputerState {
  state: 'stopped' | 'booting' | 'running' | 'suspended' | 'error'
  controlHolder: 'bot' | 'user' | 'none'
  url?: string
  screenTitle?: string
  activeLines?: string[]
}

export interface AuditEntry {
  id?: number
  timestamp: number
  tool_name: string
  tool_args: string
  result_summary?: string
  approved_by: 'auto' | 'user' | 'strict-blocked'
}
