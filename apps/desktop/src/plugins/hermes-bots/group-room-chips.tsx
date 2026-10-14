/**
 * Event chips: one 28 px row under the log line that raised a handoff or
 * settled a team vote, instead of the full card. A click (or Enter/Space)
 * expands the full card in place; open votes keep their full card because
 * they still need input.
 */

import { cn, Codicon } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { HandoffCard, STATUS_TONE, VoteCard } from './group-room-cards'
import type { RoomHandoff } from './group-room-handoffs'
import type { RoomVote } from './group-room-votes'
import { useBots } from './i18n'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember } from './types'

/** Open state plus "has ever opened": the card mounts on first open and stays
 *  mounted, so closing animates instead of snapping the content away. */
function useChipFold() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  return {
    mounted,
    open,
    toggle: () => {
      setMounted(true)
      setOpen(was => !was)
    }
  }
}

const CHIP =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-pill border border-line bg-surface px-2.5 text-ui-xs text-fg-secondary hover:bg-hover'

function ChipFace({
  allMeta,
  members,
  name
}: {
  allMeta?: Record<string, BotMeta>
  members?: readonly GroupMember[]
  name: string
}) {
  const member = members?.find(candidate => candidate.name === name)
  const appearance = botAppearance(name, member && allMeta ? botRosterMeta(member, allMeta) : null)
  const image = appearance.image

  return (
    <BotFace
      color={avatarColor(appearance.color, name)}
      image={image && !isBackfilledFacePng(image) ? image : null}
      name={name}
      shape={appearance.shape}
      size={16}
    />
  )
}

function ChipShell({
  children,
  label,
  open,
  status,
  toggle
}: {
  children: ReactNode
  label: string
  open: boolean
  status?: string
  toggle: () => void
}) {
  return (
    <button
      aria-expanded={open}
      aria-label={label}
      className={CHIP}
      data-handoff-status={status}
      data-testid="group-event-chip"
      onClick={toggle}
      type="button"
    >
      {children}
      <Codicon className="shrink-0 text-fg-subtle" name={open ? 'chevron-up' : 'chevron-down'} />
    </button>
  )
}

export function HandoffChip({
  allMeta,
  handoff,
  members,
  nameOf
}: {
  allMeta?: Record<string, BotMeta>
  handoff: RoomHandoff
  members: readonly GroupMember[]
  nameOf: (name: string) => string
}) {
  const b = useBots()
  const { mounted, open, toggle } = useChipFold()

  return (
    <div className="ml-11 flex min-w-0 flex-col items-stretch gap-1">
      <div className="flex min-w-0">
        <ChipShell label={b.group.handoff.label(nameOf(handoff.from), nameOf(handoff.to))} open={open} status={handoff.status} toggle={toggle}>
          <Codicon className="shrink-0 text-fg-muted" name="arrow-swap" />
          <span className="shrink-0">
            <ChipFace allMeta={allMeta} members={members} name={handoff.from} />
          </span>
          <span className="shrink-0 font-medium text-fg">{nameOf(handoff.from)}</span>
          <span aria-hidden className="shrink-0 text-fg-subtle">
            →
          </span>
          <span className="shrink-0">
            <ChipFace allMeta={allMeta} members={members} name={handoff.to} />
          </span>
          <span className="shrink-0 font-medium text-fg">{nameOf(handoff.to)}</span>
          <span aria-hidden className="shrink-0 text-fg-subtle">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate">{handoff.task}</span>
          <span className={cn('shrink-0 rounded-pill px-2 py-px font-semibold', STATUS_TONE[handoff.status])}>
            {b.group.handoff.status[handoff.status]}
          </span>
        </ChipShell>
      </div>
      <div className="motion-collapse" data-open={open} inert={!open}>
        {mounted ? <HandoffCard bare handoff={handoff} nameOf={nameOf} /> : null}
      </div>
    </div>
  )
}

export function VoteChip({
  members,
  nameOf,
  onCall,
  vote
}: {
  members: readonly GroupMember[]
  nameOf: (name: string) => string
  onCall: (option: string) => void
  vote: RoomVote
}) {
  const b = useBots()
  const { mounted, open, toggle } = useChipFold()

  return (
    <div className="ml-11 flex min-w-0 flex-col items-stretch gap-1">
      <div className="flex min-w-0">
        <ChipShell label={b.group.vote.label(vote.question)} open={open} toggle={toggle}>
          <Codicon className="shrink-0 text-success" name="check" />
          <span className="min-w-0 flex-1 truncate font-medium text-fg">{b.group.vote.decided(vote.decided)}</span>
        </ChipShell>
      </div>
      <div className="motion-collapse" data-open={open} inert={!open}>
        {mounted ? <VoteCard bare members={members} nameOf={nameOf} onCall={onCall} vote={vote} /> : null}
      </div>
    </div>
  )
}
