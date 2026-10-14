/**
 * The room's side panel — where a group chat IS its team (the Paperclip shape:
 * a mission, an org, decisions, tasks), so the room decides, hires and assigns
 * right where the work is discussed instead of on a separate Team page.
 *
 *  Team  — the mission and overall progress, decisions waiting on you
 *          (approvals: hires, spend, credentials), who is in the room and what
 *          they are doing now, the team's tasks, and the org chart (seats,
 *          reporting lines, hiring into open seats). The team sections are the
 *          Team page's own components, so both surfaces edit one store.
 *  (The room's threads — its work — live in the thread rail beside the
 *  conversation: group-room-threads.tsx.)
 *
 * A room no team covers yet offers to become one: its name, its goal as the
 * mission, its local bots as seats (the lead keeps the lead seat).
 */

import { Button, cn, Codicon, host, queryClient, Tip } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { $lastRoster } from './data'
import { groupMemberKey } from './group-membership'
import { GroupSquadPanel } from './group-room-squad'
import { useBots } from './i18n'
import { useRoomText } from './room-i18n'
import { ID } from './shared'
import { budgetState, mutateTeam, useTeam } from './team'
import { GoalsSection } from './team-goals'
import { useTeamText } from './team-i18n'
import { OrgChart } from './team-org'
import { Approvals } from './team-page'
import type { BotMeta, GroupMember, RosterRow } from './types'

export interface GroupRoomPanelProps {
  allMeta: Record<string, BotMeta>
  goal: string
  group: string
  leadMember: GroupMember | null
  leadName: string
  members: GroupMember[]
  onMention: (member: GroupMember) => void
  /** Re-resolve the room's covering team after this panel created one. */
  onTeamChanged: () => void
  roomWorking: ReadonlySet<string>
  teamId: null | string
  /** The Decisions queue the room built (escalations, questions); team
   *  approvals join it here. */
  decisions: ReactNode
  decisionCount: number
  onTab: (tab: RoomPanelTab) => void
  tab: RoomPanelTab
  /** Fold the panel to its avatar strip; absent where it is a sheet. */
  onCollapse?: () => void
  /** The room's threads, when the thread rail is not on screen. */
  threads?: ReactNode
}

export type RoomPanelTab = 'decisions' | 'floor' | 'team' | 'threads'

/** One room → one team: name, goal as mission, local bots as seats. */
export async function runRoomAsTeam(
  group: string,
  goal: string,
  members: GroupMember[],
  leadMember: GroupMember | null
) {
  const view = await mutateTeam('bots_team.create', { mission: goal, name: group })
  // Team seats are profiles on this gateway; a remote member stays a room voice.
  const local = members.filter(member => !member.remoteSource)
  const leadKey = leadMember ? groupMemberKey(leadMember) : local[0] ? groupMemberKey(local[0]) : ''
  const roster = ($lastRoster.get() || []) as RosterRow[]

  for (const member of local) {
    const row = roster.find(r => groupMemberKey(r) === groupMemberKey(member))
    const title = (row?.title || member.title || '').trim()
    await mutateTeam('bots_team.member.upsert', {
      lead: groupMemberKey(member) === leadKey,
      profile: member.name,
      role: title || 'member',
      ...(title ? { title } : {}),
      team_id: view.team.id
    })
  }
}

function TeamTab(props: GroupRoomPanelProps) {
  const b = useBots()
  const t = useTeamText()
  const { data: view } = useTeam(props.teamId)
  const [busy, setBusy] = useState(false)
  const localCount = props.members.filter(member => !member.remoteSource).length

  if (!props.teamId || !view) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {props.goal ? <Mission label={b.group.panelMission} text={props.goal} /> : null}
        {!props.teamId && localCount > 0 ? (
          <section
            className="rounded-xl border border-dashed border-(--ui-stroke-secondary) p-3 text-left"
            data-testid="group-run-as-team"
          >
            <h3 className="m-0 text-[0.8125rem] font-semibold text-foreground">{b.group.runAsTeamTitle}</h3>
            <p className="m-0 mt-1 text-[0.75rem] leading-snug text-(--ui-text-tertiary)">{b.group.runAsTeamBody}</p>
            <Button
              className="mt-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true)

                try {
                  await runRoomAsTeam(props.group, props.goal, props.members, props.leadMember)
                  props.onTeamChanged()
                } catch (err) {
                  host.notifyError(err, 'Team')
                } finally {
                  setBusy(false)
                }
              }}
              size="sm"
            >
              <Codicon name={busy ? 'loading' : 'organization'} spinning={busy} />
              {busy ? b.group.runAsTeamBusy : b.group.runAsTeamAction}
            </Button>
          </section>
        ) : null}
      </div>
    )
  }

  const { rollup, team, tree } = view

  return (
    <div className="flex flex-col gap-4 p-3" data-testid="group-team-tab">
      <div>
        <Mission label={team.name} text={team.mission || props.goal} />
        {rollup.overall.total ? (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-[0.625rem] text-(--ui-text-tertiary)">
              <span>{t.overall}</span>
              <span className="tabular-nums">{`${rollup.overall.done}/${rollup.overall.total} · ${rollup.overall.percent}%`}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-(--ui-stroke-tertiary)">
              <div className="h-full rounded-full bg-(--ui-accent)" style={{ width: `${rollup.overall.percent}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <GoalsSection progress={rollup.goals} t={t} team={team} />
      <OrgChart t={t} team={team} tree={tree} />
    </div>
  )
}

function Mission({ label, text }: { label: string; text: string }) {
  return (
    <div className="text-left" data-testid="group-room-mission">
      <div className="ui-section-label">{label}</div>
      {text ? <p className="m-0 mt-1 text-[0.75rem] leading-relaxed text-(--ui-text-secondary)">{text}</p> : null}
    </div>
  )
}

/** The floor: who is in the room and what they are doing — with each seat's
 *  month on the team budget when the room is a team (the CEO's cost view). */
function FloorSquad(props: GroupRoomPanelProps) {
  const { data: view } = useTeam(props.teamId)

  const budgets = Object.fromEntries(
    (view?.team?.members || [])
      .filter(seat => seat.profile)
      .map(seat => [
        seat.profile as string,
        { limit: seat.budget.monthly_usd, spent: seat.budget.spent_usd, tone: budgetState(seat).tone }
      ])
  )

  return (
    <GroupSquadPanel
      allMeta={props.allMeta}
      budgets={budgets}
      leadMember={props.leadMember}
      leadName={props.leadName}
      members={props.members}
      onMention={props.onMention}
      roomWorking={props.roomWorking}
    />
  )
}

/** Team approvals (hires, spend, credentials, actions) — the board's half of
 *  the Decisions queue; the Team page's own component, one store. */
function TeamApprovals({ teamId }: { teamId: null | string }) {
  const t = useTeamText()
  const { data: view } = useTeam(teamId)

  return view ? <Approvals t={t} team={view.team} /> : null
}

export function GroupRoomPanel(props: GroupRoomPanelProps) {
  const b = useBots()
  const r = useRoomText()
  const tab = props.tab === 'threads' && !props.threads ? 'floor' : props.tab

  const tabs: { badge?: number; id: RoomPanelTab; label: string }[] = [
    { id: 'floor', label: b.group.panelFloor },
    ...(props.threads ? [{ id: 'threads' as const, label: r.panelThreads }] : []),
    { badge: props.decisionCount || undefined, id: 'decisions', label: b.group.panelDecisions },
    { id: 'team', label: b.group.panelTeam }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="group-room-panel">
      <div className="flex shrink-0 items-center gap-1 border-b border-(--ui-stroke-secondary) p-1.5" role="tablist">
        {tabs.map(entry => (
          <button
            aria-selected={tab === entry.id}
            className={cn(
              'flex min-h-8 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md text-[0.75rem] transition-colors',
              tab === entry.id
                ? 'bg-(--chrome-action-hover) font-semibold text-foreground'
                : 'text-(--ui-text-tertiary) hover:text-foreground'
            )}
            key={entry.id}
            onClick={() => props.onTab(entry.id)}
            role="tab"
            type="button"
          >
            {entry.label}
            {entry.badge ? (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[0.625rem] font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                {entry.badge}
              </span>
            ) : null}
          </button>
        ))}
        {props.onCollapse ? (
          <Tip label={r.asideCollapse}>
            <Button
              aria-label={r.asideCollapse}
              className="shrink-0 text-fg-muted hover:text-fg"
              onClick={props.onCollapse}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="layout-sidebar-right-off" />
            </Button>
          </Tip>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'threads' ? (
          props.threads
        ) : tab === 'floor' ? (
          <div className="p-3">
            <FloorSquad {...props} />
          </div>
        ) : tab === 'decisions' ? (
          <div className="flex flex-col gap-3 p-3" data-testid="group-decisions-tab">
            {props.decisions}
            <TeamApprovals teamId={props.teamId} />
            {!props.decisionCount ? (
              <p className="m-0 text-[0.75rem] text-(--ui-text-tertiary)">{b.group.decisionsEmpty}</p>
            ) : null}
          </div>
        ) : (
          <TeamTab {...props} />
        )}
      </div>
    </div>
  )
}

/** Drop the room's cached team resolution so a just-created team shows at once. */
export function refreshRoomTeam(group: string): void {
  void queryClient?.invalidateQueries?.({ queryKey: [ID, 'group-team-lead', group] })
}
