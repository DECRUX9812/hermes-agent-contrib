/**
 * The room's members, grouped by what each one needs from the user right now:
 * the lead alone on top, then who is waiting on you, who is working, who is
 * idle. The panel lists them with their status; the strip shows only faces for
 * the folded panel. Both open the same member card.
 */

import { Button, cn, Codicon, Tip, useValue } from '@hermes/plugin-sdk'
import { useRef } from 'react'

import { useMemberTools } from './group-room-live-tool'
import { MemberCard, MemberFace, memberRoleLabel, memberStatusText, type SeatBudget } from './group-room-member-card'
import {
  formatElapsed,
  type RoomMemberEntry,
  type RoomMemberGroups,
  roomMemberGroups
} from './group-room-member-status'
import { $roomPrefs, setIdleCollapsed } from './group-room-prefs'
import { $roomRoles } from './group-room-roles'
import { useBots } from './i18n'
import { displayName } from './labels'
import { useFlip } from './motion'
import { useRoomText } from './room-i18n'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember, GroupPrompt } from './types'

export interface GroupMembersBaseProps {
  allMeta: Record<string, BotMeta>
  available: (member: GroupMember) => boolean
  /** Seat budgets by profile name (team rooms only). */
  budgets?: Readonly<Record<string, SeatBudget>>
  leadMember: GroupMember | null
  /** Thread → the member names live on it. */
  liveWork: ReadonlyMap<string, ReadonlySet<string>>
  members: GroupMember[]
  onListen: (listener: string) => void
  onMention: (member: GroupMember) => void
  onStop: (member: GroupMember) => void
  /** Open questions and approvals the room is waiting on the user for. */
  prompts: readonly GroupPrompt[]
  roomKey: string
  /** Member names mid-turn in this room. */
  roomWorking: ReadonlySet<string>
  sessions: Readonly<Record<string, string | true>> | undefined
  workingSince: ReadonlyMap<string, number>
}

export interface GroupMembersPanelProps extends GroupMembersBaseProps {
  onManage: () => void
}

type Section = 'idle' | 'lead' | 'waiting' | 'working'

function useMemberGroups(props: GroupMembersBaseProps) {
  const roles = useValue($roomRoles)
  const tools = useMemberTools(props.sessions, props.liveWork, props.members)

  const groups = roomMemberGroups({
    available: props.available,
    leadMember: props.leadMember,
    members: props.members,
    prompts: props.prompts,
    working: props.roomWorking,
    workingSince: props.workingSince
  })

  return { groups, roles, tools }
}

function orderedSections(groups: RoomMemberGroups): [Section, RoomMemberEntry[]][] {
  return [
    ['lead', groups.lead ? [groups.lead] : []],
    ['waiting', groups.waiting],
    ['working', groups.working],
    ['idle', groups.idle]
  ].filter((section): section is [Section, RoomMemberEntry[]] => section[1].length > 0)
}

type MemberEntryActions = Pick<GroupMembersBaseProps, 'allMeta' | 'budgets' | 'onListen' | 'onMention' | 'onStop'>

interface MemberEntryProps extends MemberEntryActions {
  entry: RoomMemberEntry
  roleLabel: string
  section: Section
  statusLine: string
  variant: 'face' | 'row'
}

function MemberEntry({
  allMeta,
  budgets,
  entry,
  onListen,
  onMention,
  onStop,
  roleLabel,
  section,
  statusLine,
  variant
}: MemberEntryProps) {
  const b = useBots()
  const { member } = entry
  const working = entry.status === 'working'
  const waiting = entry.status === 'waiting'
  const name = displayName(member, botRosterMeta(member, allMeta))
  const elapsed = working && entry.since !== null ? formatElapsed(Date.now() - entry.since) : null

  const face = (
    <span
      className={cn('relative shrink-0 rounded-[22%]', working && 'motion-ring text-brand')}
      data-member-face={entry.key}
      data-working={working ? '' : undefined}
    >
      <MemberFace allMeta={allMeta} member={member} size={32} />
      {waiting ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-pill bg-warning ring-2 ring-surface"
          data-testid="group-member-waiting-dot"
        />
      ) : null}
    </span>
  )

  if (variant === 'face') {
    return (
      <MemberCard
        allMeta={allMeta}
        budget={budgets?.[member.name]}
        className="flex items-center justify-center rounded-control p-1 hover:bg-hover"
        entry={entry}
        isLead={section === 'lead'}
        onListen={onListen}
        onMention={onMention}
        onStop={onStop}
        roleLabel={roleLabel}
        statusLine={statusLine}
      >
        {face}
      </MemberCard>
    )
  }

  return (
    <MemberCard
      allMeta={allMeta}
      budget={budgets?.[member.name]}
      className={cn(
        'flex h-13 w-full items-center gap-3 rounded-row px-3 text-left transition-colors duration-(--dur-fast) hover:bg-hover focus-ring',
        entry.status === 'offline' && 'opacity-60'
      )}
      entry={entry}
      isLead={section === 'lead'}
      onListen={onListen}
      onMention={onMention}
      onStop={onStop}
      roleLabel={roleLabel}
      statusLine={statusLine}
    >
      {face}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-ui-sm font-medium text-fg">{name}</span>
          {section === 'lead' ? (
            <Codicon aria-label={b.group.roomLead} className="shrink-0 text-ui-2xs text-warning" name="star-full" />
          ) : null}
        </span>
        {statusLine || roleLabel ? (
          <span
            className={cn(
              'w-fit max-w-full truncate text-ui-xs',
              waiting ? 'text-warning' : 'text-fg-muted',
              working && 'motion-shimmer'
            )}
            data-status={entry.status}
          >
            {statusLine || roleLabel}
          </span>
        ) : null}
      </span>
      {elapsed ? <span className="shrink-0 text-ui-2xs tabular-nums text-fg-subtle">{elapsed}</span> : null}
    </MemberCard>
  )
}

function useEntryProps(props: GroupMembersBaseProps) {
  const text = useRoomText().members
  const { groups, roles, tools } = useMemberGroups(props)

  const actions: MemberEntryActions = {
    allMeta: props.allMeta,
    budgets: props.budgets,
    onListen: props.onListen,
    onMention: props.onMention,
    onStop: props.onStop
  }

  const entryProps = (entry: RoomMemberEntry, section: Section, variant: 'face' | 'row'): MemberEntryProps => ({
    ...actions,
    entry,
    roleLabel: memberRoleLabel(entry, roles, props.roomKey, props.allMeta),
    section,
    statusLine: memberStatusText(entry, tools.get(entry.key), text),
    variant
  })

  return { entryProps, groups }
}

export function GroupMembersPanel(props: GroupMembersPanelProps) {
  const b = useBots()
  const text = useRoomText().members
  const rootRef = useRef<HTMLElement>(null)
  const { entryProps, groups } = useEntryProps(props)
  const idleCollapsed = Boolean(useValue($roomPrefs).idleCollapsed?.[props.roomKey])
  const sections = orderedSections(groups)

  const visible = sections.map(([section, entries]) =>
    section === 'idle' && idleCollapsed ? section : `${section}:${entries.map(entry => entry.key).join(',')}`
  )

  const leadName = props.leadMember
    ? displayName(props.leadMember, botRosterMeta(props.leadMember, props.allMeta))
    : ''

  useFlip(rootRef, visible.join('|'))

  return (
    <section aria-label={text.title} className="flex flex-col gap-4 text-left" data-testid="group-members-panel" ref={rootRef}>
      <header className="-mb-2 flex items-center gap-2 px-1">
        <span className="ui-section-label">{text.title}</span>
        <span className="text-ui-2xs tabular-nums text-fg-subtle">{props.members.length}</span>
        <Tip label={text.manage}>
          <Button aria-label={text.manage} className="ml-auto" onClick={props.onManage} size="icon-xs" variant="ghost">
            <Codicon name="ellipsis" />
          </Button>
        </Tip>
      </header>
      {props.members.length ? (
        <p className="m-0 px-1 text-ui-xs leading-snug text-fg-muted">
          {leadName ? b.group.squadRoutingLead(leadName) : b.group.squadRoutingEveryone}
        </p>
      ) : (
        <p className="m-0 px-1 text-ui-xs text-fg-muted">{text.empty}</p>
      )}
      {sections.map(([section, entries]) => {
        const collapsed = section === 'idle' && idleCollapsed

        return (
          <div className="flex flex-col gap-1" data-member-section={section} key={section}>
            {section === 'idle' ? (
              <button
                aria-expanded={!collapsed}
                aria-label={collapsed ? text.idleShow(entries.length) : text.idleHide}
                className="flex h-6 cursor-pointer items-center gap-1.5 rounded-row px-1 text-left text-fg-subtle transition-colors duration-(--dur-fast) hover:text-fg-muted focus-ring"
                onClick={() => setIdleCollapsed(props.roomKey, !collapsed)}
                type="button"
              >
                <span className="ui-section-label">{text.idle}</span>
                <span className="text-ui-2xs tabular-nums">{entries.length}</span>
                <Codicon className="ml-auto text-ui-2xs" name={collapsed ? 'chevron-right' : 'chevron-down'} />
              </button>
            ) : (
              <div className="flex h-6 items-center gap-1.5 px-1 text-fg-subtle motion-fade-in">
                <span className="ui-section-label">{text[section]}</span>
                {section === 'lead' ? null : <span className="text-ui-2xs tabular-nums">{entries.length}</span>}
              </div>
            )}
            {collapsed ? null : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {entries.map(entry => (
                  <li data-flip-key={entry.key} key={entry.key}>
                    <MemberEntry {...entryProps(entry, section, 'row')} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}

export function GroupMembersStrip(props: GroupMembersBaseProps) {
  const text = useRoomText().members
  const rootRef = useRef<HTMLDivElement>(null)
  const { entryProps, groups } = useEntryProps(props)
  const sections = orderedSections(groups)

  useFlip(rootRef, sections.map(([section, entries]) => `${section}:${entries.map(e => e.key).join(',')}`).join('|'))

  return (
    <div
      aria-label={text.title}
      className="flex flex-col items-center gap-3"
      data-testid="group-members-strip"
      ref={rootRef}
      role="group"
    >
      {sections.map(([section, entries], index) => (
        <div className="flex flex-col items-center gap-2" data-member-section={section} key={section}>
          {index > 0 ? <span aria-hidden className="mb-1 h-px w-6 bg-line" /> : null}
          {entries.map(entry => (
            <div data-flip-key={entry.key} key={entry.key}>
              <MemberEntry {...entryProps(entry, section, 'face')} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
