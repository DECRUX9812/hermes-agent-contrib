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

import { Button, Codicon, host, queryClient } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { $lastRoster } from './data'
import { groupMemberKey } from './group-membership'
import { GroupSquadPanel } from './group-room-squad'
import { useBots } from './i18n'
import { ID } from './shared'
import { mutateTeam, useTeam } from './team'
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
}

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

  const squad = (
    <GroupSquadPanel
      allMeta={props.allMeta}
      leadMember={props.leadMember}
      leadName={props.leadName}
      members={props.members}
      onMention={props.onMention}
      roomWorking={props.roomWorking}
    />
  )

  if (!props.teamId || !view) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {props.goal ? <Mission label={b.group.panelMission} text={props.goal} /> : null}
        {squad}
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
      {/* What needs the board first: hires, spend, credentials, actions. */}
      <Approvals t={t} team={team} />
      {squad}
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

export function GroupRoomPanel(props: GroupRoomPanelProps) {
  const b = useBots()

  return (
    <aside
      aria-label={b.group.panelTeam}
      className="flex min-h-0 w-80 shrink-0 flex-col border-l border-(--ui-stroke-secondary) bg-(--ui-bg-primary)"
      data-testid="group-room-panel"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TeamTab {...props} />
      </div>
    </aside>
  )
}

/** Drop the room's cached team resolution so a just-created team shows at once. */
export function refreshRoomTeam(group: string): void {
  void queryClient?.invalidateQueries?.({ queryKey: [ID, 'group-team-lead', group] })
}
