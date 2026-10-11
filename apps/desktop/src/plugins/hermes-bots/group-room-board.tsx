/**
 * The CEO Board: the room's work as columns — Needs you · Waiting on the team
 * · Working · Answered — with the handoff chain on each card and an
 * at-a-glance row on top. The same thread index and handoffs the room view
 * reads; a card opens its thread.
 */

import { cn, relativeTime } from '@hermes/plugin-sdk'
import { useState } from 'react'

import type { RoomEscalation, RoomHandoff } from './group-room-handoffs'
import type { RoomWorkItem } from './group-room-work'
import { useBots } from './i18n'
import type { GroupMember } from './types'

type Column = 'answered' | 'needs' | 'waiting' | 'working'

const COLUMNS: readonly Column[] = ['needs', 'waiting', 'working', 'answered']

const DOT: Record<Column, string> = {
  answered: 'bg-emerald-500/70',
  needs: 'bg-amber-500',
  waiting: 'bg-(--ui-text-quaternary)',
  working: 'bg-(--ui-accent)'
}

export interface GroupRoomBoardProps {
  escalations: readonly RoomEscalation[]
  handoffs: readonly RoomHandoff[]
  items: readonly RoomWorkItem[]
  members: readonly GroupMember[]
  nameOf: (name: string) => string
  onOpen: (thread: string) => void
}

function columnOf(item: RoomWorkItem, escalated: ReadonlySet<string>): Column {
  if (item.status === 'waiting' || escalated.has(item.thread)) {
    return 'needs'
  }

  return item.status === 'working' ? 'working' : item.status === 'open' ? 'waiting' : 'answered'
}

export function GroupRoomBoard({ escalations, handoffs, items, members, nameOf, onOpen }: GroupRoomBoardProps) {
  const b = useBots()
  const c = b.group.board
  const [who, setWho] = useState<null | string>(null)
  const escalated = new Set(escalations.map(e => e.handoff.thread))
  const latestHandoff = new Map(handoffs.map(h => [h.thread, h]))
  const startOfDay = new Date().setHours(0, 0, 0, 0)

  const visible = items.filter(
    item =>
      !who || item.assignees.includes(who) || item.working.includes(who) || latestHandoff.get(item.thread)?.to === who
  )

  const tiles = [
    {
      label: c.needsYou,
      tone: 'border-amber-500/40 bg-amber-500/8 text-amber-700 dark:text-amber-300',
      value: visible.filter(i => columnOf(i, escalated) === 'needs').length
    },
    {
      label: c.working,
      tone: 'border-(--ui-accent)/30 bg-(--ui-accent)/6 text-(--ui-accent)',
      value: visible.filter(i => i.status === 'working').length
    },
    {
      label: c.openHandoffs,
      tone: 'border-(--ui-stroke-secondary) text-foreground',
      value: handoffs.filter(h => h.status === 'open').length
    },
    {
      label: c.deliveredToday,
      tone: 'border-emerald-500/30 bg-emerald-500/6 text-emerald-700 dark:text-emerald-300',
      value: handoffs.filter(h => h.status === 'delivered' && h.at >= startOfDay).length
    }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="group-room-board">
      <div aria-label={c.filter} className="flex flex-wrap gap-1.5" role="group">
        {[null, ...members.map(m => m.name)].map(name => (
          <button
            aria-pressed={who === name}
            className={cn(
              'min-h-8 cursor-pointer rounded-full border px-3 text-[0.75rem] transition-colors',
              who === name
                ? 'border-(--ui-accent) bg-(--ui-accent)/10 font-semibold text-(--ui-accent)'
                : 'border-(--ui-stroke-secondary) text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'
            )}
            key={name || 'all'}
            onClick={() => setWho(name)}
            type="button"
          >
            {name ? nameOf(name) : c.everyone}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        {tiles.map(tile => (
          <div className={cn('flex flex-col rounded-xl border px-3 py-2', tile.tone)} key={tile.label}>
            <span className="text-[0.6875rem] font-semibold">{tile.label}</span>
            <span className="font-mono text-xl font-bold tabular-nums">{tile.value}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 @2xl:grid-cols-2 @5xl:grid-cols-4">
        {COLUMNS.map(column => {
          const cards = visible.filter(item => columnOf(item, escalated) === column)

          return (
            <section
              aria-label={c.column[column]}
              className="flex min-h-40 flex-col gap-2 rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)/40 p-2.5"
              data-board-column={column}
              key={column}
            >
              <div className="flex items-center gap-2 px-1">
                <span aria-hidden className={cn('size-2 rounded-full', DOT[column])} />
                <span className="text-[0.75rem] font-semibold text-foreground">{c.column[column]}</span>
                <span className="ml-auto font-mono text-[0.6875rem] text-(--ui-text-quaternary)">{cards.length}</span>
              </div>
              {cards.map(item => {
                const handoff = latestHandoff.get(item.thread)
                const owner = item.working[0] || handoff?.to || item.assignees[0]

                return (
                  <button
                    className="flex cursor-pointer flex-col gap-1 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-2.5 text-left transition-colors hover:border-(--ui-stroke-primary)"
                    data-testid="group-board-card"
                    key={item.thread}
                    onClick={() => onOpen(item.thread)}
                    type="button"
                  >
                    <span className="line-clamp-2 text-[0.75rem] leading-snug font-semibold text-foreground">
                      {item.title}
                    </span>
                    {handoff ? (
                      <span className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">
                        {nameOf(handoff.from)} → {nameOf(handoff.to)} · {b.group.handoff.status[handoff.status]}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1.5 text-[0.625rem] text-(--ui-text-quaternary)">
                      {owner ? <span className="truncate text-(--ui-text-secondary)">{nameOf(owner)}</span> : null}
                      <span className="ml-auto shrink-0">{relativeTime(item.lastAt)}</span>
                    </span>
                  </button>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}
