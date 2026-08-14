import { host } from '@hermes/plugin-sdk'
import type { HermesAgent, LiveTurnMessage, Routine } from './types'

export interface RakazoBot {
  id: string
  name: string
  description?: string
  instructions?: string
  color?: string
  status?: string
  approval_mode?: 'auto' | 'strict'
  workspace_path?: string
  model?: string
  session_id?: string | null
  run_count?: number
  created_at?: number
}

export const DEFAULT_HERMES_SQUAD: HermesAgent[] = [
  {
    id: 'agent_prime',
    name: 'Hermes Prime',
    role: 'Chief Operations & Multi-Agent Synthesis',
    description: 'Orchestrates complex multi-agent pipelines, delegates subtasks, and provides high-signal executive synthesis.',
    instructions: `You are Hermes Prime, the chief orchestrator of the Hermes Fleet.
- Synthesize data and findings from Scout (Recon), Architect (Builder), and Guardian (Sentry).
- Make decisive executive decisions with clean, structured rationale.
- Maintain zero regressions and verify all artifacts before delivery.`,
    color: '#FFBF00',
    badge: 'ORCHESTRATOR',
    model: 'deepseek-v4-flash',
    status: 'active',
    approval_mode: 'auto',
    workspace_path: '~/.hermes/fleet/prime/workspace',
    run_count: 42,
    tokens_used: 184500,
    latency_ms: 320,
    success_rate: 99.4,
    tags: ['Orchestration', 'Executive', 'Synthesis'],
    routines: [
      {
        id: 'r_prime_01',
        botId: 'agent_prime',
        name: 'Morning Executive Briefing',
        prompt: 'Scan memory, recent turns, and system health to deliver high-signal morning briefing.',
        cron: '0 8 * * 1-5',
        schedule_label: 'Weekdays 8:00 AM',
        active: true,
        lastRunAt: 'Today 8:00 AM'
      },
      {
        id: 'r_prime_02',
        botId: 'agent_prime',
        name: 'Squad Memory Pruning & Consolidation',
        prompt: 'Consolidate completed workstream memories into persistent long-term memory graph.',
        cron: '0 23 * * 0',
        schedule_label: 'Sundays 11:00 PM',
        active: true,
        lastRunAt: '3 days ago'
      }
    ]
  },
  {
    id: 'agent_scout',
    name: 'Scout 01',
    role: 'Market Recon, arXiv & Technical Intel',
    description: 'Autonomous research specialist — scours arXiv papers, GitHub repos, technical docs, and market signals with high-speed automated turns.',
    instructions: `You are Scout 01. Research topics in depth, gather verifiable evidence and cited links, and return crisp structured dossiers.`,
    color: '#06B6D4',
    badge: 'RECON SPECIALIST',
    model: 'gemini-3.7-flash',
    status: 'running',
    approval_mode: 'auto',
    workspace_path: '~/.hermes/fleet/scout/workspace',
    run_count: 88,
    tokens_used: 412000,
    latency_ms: 195,
    success_rate: 98.8,
    tags: ['Research', 'arXiv', 'Market Data'],
    routines: [
      {
        id: 'r_scout_01',
        botId: 'agent_scout',
        name: 'Semiconductor & EUV Research Sweep',
        prompt: 'Scan latest papers on high-NA EUV, photonic interconnects, and HBM4 packaging.',
        cron: '0 7 * * *',
        schedule_label: 'Daily 7:00 AM',
        active: true,
        lastRunAt: 'Today 7:00 AM'
      }
    ]
  },
  {
    id: 'agent_architect',
    name: 'Architect',
    role: 'Code Synthesis, Refactoring & CI Verification',
    description: 'Full-stack builder — writes production-grade code, builds test suites, manages worktrees, and guarantees zero regressions.',
    instructions: `You are Architect. Write clean, idiomatic code, write exhaustive unit tests, and verify builds before claiming completion.`,
    color: '#A855F7',
    badge: 'LEAD BUILDER',
    model: 'opencode-go/deepseek-v4-flash',
    status: 'working',
    approval_mode: 'auto',
    workspace_path: '~/.hermes/fleet/architect/workspace',
    run_count: 64,
    tokens_used: 320900,
    latency_ms: 410,
    success_rate: 99.1,
    tags: ['TypeScript', 'Python', 'Refactoring'],
    routines: [
      {
        id: 'r_arch_01',
        botId: 'agent_architect',
        name: 'Nightly CI Health & Test Suite Check',
        prompt: 'Run full test suites across all packages and report code coverage metrics.',
        cron: '0 2 * * *',
        schedule_label: 'Daily 2:00 AM',
        active: true,
        lastRunAt: 'Today 2:00 AM'
      }
    ]
  },
  {
    id: 'agent_guardian',
    name: 'Guardian',
    role: 'Security Sentry & Infrastructure Gatekeeper',
    description: 'Security sentry — monitors NVMe storage, ZFS pools, Tailnet traffic, and intercepts privileged writes behind human consent gates.',
    instructions: `You are Guardian. Verify all host backups and disk scope before destructive modifications. Intercept dangerous operations and log immutable audit entries.`,
    color: '#EF4444',
    badge: 'STRICT SENTRY',
    model: 'claude-sonnet-4.6',
    status: 'idle',
    approval_mode: 'strict',
    workspace_path: '~/.hermes/fleet/guardian/workspace',
    run_count: 31,
    tokens_used: 98400,
    latency_ms: 550,
    success_rate: 100.0,
    tags: ['Security', 'Audit', 'Strict Gate'],
    routines: [
      {
        id: 'r_guard_01',
        botId: 'agent_guardian',
        name: 'Proxmox VM & ZFS Backup Verification',
        prompt: 'Verify nightly vzdump backups on 192.168.0.181 and check disk storage capacity.',
        cron: '30 3 * * *',
        schedule_label: 'Daily 3:30 AM',
        active: true,
        lastRunAt: 'Today 3:30 AM'
      }
    ]
  },
]

function toHermesAgent(b: RakazoBot, index: number): HermesAgent {
  const palette = ['#FFBF00', '#06B6D4', '#A855F7', '#EF4444', '#10B981', '#EC4899']
  return {
    id: b.id,
    name: b.name,
    role: b.description || 'Specialist Operator',
    description: b.description || 'Hermes autonomous operator',
    instructions: b.instructions || 'Decisive execution with high signal.',
    color: b.color || palette[index % palette.length],
    badge: b.approval_mode === 'strict' ? 'STRICT SENTRY' : 'AUTONOMOUS',
    model: b.model || 'deepseek-v4-flash',
    status: (b.status as HermesAgent['status']) || 'active',
    approval_mode: b.approval_mode === 'strict' ? 'strict' : 'auto',
    session_id: b.session_id || undefined,
    workspace_path: b.workspace_path || `~/.hermes/fleet/${b.name.toLowerCase()}/workspace`,
    run_count: b.run_count || (index + 1) * 7,
    created_at: b.created_at,
    tokens_used: (index + 1) * 45000,
    latency_ms: 220 + index * 40,
    success_rate: 99.0,
  }
}

async function rakazoApi<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const bridge = typeof window !== 'undefined' ? window.hermesDesktop : undefined

  if (bridge?.api) {
    return bridge.api<T>({
      path: `/api/plugins/rakazo${path}`,
      method: opts.method,
      body: opts.body,
      timeoutMs: 10_000,
    })
  }

  const res = await fetch(`/api/plugins/rakazo${path}`, {
    method: opts.method,
    headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (!res.ok) {
    throw new Error(`rakazo ${opts.method ?? 'GET'} ${path} → ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function isRakazoAgent(agent: HermesAgent): boolean {
  return agent.id.startsWith('bot_')
}

export function isFakeSessionId(sid: string | null | undefined): boolean {
  return !sid || sid === 'LOCAL' || sid.startsWith('fleet_session_')
}

export async function fetchHermesAgents(): Promise<{ agents: HermesAgent[]; live: boolean }> {
  try {
    const data = await rakazoApi<RakazoBot[]>('/bots')
    if (Array.isArray(data) && data.length > 0) {
      return { agents: data.map(toHermesAgent), live: true }
    }
  } catch (err) {
    // offline fallback
  }
  return { agents: DEFAULT_HERMES_SQUAD, live: false }
}

export async function updateAgentSettings(botId: string, fields: Partial<HermesAgent>): Promise<boolean> {
  try {
    await rakazoApi<unknown>(`/bots/${encodeURIComponent(botId)}`, {
      method: 'PATCH',
      body: {
        model: fields.model,
        approval_mode: fields.approval_mode,
        instructions: fields.instructions,
        color: fields.color,
      },
    })
    return true
  } catch (e) {
    return false
  }
}

export async function bindBotSession(botId: string, sessionId: string): Promise<void> {
  if (!isRakazoAgent({ id: botId } as HermesAgent)) return
  try {
    await rakazoApi<unknown>(`/bots/${encodeURIComponent(botId)}`, {
      method: 'PATCH',
      body: { session_id: sessionId },
    })
  } catch (err) {}
}

export async function spawnRakazoBot(input: {
  name: string
  description?: string
  instructions?: string
  color?: string
  approval_mode?: 'auto' | 'strict'
  model?: string
}): Promise<RakazoBot> {
  return rakazoApi<RakazoBot>('/bots', {
    method: 'POST',
    body: {
      name: input.name,
      description: input.description || '',
      instructions: input.instructions || '',
      color: input.color || '#8B5CF6',
      approval_mode: input.approval_mode || 'auto',
      model: input.model || 'deepseek-v4-flash',
    },
  })
}

export async function ensureAgentSession(agent: HermesAgent): Promise<string | null> {
  if (agent.session_id && !isFakeSessionId(agent.session_id)) {
    return agent.session_id
  }
  try {
    const created = await host.request<{ session_id: string }>('session.create', {
      title: `[Hermes Fleet] ${agent.name}`,
      model: agent.model,
      cwd: agent.workspace_path.replace(/^~/, ''),
    })
    const sid = created.session_id
    if (sid) {
      void bindBotSession(agent.id, sid)
    }
    return sid
  } catch (err) {
    return null
  }
}

export async function submitLivePrompt(sessionId: string | null, text: string, agentId: string): Promise<void> {
  if (!isFakeSessionId(sessionId)) {
    try {
      await host.request('prompt.submit', {
        session_id: sessionId,
        text,
      })
      return
    } catch (err) {}
  }
  try {
    await rakazoApi<unknown>(`/bots/${encodeURIComponent(agentId)}/send`, {
      method: 'POST',
      body: { message: text },
    })
  } catch (err) {}
}

export async function fetchLiveHistory(sessionId: string | null): Promise<LiveTurnMessage[]> {
  if (isFakeSessionId(sessionId)) {
    return []
  }
  try {
    const res = await host.request<{
      messages?: Array<{ role?: string; text?: string; row_id?: number | string }>
    }>('session.resume', {
      session_id: sessionId,
      lazy: true,
      omit_messages: false,
    })
    const messages = res?.messages
    if (Array.isArray(messages)) {
      return messages
        .map((m, idx) => ({
          id: m.row_id !== undefined ? `row_${m.row_id}` : `msg_${idx}`,
          role: (m.role as LiveTurnMessage['role']) || 'assistant',
          text: m.text || '',
          createdAt: Date.now() - (messages.length - idx) * 1000,
        }))
        .filter((m) => m.text.trim().length > 0)
    }
  } catch (err) {}
  return []
}
