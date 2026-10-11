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
import { useBots } from './i18n'
import { liveTool } from './live-status'
import type { GroupMember } from './types'

const STATUS_TONE: Record<HandoffStatus, string> = {
  accepted: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  declined: 'bg-red-500/12 text-red-700 dark:text-red-300',
  delivered: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  open: 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)',
  working: 'bg-(--ui-accent)/12 text-(--ui-accent)'
}

function Field({ label, children }: { children: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[0.625rem] font-semibold tracking-wide text-(--ui-text-quaternary) uppercase">{label}</span>
      <span className="text-[0.75rem] leading-snug text-(--ui-text-secondary)">{children}</span>
    </div>
  )
}

export function HandoffCard({ handoff, nameOf }: { handoff: RoomHandoff; nameOf: (name: string) => string }) {
  const b = useBots()
  const h = b.group.handoff

  return (
    <section
      aria-label={h.label(nameOf(handoff.from), nameOf(handoff.to))}
      className="ml-11 overflow-hidden rounded-xl border border-(--ui-accent)/25 bg-(--ui-accent)/5"
      data-handoff-status={handoff.status}
      data-testid="group-handoff-card"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-(--ui-accent)/20 bg-(--ui-accent)/8 px-3 py-1.5">
        <Codicon className="text-(--ui-accent)" name="arrow-swap" />
        <span className="text-[0.75rem] font-semibold text-(--ui-accent)">{h.title}</span>
        <span className="text-[0.75rem] text-(--ui-text-secondary)">
          {nameOf(handoff.from)} → {nameOf(handoff.to)}
        </span>
        <span
          className={cn('ml-auto rounded-full px-2 py-px text-[0.625rem] font-semibold', STATUS_TONE[handoff.status])}
        >
          {h.status[handoff.status]}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 px-3 py-2 @lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label={h.task}>{handoff.task}</Field>
        {handoff.doneWhen ? <Field label={h.doneWhen}>{handoff.doneWhen}</Field> : null}
      </div>
      <div className="flex flex-wrap gap-x-3 px-3 pb-2 text-[0.625rem] text-(--ui-text-quaternary)">
        <span>{relativeTime(handoff.at)}</span>
        {handoff.dueMinutes ? <span>{h.due(handoff.dueMinutes)}</span> : null}
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
        'flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/8 px-3 py-2.5',
        !compact && 'ml-11'
      )}
      data-testid="group-escalation-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Codicon className="text-amber-600 dark:text-amber-300" name="warning" />
        <span className="text-[0.75rem] font-semibold text-amber-700 dark:text-amber-300">{e.title}</span>
        <span className="text-[0.6875rem] text-(--ui-text-tertiary)">
          {escalation.kind === 'loop'
            ? e.loop(nameOf(handoff.from), nameOf(handoff.to))
            : e.stalled(nameOf(handoff.from), nameOf(handoff.to))}
        </span>
      </div>
      <button
        className="cursor-pointer text-left text-[0.8125rem] leading-snug text-foreground"
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
