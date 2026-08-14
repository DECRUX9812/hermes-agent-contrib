export interface Routine {
  id: string
  botId: string
  name: string
  prompt: string
  cron: string
  schedule_label: string
  active: boolean
  lastRunAt?: string
}

export interface HermesAgent {
  id: string
  name: string
  role: string
  description: string
  instructions: string
  color: string
  badge: string
  model: string
  status: 'active' | 'idle' | 'working' | 'running' | 'waiting' | 'error'
  approval_mode: 'auto' | 'strict'
  session_id?: string
  workspace_path: string
  run_count?: number
  created_at?: number
  tokens_used?: number
  latency_ms?: number
  success_rate?: number
  routines?: Routine[]
  tags?: string[]
}

export interface LiveToolCall {
  tool: string
  args: Record<string, unknown> | string
  status: 'running' | 'completed' | 'failed'
  result?: string
  timestamp: number
  duration_ms?: number
}

export interface LiveTurnMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
  tools?: LiveToolCall[]
  createdAt: number
  model?: string
  tokens?: number
}

export interface FleetTelemetry {
  gateway_url: string
  gateway_status: 'online' | 'reconnecting' | 'offline'
  total_turns: number
  active_agents: number
  sentry_alerts: number
  memory_nodes: number
  avg_latency: number
}
