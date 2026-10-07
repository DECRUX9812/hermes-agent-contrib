/**
 * Development-only visual fixture. Renders the production components, but never
 * starts a gateway or uses real profiles. Not an Electron build entry point.
 */
import '../src/styles.css'
import './refinement-preview.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { atom } from 'nanostores'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { ActivityTask } from '../src/lib/activity-tasks'
import type { TeamView } from '../src/plugins/hermes-bots/team'
import type { RosterRow } from '../src/plugins/hermes-bots/types'

const { BROWSER_BRIDGE_STUBS } = await import('../src/lib/browser-bridge-stubs')
window.hermesDesktop = {
  ...BROWSER_BRIDGE_STUBS,
  api: async () => ({}) as never,
  getConnection: async () => null,
  getConnectionFor: async () => null,
  getProfileRoutes: async () => [],
  getAgentRoster: async () => [],
  getRecentLogs: async () => [],
  onConnectionChanged: () => () => {},
  onThemeChanged: () => () => {},
  warmProfile: async () => {}
} as unknown as Window['hermesDesktop']

const sdk = await import('../src/sdk')
const { registerPluginLocales } = await import('../src/i18n/plugin-i18n')
const { BOTS_LOCALES } = await import('../src/plugins/hermes-bots/i18n')
const { TEAM_LOCALES } = await import('../src/plugins/hermes-bots/team-i18n')
const { AUTOPILOT_LOCALES } = await import('../src/plugins/hermes-bots/autopilot-i18n')
const { SHARE_LOCALES } = await import('../src/plugins/hermes-bots/share-i18n')
for (const bundle of [BOTS_LOCALES, TEAM_LOCALES, AUTOPILOT_LOCALES, SHARE_LOCALES]) {
  registerPluginLocales('hermes-bots', bundle)
}

const now = Date.now() / 1000
const tasks: ActivityTask[] = [
  {
    id: 'task-a',
    title: 'Review the desktop navigation',
    outcome: 'Updated the keyboard navigation and documented the interaction contract.',
    status: 'done',
    startedAt: now - 600,
    completedAt: now - 240,
    steps: [],
    errorCount: 0
  },
  {
    id: 'task-b',
    title: 'Validate the team workspace',
    outcome: '',
    status: 'running',
    startedAt: now - 120,
    completedAt: null,
    steps: [
      {
        id: 'step-b',
        verb: 'ran',
        subject: 'npm run typecheck',
        action: {
          id: 'step-b',
          tool: 'terminal',
          target: 'npm run typecheck',
          input: 'npm run typecheck',
          output: '',
          startedAt: now - 90,
          completedAt: null,
          exitCode: null,
          status: 'running'
        }
      }
    ],
    errorCount: 0
  }
]
const roster: RosterRow[] = [
  {
    name: 'scout',
    connectionId: 'local',
    title: 'Scout',
    model: 'Research model',
    canonical_session: {
      id: 'chat-scout',
      preview: 'Saved the research brief with verified sources.',
      last_active: now - 240
    }
  },
  {
    name: 'builder',
    connectionId: 'local',
    title: 'Builder',
    model: 'Code model',
    canonical_session: { id: 'chat-builder', preview: 'Running the desktop validation checks.', last_active: now - 90 }
  },
  {
    name: 'editor',
    connectionId: 'local',
    title: 'Editor',
    model: 'Writing model',
    canonical_session: { id: 'chat-editor', preview: 'The handoff is ready for review.', last_active: now - 900 }
  }
]
const budget = { hard_stop: true, monthly_usd: 25, spent_usd: 8.5 }
const member = (slot: string, profile: string, role: string, lead = false) => ({
  slot,
  profile,
  role,
  lead,
  title: '',
  reports_to: lead ? null : 'seat-builder',
  status: 'active',
  budget,
  skills: [],
  credentials: [],
  plugins: []
})
const members = [
  member('seat-builder', 'builder', 'Engineering lead', true),
  member('seat-scout', 'scout', 'Research & sources'),
  member('seat-editor', 'editor', 'Writing & review')
]
const team: TeamView = {
  team: {
    id: 'review-team',
    name: 'Desktop studio',
    mission: 'Ship a desktop workspace that makes every agent’s work easy to follow.',
    members,
    approvals: [
      {
        id: 'approval-1',
        kind: 'action',
        subject: 'Review the release handoff',
        requested_by: 'builder',
        detail: 'The validation summary is ready.',
        note: '',
        created_at: now - 60,
        status: 'pending'
      }
    ],
    goals: [
      {
        id: 'goal-1',
        title: 'Refine the desktop workspace',
        detail: '',
        parent_id: null,
        owner: 'seat-builder',
        status: 'active',
        task_ids: ['a', 'b', 'c', 'd']
      }
    ],
    learnings: [
      { id: 'lesson-1', text: 'A failed connection is not an empty workspace.', at: now, by: 'builder', count: 2 }
    ],
    policy: { lead_decides: false },
    channels: {},
    updated_at: now
  },
  tree: [{ ...members[0], reports: members.slice(1).map(m => ({ ...m, reports: [] })) }],
  rollup: {
    overall: { done: 3, total: 4, percent: 75 },
    goals: { 'goal-1': { done: 3, total: 4, percent: 75, blocked: false, status: 'active' } }
  }
}
const $activity = atom<readonly ActivityTask[]>(tasks)
Object.assign(sdk.host.state, {
  focusedActivity: $activity,
  focusedSessionId: atom('runtime-builder'),
  focusedStoredSessionId: atom('chat-builder'),
  focusedSessionOwner: atom({ connectionId: 'local', profile: 'builder' }),
  connectionId: atom('local'),
  gatewayState: atom('connected')
})
const request = async (method: string, params: Record<string, unknown> = {}) => {
  if (method === 'profiles.list') return { profiles: roster }
  if (method === 'bots_team.list')
    return {
      teams: [{ ...team.team, pending_approvals: team.team.approvals.filter(a => a.status === 'pending').length }]
    }
  if (method === 'bots_team.get') return team
  if (method === 'bots_team.approval.decide') {
    team.team.approvals = team.team.approvals.map(a =>
      a.id === params.approval_id ? { ...a, status: params.approve ? 'approved' : 'rejected' } : a
    )
    return structuredClone(team)
  }
  if (method === 'cron.list' || method === 'cron.manage') return { jobs: [], scoped: 'builder' }
  if (method === 'bots_team.audit.list') return { entries: [] }
  return {}
}
sdk.host.request = request as typeof sdk.host.request
sdk.host.listProfileArtifacts = async () => ({ items: [], sessions: [] }) as never
sdk.host.notifyError = error => console.warn('Fixture action:', error)
sdk.host.notify = () => {}
sdk.host.warmProfile = async () => {}
sdk.queryClient.setDefaultOptions({ queries: { retry: false } })

// Bot state captures its owner atom at import time, after fixture injection.
const { $lastRoster, $botMeta } = await import('../src/plugins/hermes-bots/data')
$lastRoster.set(roster)
$botMeta.set({
  scout: { title: 'Scout', role: 'Research & sources', shape: 'bop:scout', color: '#b79259' },
  builder: { title: 'Builder', role: 'Engineering', shape: 'bop:builder', color: '#478c7f' },
  editor: { title: 'Editor', role: 'Writing & review', shape: 'bop:editor', color: '#a37b88' }
})
const { BotCard } = await import('../src/plugins/hermes-bots/bot-card')
const { MissionRail } = await import('../src/plugins/hermes-bots/mission-rail')
const { TeamPage } = await import('../src/plugins/hermes-bots/team-page')
const { ThemeProvider, useTheme } = await import('../src/themes/context')
const { RootTooltipProvider } = await import('../src/components/ui/tooltip')
const noop = () => {}

function Review() {
  const theme = useTheme()
  const [mode, setMode] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    theme.previewTheme('bops', 'light')
  }, [])
  return (
    <div className="review-app">
      <header className="review-toolbar">
        <div>
          <strong>Hermes Desktop</strong>
          <span>Component review · Fixture data · No live agent connection</span>
        </div>
        <sdk.Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const next = mode === 'light' ? 'dark' : 'light'
            setMode(next)
            theme.previewTheme('bops', next)
          }}
        >
          {mode === 'light' ? 'Dark appearance' : 'Light appearance'}
        </sdk.Button>
      </header>
      <div className="review-workspace">
        <aside className="review-roster" aria-label="Bot card review">
          <h2>
            Teammates <span>3</span>
          </h2>
          {roster.map(bot => (
            <BotCard key={bot.name} bot={bot} onDelete={noop} onEdit={noop} onGroup={noop} onNewSection={noop} />
          ))}
        </aside>
        <main className="review-team">
          <TeamPage />
        </main>
        <aside className="review-rail" aria-label="Context rail review">
          <MissionRail />
        </aside>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={sdk.queryClient}>
    <ThemeProvider>
      <RootTooltipProvider>
        <Review />
      </RootTooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
)
