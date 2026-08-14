import type { AuditEntry, Bot, Routine } from './types'

const DEFAULT_BOTS: Bot[] = [
  {
    id: 'bot_cos_981a',
    name: 'Chief of Staff',
    title: 'Daily briefing & calendar triage',
    description: 'Runs weekly briefings, email sweeps, and meeting notes.',
    instructions: 'You are Chief of Staff. You assist with prioritization, executive briefings, and inbox triage.',
    color: '#8B5CF6',
    status: 'idle',
    approval_mode: 'auto',
    workspace_path: '~/.hermes/rakazo/bots/bot_cos_981a/workspace',
    run_count: 14,
    created_at: Date.now() / 1000 - 86400 * 2,
    preview: 'venue booked, contract sent for signature',
    time_label: 'Yesterday',
  },
  {
    id: 'bot_scout_10b9',
    name: 'Scout',
    title: 'Autonomous Research Scout',
    description: 'Autonomous research scout — scans tech intel, news, and market data.',
    instructions: 'You are Scout. Research topics in depth, gather facts, and return concise, bulleted summaries.',
    color: '#10B981',
    status: 'idle',
    approval_mode: 'auto',
    workspace_path: '~/.hermes/rakazo/bots/bot_scout_10b9/workspace',
    run_count: 28,
    created_at: Date.now() / 1000 - 86400 * 5,
    preview: '40 accounts researched, 18 drafts queued',
    time_label: '3:10 AM',
  },
  {
    id: 'bot_mon_7c3a',
    name: 'Monitor',
    title: 'System Health & Security',
    description: 'System health monitor & backup diagnostics in strict approval mode.',
    instructions: 'You are Monitor. Run health audits, check disks, services, and backups. Always ask for permission before modifying system state.',
    color: '#06B6D4',
    status: 'idle',
    approval_mode: 'strict',
    workspace_path: '~/.hermes/rakazo/bots/bot_mon_7c3a/workspace',
    run_count: 8,
    created_at: Date.now() / 1000 - 86400 * 1,
    preview: 'all 6 host services healthy, memory at 24%',
    time_label: 'Monday',
  },
]

export async function fetchBots(): Promise<Bot[]> {
  try {
    const res = await fetch('/api/plugins/rakazo/bots')
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        return data
      }
    }
  } catch (err) {
    // fallback
  }
  return DEFAULT_BOTS
}

export async function createBot(input: {
  name: string
  title?: string
  description?: string
  instructions?: string
  color?: string
  approval_mode?: 'auto' | 'strict'
}): Promise<Bot> {
  const res = await fetch('/api/plugins/rakazo/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      description: input.description || input.title || '',
      instructions: input.instructions || '',
      color: input.color || '#8B5CF6',
      approval_mode: input.approval_mode || 'auto',
    }),
  })
  if (!res.ok) {
    throw new Error('Failed to create bot')
  }
  return res.json()
}

export async function deleteBot(botId: string): Promise<boolean> {
  const res = await fetch(`/api/plugins/rakazo/bots/${botId}`, {
    method: 'DELETE',
  })
  return res.ok
}

export async function sendTurn(botId: string, message: string): Promise<void> {
  await fetch(`/api/plugins/rakazo/bots/${botId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
}

export async function fetchAuditLogs(botId: string): Promise<AuditEntry[]> {
  try {
    const res = await fetch(`/api/plugins/rakazo/bots/${botId}/audit?limit=25`)
    if (res.ok) {
      return res.json()
    }
  } catch (err) {
    // fallback mock data
  }
  return [
    {
      timestamp: Date.now() / 1000 - 45,
      tool_name: 'terminal',
      tool_args: '{"command": "df -h /"}',
      result_summary: 'Filesystem Size Used Avail Use% Mounted on /dev/nvme0n1p2 476G 112G 340G 25% /',
      approved_by: 'auto',
    },
    {
      timestamp: Date.now() / 1000 - 180,
      tool_name: 'search_files',
      tool_args: '{"pattern": "*.json", "path": "workspace"}',
      result_summary: 'Found 4 configuration files',
      approved_by: 'auto',
    },
    {
      timestamp: Date.now() / 1000 - 450,
      tool_name: 'bot_send',
      tool_args: '{"bot": "Scout", "message": "Analyze competitor intel"}',
      result_summary: 'Launched background turn',
      approved_by: 'auto',
    },
  ]
}

export async function fetchRoutines(botId: string): Promise<Routine[]> {
  try {
    const res = await fetch(`/api/plugins/rakazo/bots/${botId}/routines`)
    if (res.ok) {
      return res.json()
    }
  } catch (err) {
    // fallback mock data
  }
  return [
    {
      id: 'r1',
      botId,
      name: 'Morning Intel Sweep',
      prompt: 'Scan latest RSS feeds and arXiv papers on AI accelerators.',
      cron: '0 8 * * 1-5',
      schedule_label: 'Weekdays 8:00 AM',
      active: true,
      lastRunAt: 'Today at 8:00 AM',
    },
    {
      id: 'r2',
      botId,
      name: 'Inbox Zero & Triage',
      prompt: 'Categorize incoming notifications, mark newsletters, flag action items.',
      cron: '0 * * * *',
      schedule_label: 'Hourly',
      active: true,
      lastRunAt: '24 mins ago',
    },
  ]
}
