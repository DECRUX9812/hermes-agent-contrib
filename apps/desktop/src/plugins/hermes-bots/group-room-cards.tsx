/**
 * The Command Room's message kinds beyond chat — each with its own look, so a
 * glance tells a contract from a chat line (group-room-handoffs.ts holds the
 * rules these draw):
 *
 *  HandoffCard     — a teammate passed work: task, finish line, clock, status.
 *  EscalationCard  — it stalled or looped; the fixes are on the card.
 *  ActivityLine    — what a working teammate is doing right now, one live line
 *                    instead of a stream of "working on it…" bubbles.
 */

import { Button, cn, Codicon, host, relativeTime, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import type { HandoffStatus, RoomEscalation, RoomHandoff } from './group-room-handoffs'
import { type RoomVote, voteConsensus } from './group-room-votes'
import { useBots } from './i18n'
import { liveTool } from './live-status'
import type { GroupMember } from './types'

const STATUS_TONE: Record<HandoffStatus, string> = {
  accepted: 'bg-info/10 text-info',
  declined: 'bg-danger/10 text-danger',
  delivered: 'bg-success/10 text-success',
  open: 'bg-hover text-fg-muted',
  working: 'bg-info/10 text-info'
}

/** "due in 12 min" or, past it, a red "overdue 5 min" — re-read on every
 *  render, which the room's clock tick drives. */
function DueClock({ at, minutes }: { at: number; minutes: number }) {
  const b = useBots()
  const left = Math.round((at + minutes * 60_000 - Date.now()) / 60_000)

  return left >= 0 ? (
    <span>{b.group.handoff.due(left)}</span>
  ) : (
    <span className="font-semibold text-danger">{b.group.handoff.overdue(-left)}</span>
  )
}

export function HandoffCard({ handoff, nameOf }: { handoff: RoomHandoff; nameOf: (name: string) => string }) {
  const b = useBots()
  const h = b.group.handoff

  return (
    <section
      aria-label={h.label(nameOf(handoff.from), nameOf(handoff.to))}
      className="ml-11 rounded-card border border-line bg-surface-raised px-3 py-2"
      data-handoff-status={handoff.status}
      data-testid="group-handoff-card"
    >
      <div className="flex items-center gap-2 text-ui-xs text-fg-muted">
        <span className="min-w-0 truncate">
          {nameOf(handoff.from)} → {nameOf(handoff.to)}
        </span>
        <span className={cn('ml-auto shrink-0 rounded-pill px-2 py-px font-semibold', STATUS_TONE[handoff.status])}>
          {h.status[handoff.status]}
        </span>
      </div>
      <div className="mt-1 text-ui-sm text-fg">{handoff.task}</div>
      {handoff.why ? (
        <div className="mt-0.5 text-ui-xs text-fg-muted">
          {h.why}: {handoff.why}
        </div>
      ) : null}
      {handoff.doneWhen ? (
        <div className="mt-0.5 text-ui-xs text-fg-muted">
          {h.doneWhen}: {handoff.doneWhen}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-3 text-ui-2xs text-fg-subtle">
        <span>{relativeTime(handoff.at)}</span>
        {handoff.dueMinutes &&
        (handoff.status === 'open' || handoff.status === 'accepted' || handoff.status === 'working') ? (
          <DueClock at={handoff.at} minutes={handoff.dueMinutes} />
        ) : null}
        {handoff.status === 'declined' && handoff.reply ? <span>{h.declinedBecause(handoff.reply)}</span> : null}
        {handoff.status === 'open' ? <span>{h.clockHint}</span> : null}
      </div>
    </section>
  )
}

export interface EscalationCardProps {
  compact?: boolean
  escalation: RoomEscalation
  members: readonly GroupMember[]
  nameOf: (name: string) => string
  onDismiss: () => void
  onNudge: () => void
  onOpen?: () => void
  onReassign: (member: GroupMember) => void
}

export function EscalationCard({
  compact,
  escalation,
  members,
  nameOf,
  onDismiss,
  onNudge,
  onOpen,
  onReassign
}: EscalationCardProps) {
  const b = useBots()
  const e = b.group.escalation
  const [picking, setPicking] = useState(false)
  const { handoff } = escalation
  const others = members.filter(m => m.name !== handoff.to && m.name !== handoff.from)

  return (
    <section
      aria-label={e.title}
      className={cn(
        'flex flex-col gap-2 rounded-card border border-warning/40 bg-warning/10 px-3 py-2.5',
        !compact && 'ml-11'
      )}
      data-testid="group-escalation-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Codicon className="text-warning" name="warning" />
        <span className="text-ui-xs font-semibold text-warning">{e.title}</span>
        <span className="text-ui-2xs text-fg-muted">
          {escalation.kind === 'loop'
            ? e.loop(nameOf(handoff.from), nameOf(handoff.to))
            : e.stalled(nameOf(handoff.from), nameOf(handoff.to))}
        </span>
      </div>
      <button
        className="cursor-pointer text-left text-ui-sm leading-snug text-fg"
        onClick={onOpen}
        type="button"
      >
        {handoff.task}
      </button>
      <div className="flex flex-wrap gap-1.5">
        {others.length ? (
          <Button onClick={() => setPicking(open => !open)} size="sm">
            <Codicon name="person" />
            {e.reassign}
          </Button>
        ) : null}
        {escalation.kind === 'stalled' ? (
          <Button onClick={onNudge} size="sm" variant="secondary">
            {e.nudge(nameOf(handoff.to))}
          </Button>
        ) : null}
        <Button onClick={onDismiss} size="sm" variant="ghost">
          {e.dismiss}
        </Button>
      </div>
      {picking ? (
        <div aria-label={e.reassign} className="flex flex-wrap gap-1.5" role="group">
          {others.map(member => (
            <Button
              key={member.name}
              onClick={() => {
                setPicking(false)
                onReassign(member)
              }}
              size="sm"
              variant="outline"
            >
              {nameOf(member.name)}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

/** The contracts hanging off one log line — handoffs and team votes — each
 *  rendered directly under the line that called for it. */
export function LineCards({
  handoffsAt,
  index,
  members,
  nameOf,
  onCall,
  votesAt
}: {
  /** Handoffs by the log index that raised them. */
  handoffsAt: ReadonlyMap<number, readonly RoomHandoff[]>
  /** The log entry's index. */
  index: number
  members: readonly GroupMember[]
  nameOf: (name: string) => string
  /** Record a decision's outcome in its own thread. */
  onCall: (vote: RoomVote, option: string) => void
  /** Votes by the log index that asked. */
  votesAt: ReadonlyMap<number, readonly RoomVote[]>
}) {
  const handoffs = handoffsAt.get(index) ?? []
  const votes = votesAt.get(index) ?? []

  // Most lines carry no contract; don't make the log render empty wrappers.
  if (!handoffs.length && !votes.length) {
    return null
  }

  return (
    <>
      {handoffs.map(handoff => (
        <HandoffCard handoff={handoff} key={`handoff:${handoff.id}`} nameOf={nameOf} />
      ))}
      {votes.map(vote => (
        <VoteCard
          key={`vote:${vote.id}`}
          members={members}
          nameOf={nameOf}
          onCall={option => onCall(vote, option)}
          vote={vote}
        />
      ))}
    </>
  )
}

/** Where the team landed, option by option: a bar per option, who is on it,
 *  and — while the decision is open — the call to make. */
export function VoteCard({
  members,
  nameOf,
  onCall,
  vote
}: {
  members: readonly GroupMember[]
  nameOf: (name: string) => string
  /** Record the outcome in the room, so the call outlives this session. */
  onCall: (option: string) => void
  vote: RoomVote
}) {
  const b = useBots()
  const v = b.group.vote
  const consensus = voteConsensus(vote, members)
  const counts = new Map<string, number>()

  for (const pick of Object.values(vote.votes)) {
    counts.set(pick, (counts.get(pick) || 0) + 1)
  }

  // The tallest bar sets the scale, so bars compare against each other.
  const top = counts.size ? Math.max(...counts.values()) : 0

  const TONE = {
    majority: 'bg-info/10 text-info',
    split: 'bg-warning/10 text-warning',
    unanimous: 'bg-success/10 text-success',
    waiting: 'bg-hover text-fg-muted'
  } as const

  return (
    <section
      aria-label={v.label(vote.question)}
      className="ml-11 overflow-hidden rounded-card border border-line"
      data-testid="group-vote-card"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-sunken px-3 py-1.5">
        <Codicon className="text-info" name="flame" />
        <span className="text-ui-xs font-semibold text-fg">{v.title}</span>
        <span
          className={cn('ml-auto rounded-pill px-2 py-px text-ui-2xs font-semibold', TONE[consensus])}
          data-testid="group-vote-consensus"
        >
          {v.consensus[consensus]}
        </span>
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <span className="text-ui-sm leading-snug font-medium text-fg">{vote.question}</span>
        {vote.options.map(option => {
          const voters = Object.entries(vote.votes)
            .filter(([, pick]) => pick === option)
            .map(([name]) => nameOf(name))

          const isCalled = vote.decided === option
          const width = top ? Math.round((voters.length / top) * 100) : 0

          return (
            <div className="flex items-center gap-2" data-testid="group-vote-option" key={option}>
              <div className="relative min-w-0 flex-1 overflow-hidden rounded-row bg-surface-sunken">
                {/* The bar is the count, so a glance reads the shape of the
                    room before any name is legible. */}
                <div
                  aria-hidden
                  className={cn(
                    'h-full absolute inset-y-0 left-0 transition-[width]',
                    isCalled ? 'bg-success/30' : 'bg-info/15'
                  )}
                  style={{ width: `${width}%` }}
                />
                <div className="relative flex flex-wrap items-center gap-x-2 px-2 py-1">
                  <span
                    className={cn(
                      'min-w-0 truncate text-ui-xs',
                      isCalled ? 'font-semibold text-success' : 'text-fg'
                    )}
                  >
                    {option}
                  </span>
                  {voters.length ? (
                    <span className="truncate text-ui-2xs text-fg-subtle">
                      {v.picked(voters.join(', '))}
                    </span>
                  ) : null}
                </div>
              </div>
              {/* Calling it is the user's alone — the card records their word
                  in the room, it never records one on their behalf. */}
              {!vote.decided ? (
                <Button onClick={() => onCall(option)} size="sm" type="button" variant="outline">
                  {v.callIt}
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 px-3 pb-2 text-ui-2xs text-fg-subtle">
        <span>{relativeTime(vote.at)}</span>
        {vote.decided ? (
          <span className="font-semibold text-success" data-testid="group-vote-decided">
            {v.decided(vote.decided)}
          </span>
        ) : (
          <>
            {vote.missing.length ? <span>{v.missing(vote.missing.map(nameOf).join(', '))}</span> : null}
            <span>{v.callHint}</span>
          </>
        )}
      </div>
    </section>
  )
}

/** Runtime id → stored id, inverted once per render for the activity lookups. */
function useRuntimeByStored(): Map<string, string> {
  const storedByRuntime = (useValue(host.state.storedSessionByRuntimeId) || {}) as Record<string, string>

  return new Map(Object.entries(storedByRuntime).map(([runtime, stored]) => [stored, runtime]))
}

export interface ActivityLineProps {
  names: readonly string[]
  nameOf: (name: string) => string
  /** Member name → that member's room session id on this thread. */
  sessionOf: (name: string) => null | string
}

export function ActivityLine({ names, nameOf, sessionOf }: ActivityLineProps) {
  const b = useBots()

  const statusItems = (useValue(host.state.statusItemsBySession) || {}) as Record<
    string,
    { currentTool?: string; state: string; title?: string }[]
  >

  const runtimeByStored = useRuntimeByStored()

  if (!names.length) {
    return null
  }

  return (
    <section
      aria-label={b.group.activityLabel}
      aria-live="polite"
      className="ml-11 flex flex-col gap-1 rounded-xl border border-dashed border-(--ui-stroke-secondary) px-3 py-2"
      data-testid="group-activity-line"
    >
      {names.map(name => {
        const stored = sessionOf(name)
        const runtime = stored ? runtimeByStored.get(stored) || stored : null
        const tool = runtime ? liveTool(statusItems[runtime]) : undefined

        return (
          <div className="flex min-w-0 items-center gap-2 text-[0.75rem]" key={name}>
            <span aria-hidden className="relative flex size-2 shrink-0">
              <span className="absolute inset-0 rounded-full bg-(--ui-accent) motion-safe:animate-ping" />
              <span className="relative size-2 rounded-full bg-(--ui-accent)" />
            </span>
            <span className="shrink-0 font-semibold text-foreground">{nameOf(name)}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-(--ui-text-tertiary)">
              {tool ? b.group.activityTool(tool) : b.group.activityWorking}
            </span>
          </div>
        )
      })}
    </section>
  )
}
