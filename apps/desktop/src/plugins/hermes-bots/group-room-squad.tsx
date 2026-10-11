/**
 * The room's squad panel: every member on one line — face, name, the lead's
 * star, the role they play, and what they are doing RIGHT NOW.
 *
 * "Right now" is the roster's own live signal (`useBotLiveStatus`: the bot's
 * canonical chat, its running routines, a live group round, a delegated
 * worker), not just this room's turn — a bot grinding through work in its own
 * session reads as working here too, which is the question a room keeps
 * asking ("are you guys even on it?"). The room's own turn still counts, so a
 * member mid-reply lights up even before the roster catches up.
 *
 * Clicking a member seeds `@them ` into the composer: the panel doubles as
 * the room's directory of who to ask.
 */

import { Button, cn, Codicon, useValue } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $lastRoster } from './data'
import { groupMemberKey } from './group-membership'
import { useBots } from './i18n'
import { displayName } from './labels'
import { type BotLiveKind, botLiveStatusLabel, useBotLiveStatus } from './live-status'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember, RosterRow } from './types'

/** Kinds that mean "on it" — the face rings and the summary counts them. */
const BUSY: ReadonlySet<BotLiveKind> = new Set(['background', 'delegated', 'group', 'routine', 'stalled', 'working'])

const TONE: Partial<Record<BotLiveKind, string>> = {
  'needs-input': 'text-amber-700 dark:text-amber-300',
  stalled: 'text-amber-700 dark:text-amber-300',
  working: 'text-(--ui-accent)',
  group: 'text-(--ui-accent)',
  routine: 'text-(--ui-accent)',
  delegated: 'text-(--ui-accent)',
  background: 'text-(--ui-accent)'
}

/** The roster row behind a room seat: same name, same connection. A member
 *  the roster hasn't listed yet still gets the room-turn and routine signals. */
function rosterRowFor(member: GroupMember, roster: readonly RosterRow[] | null | undefined): RosterRow {
  const key = groupMemberKey(member)

  return (roster || []).find(row => groupMemberKey(row) === key) || (member as RosterRow)
}

interface SquadMemberProps {
  allMeta: Record<string, BotMeta>
  isLead: boolean
  member: GroupMember
  onMention: (member: GroupMember) => void
  roomTurn: boolean
  row: RosterRow
  /** This seat's month on the team budget, when the room is a team. */
  budget?: SeatBudget
}

export interface SeatBudget {
  limit: null | number
  spent: number
  tone: 'exhausted' | 'ok' | 'paused' | 'warn'
}

const BUDGET_TONE: Record<SeatBudget['tone'], string> = {
  exhausted: 'text-red-600 dark:text-red-300',
  ok: 'text-(--ui-text-quaternary)',
  paused: 'text-(--ui-text-quaternary)',
  warn: 'text-amber-700 dark:text-amber-300'
}

const usd = (value: number) => `$${value.toFixed(2)}`

function SquadMember({ allMeta, budget, isLead, member, onMention, roomTurn, row }: SquadMemberProps) {
  const b = useBots()
  const live = useBotLiveStatus(row)
  // Mid-reply in THIS room beats a quiet roster signal; a blocked turn
  // elsewhere still wins, since that is the thing the user must act on.
  const kind: BotLiveKind = roomTurn && live.kind !== 'needs-input' ? 'working' : live.kind
  const status = kind === live.kind ? botLiveStatusLabel(live, b.roster) : b.roster.liveWorking
  const busy = BUSY.has(kind)
  const meta = botRosterMeta(member, allMeta)
  const appearance = botAppearance(member.name, meta)
  const image = appearance.image && !isBackfilledFacePng(appearance.image) ? appearance.image : null
  const name = displayName(member, meta)
  const role = (meta?.title || member.title || '').trim()

  return (
    <li>
      <Button
        aria-label={b.group.squadMention(name)}
        className="group/seat flex h-auto w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-(--chrome-action-hover)"
        data-busy={busy ? '' : undefined}
        data-testid="group-squad-member"
        onClick={() => onMention(member)}
        variant="ghost"
      >
        <span className="relative shrink-0">
          <span
            className={cn(
              'block overflow-hidden rounded-[22%] ring-1 ring-(--ui-stroke-secondary)',
              busy && 'ring-2 ring-(--ui-accent)'
            )}
          >
            <BotFace
              color={avatarColor(appearance.color, member.name)}
              image={image}
              name={member.name}
              shape={appearance.shape}
              size={28}
            />
          </span>
          {busy ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[22%] ring-2 ring-(--ui-accent) motion-safe:animate-ping"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[0.75rem] font-semibold text-foreground">{name}</span>
            {isLead ? (
              <span aria-label={b.group.roomLead} className="shrink-0 text-[0.625rem] text-amber-500">
                ★
              </span>
            ) : null}
          </span>
          {role ? <span className="truncate text-[0.625rem] text-(--ui-text-tertiary)">{role}</span> : null}
          <span
            className={cn('truncate text-[0.625rem] text-(--ui-text-quaternary)', TONE[kind])}
            data-testid="group-squad-status"
          >
            {status}
          </span>
          {budget && budget.limit ? (
            <span
              className={cn('truncate font-mono text-[0.625rem] tabular-nums', BUDGET_TONE[budget.tone])}
              data-testid="group-squad-budget"
            >
              {b.group.budget(usd(budget.spent), usd(budget.limit))}
            </span>
          ) : null}
        </span>
        <Codicon
          className="shrink-0 text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover/seat:opacity-100"
          name="mention"
        />
      </Button>
    </li>
  )
}

export interface GroupSquadPanelProps {
  allMeta: Record<string, BotMeta>
  /** Plain messages go only to this member (team lead mode), else everyone. */
  leadMember: GroupMember | null
  leadName: string
  members: GroupMember[]
  onMention: (member: GroupMember) => void
  /** Member names mid-turn in this room. */
  roomWorking: ReadonlySet<string>
  /** Seat budgets by profile name (team rooms only). */
  budgets?: Readonly<Record<string, SeatBudget>>
}

export function GroupSquadPanel({
  allMeta,
  leadMember,
  leadName,
  members,
  onMention,
  roomWorking,
  budgets
}: GroupSquadPanelProps) {
  const b = useBots()
  const roster = useValue($lastRoster) as null | RosterRow[] | undefined
  const leadKey = leadMember ? groupMemberKey(leadMember) : ''

  // Lead first, then the room's own order — the squad reads top-down.
  const ordered = [...members].sort(
    (x, y) => Number(groupMemberKey(y) === leadKey) - Number(groupMemberKey(x) === leadKey)
  )

  return (
    <section aria-label={b.group.squadTitle} className="flex flex-col text-left" data-testid="group-squad-panel">
      <div className="flex items-baseline gap-1.5 pb-1">
        <span className="ui-section-label">{b.group.squadTitle}</span>
        <span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">{members.length}</span>
      </div>
      {/* Who hears a plain message — the one routing fact that changes what
          typing in the room does. */}
      <p className="m-0 pb-1.5 text-[0.75rem] leading-snug text-(--ui-text-tertiary)">
        {leadName ? b.group.squadRoutingLead(leadName) : b.group.squadRoutingEveryone}
      </p>
      <ul className="-mx-2 my-0 flex list-none flex-col gap-0.5 p-0">
        {ordered.map(member => (
          <SquadMember
            allMeta={allMeta}
            budget={budgets?.[member.name]}
            isLead={Boolean(leadKey) && groupMemberKey(member) === leadKey}
            key={groupMemberKey(member)}
            member={member}
            onMention={onMention}
            roomTurn={roomWorking.has(member.name)}
            row={rosterRowFor(member, roster)}
          />
        ))}
      </ul>
    </section>
  )
}
