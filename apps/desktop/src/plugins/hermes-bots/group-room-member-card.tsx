/**
 * One member's card: a popover from the members panel row or the strip's face.
 * Click or Enter opens it; resting on the trigger opens it after a beat. Its
 * actions are the room's own levers for that member: mention, open their chat,
 * stop their work while it runs, make them the lead.
 */

import { Button, cn, Codicon, Popover, PopoverContent, PopoverTrigger, useValue } from '@hermes/plugin-sdk'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $lastRoster, botHandle } from './data'
import { groupMemberKey } from './group-membership'
import { formatElapsed, type RoomMemberEntry } from './group-room-member-status'
import { roomRole, type RoomRoles } from './group-room-roles'
import { ROOM_LISTENER_EVERYONE } from './group-team'
import { useBots } from './i18n'
import { displayName } from './labels'
import type { RoomText } from './room-i18n'
import { useRoomText } from './room-i18n'
import { openRosterBot } from './roster-actions'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember, RosterRow } from './types'

const HOVER_OPEN_MS = 300
const HOVER_CLOSE_MS = 150

export interface SeatBudget {
  limit: null | number
  spent: number
  tone: 'exhausted' | 'ok' | 'paused' | 'warn'
}

const BUDGET_TONE: Record<SeatBudget['tone'], string> = {
  exhausted: 'text-danger',
  ok: 'text-fg-subtle',
  paused: 'text-fg-subtle',
  warn: 'text-warning'
}

const usd = (value: number) => `$${value.toFixed(2)}`

export function MemberFace({
  allMeta,
  member,
  size
}: {
  allMeta: Record<string, BotMeta>
  member: GroupMember
  size: number
}) {
  const appearance = botAppearance(member.name, botRosterMeta(member, allMeta))
  const image = appearance.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null

  return (
    <span className="block overflow-hidden rounded-[22%]">
      <BotFace
        color={avatarColor(appearance.color, member.name)}
        image={image}
        name={member.name}
        shape={appearance.shape}
        size={size}
      />
    </span>
  )
}

/** What a member is doing or waiting on, in one line; empty when there is
 *  nothing to say beyond the group they sit in. */
export function memberStatusText(entry: RoomMemberEntry, tool: string | undefined, text: RoomText['members']): string {
  if (entry.status === 'waiting') {
    return entry.prompt?.kind === 'clarify' ? text.needsAnswer : text.needsApproval
  }

  if (entry.status === 'working') {
    return tool ? text.workingTool(tool) : text.working
  }

  if (entry.status === 'offline') {
    return text.offline
  }

  return ''
}

export function memberRoleLabel(
  entry: RoomMemberEntry,
  roles: RoomRoles,
  roomKey: string,
  allMeta: Record<string, BotMeta>
): string {
  const meta = botRosterMeta(entry.member, allMeta)

  return (roomRole(roles, roomKey, entry.key) || meta?.title || entry.member.title || '').trim()
}

function rosterRowFor(member: GroupMember, roster: readonly RosterRow[] | null | undefined): RosterRow {
  const key = groupMemberKey(member)

  return (roster || []).find(row => groupMemberKey(row) === key) || (member as RosterRow)
}

export interface MemberCardProps {
  allMeta: Record<string, BotMeta>
  budget?: SeatBudget
  children: ReactNode
  className?: string
  entry: RoomMemberEntry
  isLead: boolean
  onListen: (listener: string) => void
  onMention: (member: GroupMember) => void
  onStop: (member: GroupMember) => void
  roleLabel: string
  statusLine: string
}

export function MemberCard({
  allMeta,
  budget,
  children,
  className,
  entry,
  isLead,
  onListen,
  onMention,
  onStop,
  roleLabel,
  statusLine
}: MemberCardProps) {
  const b = useBots()
  const text = useRoomText().members
  const roster = useValue($lastRoster) as null | RosterRow[] | undefined
  const [open, setOpen] = useState(false)
  const hoverOpened = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const { member } = entry
  const name = displayName(member, botRosterMeta(member, allMeta))

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const cancelTimer = () => window.clearTimeout(timer.current)

  const scheduleOpen = () => {
    cancelTimer()
    timer.current = window.setTimeout(() => {
      hoverOpened.current = true
      setOpen(true)
    }, HOVER_OPEN_MS)
  }

  const scheduleClose = () => {
    cancelTimer()

    if (hoverOpened.current) {
      timer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS)
    }
  }

  const finish = (run: () => void) => {
    cancelTimer()
    setOpen(false)
    run()
  }

  return (
    <Popover
      onOpenChange={next => {
        if (!next) {
          cancelTimer()
          hoverOpened.current = false
        }

        setOpen(next)
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={text.cardLabel(name)}
          className={className}
          data-member-card={entry.key}
          onClick={event => {
            // Our own click owns the open state: Radix's toggle would close a card the hover just opened.
            event.preventDefault()
            cancelTimer()
            hoverOpened.current = false
            setOpen(true)
          }}
          onPointerEnter={scheduleOpen}
          onPointerLeave={scheduleClose}
          type="button"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-70 p-3"
        data-testid="group-member-card"
        onOpenAutoFocus={event => {
          if (hoverOpened.current) {
            event.preventDefault()
          }
        }}
        onPointerEnter={cancelTimer}
        onPointerLeave={scheduleClose}
        side="left"
      >
        <div className="flex items-center gap-3">
          <span className="shrink-0">
            <MemberFace allMeta={allMeta} member={member} size={40} />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-ui-sm font-semibold text-fg">{name}</span>
              <span className="truncate text-ui-2xs text-fg-subtle">@{botHandle(member.name, member)}</span>
            </div>
            {roleLabel ? <div className="truncate text-ui-xs text-fg-muted">{roleLabel}</div> : null}
          </div>
        </div>
        <div
          className={cn(
            'mt-3 flex items-center gap-1.5 rounded-control bg-surface-sunken px-2 py-1.5 text-ui-xs',
            entry.status === 'waiting' ? 'text-warning' : 'text-fg-secondary'
          )}
          data-testid="group-member-now"
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-pill',
              entry.status === 'working' && 'bg-brand',
              entry.status === 'waiting' && 'bg-warning',
              entry.status !== 'working' && entry.status !== 'waiting' && 'bg-fg-subtle'
            )}
          />
          <span className="min-w-0 flex-1 truncate">{statusLine || text.idle}</span>
          {entry.status === 'working' && entry.since !== null ? (
            <span className="shrink-0 tabular-nums text-fg-subtle">{formatElapsed(Date.now() - entry.since)}</span>
          ) : null}
        </div>
        {budget?.limit ? (
          <div
            className={cn('mt-2 font-mono text-ui-2xs tabular-nums', BUDGET_TONE[budget.tone])}
            data-testid="group-member-budget"
          >
            {b.group.budget(usd(budget.spent), usd(budget.limit))}
          </div>
        ) : null}
        <div className="mt-2 -mx-1 flex flex-col gap-0.5">
          <Button
            className="justify-start"
            onClick={() => finish(() => onMention(member))}
            size="sm"
            variant="ghost"
          >
            <Codicon name="mention" />
            {text.mention}
          </Button>
          <Button
            className="justify-start"
            onClick={() => finish(() => void openRosterBot(rosterRowFor(member, roster)))}
            size="sm"
            variant="ghost"
          >
            <Codicon name="comment-discussion" />
            {text.openChat}
          </Button>
          {entry.status === 'working' ? (
            <Button className="justify-start" onClick={() => finish(() => onStop(member))} size="sm" variant="ghost">
              <Codicon name="debug-stop" />
              {text.stop}
            </Button>
          ) : null}
          <Button
            className="justify-start"
            onClick={() => finish(() => onListen(isLead ? ROOM_LISTENER_EVERYONE : entry.key))}
            size="sm"
            variant="ghost"
          >
            <Codicon name="star-full" />
            {isLead ? text.everyoneListens : text.makeLead}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
