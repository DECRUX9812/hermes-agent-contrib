/**
 * Team Bots data layer: `bots_team.*` on the ACTIVE gateway (the team store is install-wide,
 * so one team is one gateway's business — same shape as the mailbox, minus the fan-out).
 * Goes through `host.request`, the SDK's JSON-RPC door, so it works unchanged against a local
 * backend, an SSH/remote one, or a web-hosted gateway — no Electron API is touched here.
 *
 * The types mirror `tui_gateway/contracts/bot_team.py` (the generated shapes live in
 * `@hermes/shared`, which plugins don't import wholesale). The pure helpers below hold every
 * derived-display rule so the components stay dumb and the rules stay testable.
 */

import { atom, host, queryClient, useQuery, useValue } from '@hermes/plugin-sdk'

import { ID } from './shared'

export interface TeamBudget {
  hard_stop: boolean
  monthly_usd: null | number
  period?: string
  spent_usd: number
}

export interface TeamMember {
  budget: TeamBudget
  credentials: string[]
  lead: boolean
  plugins: string[]
  profile: null | string
  reports_to: null | string
  role: string
  skills: string[]
  slot: string
  status: 'active' | 'paused' | string
  title: string
}

export interface TeamOrgNode extends TeamMember {
  reports: TeamOrgNode[]
}

export type GoalStatus = 'blocked' | 'cancelled' | 'done' | 'open' | 'active'

export interface TeamGoal {
  detail: string
  id: string
  owner: null | string
  parent_id: null | string
  status: GoalStatus | string
  task_ids: string[]
  title: string
}

export type ApprovalKind = 'action' | 'credential' | 'hire' | 'spend'

export interface TeamApproval {
  created_at: number
  decided_by?: null | string
  detail: string
  id: string
  kind: ApprovalKind | string
  note: string
  requested_by: string
  status: 'approved' | 'pending' | 'rejected' | string
  subject: string
}

export interface TeamLearning {
  at: number
  by: string
  count: number
  id: string
  text: string
}

export interface GoalProgress {
  blocked: boolean
  done: number
  percent: number
  status: string
  total: number
}

export interface Team {
  approvals: TeamApproval[]
  channels: Record<string, string>
  goals: TeamGoal[]
  id: string
  learnings: TeamLearning[]
  members: TeamMember[]
  mission: string
  name: string
  policy: { lead_decides: boolean }
  updated_at: number
}

export interface TeamView {
  rollup: { goals: Record<string, GoalProgress>; overall: { done: number; percent: number; total: number } }
  team: Team
  tree: TeamOrgNode[]
}

export interface TeamSummary {
  goal_count: number
  id: string
  member_count: number
  mission: string
  name: string
  open_seats: number
  pending_approvals: number
  updated_at: number
}

export interface TeamAuditEntry {
  action: string
  actor: string
  at: number
  detail: Record<string, unknown>
}

// ── selection + queries ─────────────────────────────────────────────────────────────────────

export const $selectedTeamId = atom<null | string>(null)

const connection = () => String(host.state?.connectionId?.get?.() ?? '')

export const teamsKey = () => [ID, 'teams', connection()]
export const teamKey = (id: string) => [ID, 'team', connection(), id]

export function useSelectedTeamId() {
  return useValue($selectedTeamId)
}

/** An older gateway without `bots_team.*` reads as "no teams" — never as a broken page. */
export async function fetchTeams(): Promise<TeamSummary[]> {
  try {
    const res = await host.request<{ teams?: TeamSummary[] }>('bots_team.list', {})

    return Array.isArray(res?.teams) ? res.teams : []
  } catch {
    return []
  }
}

export const fetchTeam = (teamId: string) => host.request<TeamView>('bots_team.get', { team_id: teamId })

export function useTeams() {
  return useQuery({ queryKey: teamsKey(), queryFn: fetchTeams, refetchInterval: 10000, staleTime: 5000 })
}

export function useTeam(teamId: null | string) {
  return useQuery({
    queryKey: teamKey(teamId || ''),
    queryFn: () => fetchTeam(teamId as string),
    enabled: Boolean(teamId),
    refetchInterval: 6000,
    staleTime: 3000
  })
}

/** Run a mutating call and write the returned view straight into the cache so the page
 *  re-renders from the one response, then refresh the list summaries. */
export async function mutateTeam(method: string, params: Record<string, unknown>): Promise<TeamView> {
  const view = await host.request<TeamView>(method, params)

  if (view?.team?.id) {
    queryClient?.setQueryData?.(teamKey(view.team.id), view)
  }

  void queryClient?.invalidateQueries?.({ queryKey: teamsKey() })?.catch?.(() => {})

  return view
}

export const createTeam = (input: { mission?: string; name: string }) => mutateTeam('bots_team.create', input)

// ── pure display rules ──────────────────────────────────────────────────────────────────────

/** Who a seat is, for a label: the profile when hired, else the role, else "Open seat". */
export function seatName(member: Pick<TeamMember, 'profile' | 'role' | 'title'>, openSeat: string): string {
  return member.profile || member.title || member.role || openSeat
}

export type BudgetTone = 'exhausted' | 'ok' | 'paused' | 'warn'

/** Traffic-light for a seat's month: paused wins; ≥100% is exhausted; ≥80% warns. No limit is
 *  always ok — an uncapped teammate is a choice, not a fault. */
export function budgetState(member: Pick<TeamMember, 'budget' | 'status'>): { percent: null | number; tone: BudgetTone } {
  if (member.status === 'paused') {
    return { percent: null, tone: 'paused' }
  }

  const { monthly_usd: limit, spent_usd: spent } = member.budget

  if (limit === null || limit === undefined || limit <= 0) {
    return { percent: null, tone: 'ok' }
  }

  const percent = Math.min(100, Math.round((100 * spent) / limit))

  return { percent, tone: spent >= limit ? 'exhausted' : percent >= 80 ? 'warn' : 'ok' }
}

export function pendingApprovals(team: Pick<Team, 'approvals'>): TeamApproval[] {
  return team.approvals.filter(a => a.status === 'pending').sort((a, b) => a.created_at - b.created_at)
}

/** Goals as an indented outline: roots first (creation order kept), children under parents. */
export function goalOutline(goals: TeamGoal[]): { depth: number; goal: TeamGoal }[] {
  const byParent = new Map<null | string, TeamGoal[]>()
  const ids = new Set(goals.map(g => g.id))

  for (const g of goals) {
    // A parent that no longer exists floats the goal to the top level rather than hiding it.
    const key = g.parent_id && ids.has(g.parent_id) ? g.parent_id : null
    byParent.set(key, [...(byParent.get(key) ?? []), g])
  }

  const out: { depth: number; goal: TeamGoal }[] = []

  const walk = (parent: null | string, depth: number, seen: Set<string>) => {
    for (const g of byParent.get(parent) ?? []) {
      if (!seen.has(g.id)) {
        seen.add(g.id)
        out.push({ depth, goal: g })
        walk(g.id, depth + 1, seen)
      }
    }
  }

  walk(null, 0, new Set())

  return out
}

/** A goal's progress label, "3/8 · 37%", or a status word when nothing is linked yet. */
export function progressLabel(p: GoalProgress | undefined, none: string): string {
  return p && p.total > 0 ? `${p.done}/${p.total} · ${p.percent}%` : none
}

/** Top learnings first (most-confirmed, then newest) — what the brief will actually carry. */
export function topLearnings(learnings: TeamLearning[], limit = 12): TeamLearning[] {
  return [...learnings].sort((a, b) => b.count - a.count || b.at - a.at).slice(0, limit)
}

export function orgDepth(tree: TeamOrgNode[]): number {
  return tree.reduce((max, n) => Math.max(max, 1 + orgDepth(n.reports)), 0)
}

/** Calls that return a slice (a learning, an approval) rather than the whole view: write it,
 *  then re-read the team so the page redraws from one authoritative document. */
export async function refreshTeam(teamId: string): Promise<TeamView> {
  const view = await fetchTeam(teamId)
  queryClient?.setQueryData?.(teamKey(teamId), view)
  void queryClient?.invalidateQueries?.({ queryKey: teamsKey() })?.catch?.(() => {})

  return view
}

export async function addLearning(teamId: string, text: string, by = 'you'): Promise<void> {
  await host.request('bots_team.learning.add', { by, team_id: teamId, text })
  await refreshTeam(teamId)
}
