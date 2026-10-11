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
 *  Work  — every thread read as a ticket: the ask, who is on it, where it
 *          stands; one click jumps to it, one more files it as a team task.
 *
 * A room no team covers yet offers to become one: its name, its goal as the
 * mission, its local bots as seats (the lead keeps the lead seat).
 */

import { Button, cn, Codicon, host, queryClient, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { $lastRoster } from './data'
import { groupMemberKey } from './group-membership'
import { GroupSquadPanel } from './group-room-squad'
import { type RoomWorkItem, roomWorkItems, type RoomWorkStatus } from './group-room-work'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import { ID } from './shared'
import { mutateTeam, useTeam } from './team'
import { GoalsSection } from './team-goals'
import { useTeamText } from './team-i18n'
import { OrgChart } from './team-org'
import { Approvals } from './team-page'
import type { BotMeta, GroupMember, GroupMessage, RosterRow } from './types'

type PanelTab = 'team' | 'work'

const WORK_TONE: Record<RoomWorkStatus, string> = {
  answered: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  open: 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)',
  waiting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  working: 'bg-(--ui-accent)/12 text-(--ui-accent)'
}

export interface GroupRoomPanelProps {
  allMeta: Record<string, BotMeta>
  goal: string
  group: string
  leadMember: GroupMember | null
  leadName: string
  log: readonly GroupMessage[]
  members: GroupMember[]
  onJump: (item: RoomWorkItem) => void
  onMention: (member: GroupMember) => void
  /** Re-resolve the room's covering team after this panel created one. */
  onTeamChanged: () => void
  roomWorking: ReadonlySet<string>
  running: boolean
  teamId: null | string
  waitingThreads: ReadonlySet<string>
}

/** One room → one team: name, goal as mission, local bots as seats. */
export async function runRoomAsTeam(group: string, goal: string, members: GroupMember[], leadMember: GroupMember | null) {
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
            <p className="m-0 mt-1 text-[0.7rem] leading-snug text-(--ui-text-tertiary)">{b.group.runAsTeamBody}</p>
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
            <div className="mb-1 flex justify-between text-[0.65rem] text-(--ui-text-tertiary)">
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

function WorkTab(props: GroupRoomPanelProps) {
  const b = useBots()
  const roster = useValue($lastRoster) as null | RosterRow[] | undefined
  const items = roomWorkItems(props.log, { running: props.running, waitingThreads: props.waitingThreads })
  const [filed, setFiled] = useState<Record<string, boolean>>({})

  const nameOf = (profile: string) => {
    const member = props.members.find(m => m.name === profile)

    return member ? displayName(member, botRosterMeta(member, props.allMeta)) : profile
  }

  const fileTask = async (item: RoomWorkItem) => {
    // The first voice on the thread owns it, when that voice holds a seat here.
    const owner = item.assignees.find(name => (roster || []).some(row => row.name === name && !row.remoteSource))

    try {
      await mutateTeam('bots_team.goal.upsert', { owner: owner || null, team_id: props.teamId, title: item.title })
      setFiled(prev => ({ ...prev, [item.thread]: true }))
    } catch (err) {
      host.notifyError(err, 'Team')
    }
  }

  if (!items.length) {
    return <p className="m-0 p-4 text-[0.75rem] text-(--ui-text-tertiary)">{b.group.workEmpty}</p>
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-2" data-testid="group-work-list">
      {items.map(item => (
        <li
          className="group/ticket rounded-lg border border-transparent p-2 transition-colors hover:border-(--ui-stroke-secondary) hover:bg-(--chrome-action-hover)/40"
          data-testid="group-work-item"
          key={item.thread}
        >
          <button className="block w-full cursor-pointer text-left" onClick={() => props.onJump(item)} type="button">
            <span className="flex items-center gap-1.5">
              <span className={cn('rounded px-1.5 py-px text-[0.6rem] font-medium', WORK_TONE[item.status])}>
                {b.group.workStatus[item.status]}
              </span>
              <span className="text-[0.6rem] tabular-nums text-(--ui-text-quaternary)">
                {b.group.workCount(item.count)}
              </span>
            </span>
            <span className="mt-1 line-clamp-2 block text-[0.75rem] leading-snug font-medium text-foreground">
              {item.title}
            </span>
            {item.assignees.length ? (
              <span className="mt-0.5 block truncate text-[0.65rem] text-(--ui-text-tertiary)">
                {item.assignees.map(nameOf).join(', ')}
              </span>
            ) : null}
          </button>
          {props.teamId ? (
            <Button
              className="mt-1 h-6 px-1.5 text-[0.65rem]"
              disabled={filed[item.thread]}
              onClick={() => void fileTask(item)}
              size="sm"
              variant="ghost"
            >
              <Codicon name={filed[item.thread] ? 'check' : 'tasklist'} />
              {filed[item.thread] ? b.group.taskFiled : b.group.makeTask}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function GroupRoomPanel(props: GroupRoomPanelProps) {
  const b = useBots()
  const [tab, setTab] = useState<PanelTab>('team')

  const waiting = roomWorkItems(props.log, { running: props.running, waitingThreads: props.waitingThreads }).filter(
    item => item.status === 'waiting' || item.status === 'working'
  ).length

  const tabs: { id: PanelTab; label: string; badge?: number }[] = [
    { id: 'team', label: b.group.panelTeam },
    { id: 'work', label: b.group.panelWork, badge: waiting || undefined }
  ]

  return (
    <aside
      aria-label={b.group.panelTeam}
      className="flex min-h-0 w-80 shrink-0 flex-col border-l border-(--ui-stroke-secondary) bg-(--ui-bg-primary)"
      data-testid="group-room-panel"
    >
      <div
        className="flex shrink-0 items-center gap-1 border-b border-(--ui-stroke-secondary) px-2 py-1.5"
        role="tablist"
      >
        {tabs.map(entry => (
          <Button
            aria-selected={tab === entry.id}
            className={cn(
              'h-7 rounded-md px-2.5 text-[0.75rem]',
              tab === entry.id
                ? 'bg-(--chrome-action-hover) font-semibold text-foreground'
                : 'text-(--ui-text-tertiary)'
            )}
            key={entry.id}
            onClick={() => setTab(entry.id)}
            role="tab"
            size="sm"
            variant="ghost"
          >
            {entry.label}
            {entry.badge ? (
              <span className="ml-1 rounded-full bg-(--ui-accent)/15 px-1.5 text-[0.6rem] tabular-nums text-(--ui-accent)">
                {entry.badge}
              </span>
            ) : null}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'team' ? <TeamTab {...props} /> : <WorkTab {...props} />}
      </div>
    </aside>
  )
}

/** Drop the room's cached team resolution so a just-created team shows at once. */
export function refreshRoomTeam(group: string): void {
  void queryClient?.invalidateQueries?.({ queryKey: [ID, 'group-team-lead', group] })
}
