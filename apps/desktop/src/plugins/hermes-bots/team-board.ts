/**
 * The goal-first board's data layer: `fork.team.*` on the ACTIVE gateway through
 * `host.request`. Mirrors `tui_gateway/contracts/fork_team.py` (plugins don't import
 * `@hermes/shared` wholesale). Every derived-display rule — column grouping, the
 * Needs-you filter, the mono number formats — lives in the pure helpers below so the
 * components stay dumb and the rules stay testable.
 */

import { host, queryClient, type StatusState, useQuery } from '@hermes/plugin-sdk'

import { ID } from './shared'
import { teamKey, teamsKey } from './team'

export type BoardColumn = 'done' | 'in_progress' | 'needs_approval' | 'queued'

export const BOARD_COLUMNS: readonly BoardColumn[] = ['queued', 'in_progress', 'needs_approval', 'done']

export interface TeamBoardAssignee {
  profile: string
  role: string
  title: string
}

export interface TeamBoardCard {
  assignee?: TeamBoardAssignee | null
  column: BoardColumn | string
  cost_usd?: null | number
  elapsed_s?: null | number
  last_tool?: null | { name: string; status: string }
  needs_you?: null | string
  session_id?: null | string
  started_at?: null | number
  status: string
  stoppable: boolean
  takeable: boolean
  task_id: string
  title: string
  tokens?: null | number
  updated_at?: null | number
}

export interface TeamBoardTotals {
  cost_usd?: null | number
  done: number
  in_progress: number
  needs_approval: number
  needs_you: number
  queued: number
  tokens?: null | number
}

export interface TeamBoardResult {
  cards: TeamBoardCard[]
  goal: null | { id: string; status: string | null; title: string }
  totals: TeamBoardTotals
}

export interface TeamTemplateSeat {
  instruction: string
  lead: boolean
  reports_to?: null | string
  role: string
  title: string
}

export interface TeamTemplate {
  description: string
  name: string
  seats: TeamTemplateSeat[]
  template_id: string
}

// ── queries ──────────────────────────────────────────────────────────────────────────────────

const connection = () => String(host.state?.connectionId?.get?.() ?? '')

export const boardKey = (teamId: string, goalId?: null | string) => [
  ID,
  'team-board',
  connection(),
  teamId,
  goalId ?? ''
]

export async function fetchBoard(teamId: string, goalId?: null | string): Promise<TeamBoardResult> {
  return host.request<TeamBoardResult>('fork.team.board', { goal_id: goalId ?? null, team_id: teamId })
}

/**
 * Live polling: fast while work is in flight and the page is visible, slow otherwise.
 * The refresh never clobbers — react-query merges into the stable key per (team, goal).
 */
export function useBoard(teamId: null | string, goalId?: null | string) {
  return useQuery({
    enabled: Boolean(teamId),
    queryFn: () => fetchBoard(teamId as string, goalId),
    queryKey: boardKey(teamId ?? '', goalId),
    refetchInterval: query => {
      const cards = query.state.data?.cards ?? []
      const working = cards.some(c => c.column === 'in_progress' || c.column === 'queued')

      return working && document.visibilityState === 'visible' ? 2000 : 15000
    },
    staleTime: 1500
  })
}

// ── mutations ────────────────────────────────────────────────────────────────────────────────

export async function startGoal(teamId: string, title: string, detail?: string): Promise<void> {
  await host.request('fork.team.goal.start', { detail: detail ?? null, team_id: teamId, title })
  await refreshBoardSources(teamId)
}

export async function stopCard(taskId: string): Promise<void> {
  await host.request('fork.team.card.stop', { task_id: taskId })
}

export async function takeOverCard(taskId: string): Promise<{ profile?: null | string; session_id?: null | string }> {
  return host.request('fork.team.card.takeover', { task_id: taskId })
}

export async function resumeCard(taskId: string, assignee?: null | string): Promise<void> {
  await host.request('fork.team.card.resume', { assignee: assignee ?? null, task_id: taskId })
}

export async function fetchTemplates(): Promise<TeamTemplate[]> {
  const res = await host.request<{ templates?: TeamTemplate[] }>('fork.team.templates.list', {})

  return Array.isArray(res?.templates) ? res.templates : []
}

/** One idempotency key per apply click: a retried apply reuses it, a new click mints a fresh one. */
export const newRequestId = () => `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export interface TemplateApplyInput {
  assign?: Record<string, string>
  name?: string
  request_id: string
  template_id: string
}

export async function applyTemplate(input: TemplateApplyInput): Promise<{ team: { id: string }; created: boolean }> {
  const res = await host.request<{ created: boolean; team: { id: string } }>('fork.team.templates.apply', { ...input })
  await refreshBoardSources(res.team.id)
  void queryClient?.invalidateQueries?.({ queryKey: teamsKey() })?.catch?.(() => {})

  return res
}

/** The board reads the team store (goal bar) and the card dispatcher (whose runs live on the
 *  team document); both refresh after any write so the goal bar and board agree. */
async function refreshBoardSources(teamId: string): Promise<void> {
  void queryClient?.invalidateQueries?.({ queryKey: boardKey(teamId) })?.catch?.(() => {})
  await queryClient?.invalidateQueries?.({ queryKey: teamKey(teamId) })?.catch?.(() => {})
}

// ── pure display rules ───────────────────────────────────────────────────────────────────────

/** The working columns whose presence arms the fast poll. */
export const isWorkingColumn = (column: null | string | undefined) => column === 'in_progress' || column === 'queued'

/** Column buckets in fixed board order; cards keep the backend's order inside a column. */
export function groupColumns(cards: readonly TeamBoardCard[]): Record<BoardColumn, TeamBoardCard[]> {
  const out = { queued: [], in_progress: [], needs_approval: [], done: [] } as Record<BoardColumn, TeamBoardCard[]>

  for (const card of cards) {
    const key = BOARD_COLUMNS.find(c => c === card.column)

    if (key) {
      out[key].push(card)
    }
  }

  return out
}

/** The Needs-you filter: only cards with a reason a human is wanted. */
export function filterNeedsYou(cards: readonly TeamBoardCard[], on: boolean): TeamBoardCard[] {
  return on ? cards.filter(c => Boolean(c.needs_you)) : [...cards]
}

export function countNeedsYou(cards: readonly TeamBoardCard[]): number {
  return cards.filter(c => Boolean(c.needs_you)).length
}

/** Null means "nothing to sum yet" (the backend reports null unless every card reports usage). */
export function formatMoney(v: null | number | undefined): string {
  if (v === null || v === undefined) {
    return '—'
  }

  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2).replace(/\.00$/, '')}`
}

export function formatTokens(v: null | number | undefined): string {
  if (v === null || v === undefined) {
    return '—'
  }

  return v >= 10_000 ? `${(v / 1000).toFixed(1)}k` : String(v)
}

/** Elapsed seconds as a compact mono label: 42s, 3m 05s, 1h 12m. */
export function formatElapsed(s: null | number | undefined): string {
  if (s === null || s === undefined || s < 0) {
    return '—'
  }

  const h = Math.floor(s / 3600)

  if (h > 0) {
    return `${h}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  }

  const m = Math.floor(s / 60)

  if (m > 0) {
    return `${m}m ${String(s % 60).padStart(2, '0')}s`
  }

  return `${s}s`
}

const TOOL_STATE: Record<string, string> = {
  error: 'error',
  failed: 'error',
  ok: 'done',
  success: 'done'
}

/** A card's column draws the shared status vocabulary (StatusBadge states). */
export const columnState = (column: null | string | undefined): StatusState =>
  column === 'in_progress'
    ? 'running'
    : column === 'needs_approval'
      ? 'needs-approval'
      : column === 'done'
        ? 'done'
        : 'queued'

/** The live tool pill's tone: running pulses, a finished call is quiet, a failure is red. */
export const toolState = (status: null | string | undefined): StatusState => {
  if (status === 'running') {
    return 'running'
  }

  return TOOL_STATE[status ?? ''] === 'error' ? 'error' : 'done'
}
