/**
 * The room's thread rail: every piece of work in the room as one row, grouped
 * by where it stands — Needs you · Working · Open · Answered — so a glance
 * says what is happening without reading the conversation (the "parallel work
 * threads, not one endless chat" pattern agent UIs converged on).
 *
 * "All activity" on top is the full arrival-ordered room; a thread row focuses
 * the conversation on that thread and points the composer at it.
 */

import { Button, cn, Codicon, relativeTime, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $roomPrefs, setDesktopAlerts, snoozedThreads, snoozeThread, togglePin } from './group-room-prefs'
import type { RoomWorkItem, RoomWorkStatus } from './group-room-work'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { BotMeta, GroupMember } from './types'

const SECTIONS: readonly RoomWorkStatus[] = ['waiting', 'working', 'open', 'answered']

const GLYPH: Record<RoomWorkStatus, string> = {
  answered: 'bg-emerald-500/70',
  open: 'bg-(--ui-text-quaternary)',
  waiting: 'bg-amber-500',
  working: 'bg-(--ui-accent)'
}

export interface GroupThreadRailProps {
  allMeta: Record<string, BotMeta>
  focusThread: null | string
  items: readonly RoomWorkItem[]
  members: readonly GroupMember[]
  onNewThread: () => void
  onSelect: (thread: null | string) => void
  /** Per-viewer pins and snoozes are keyed by the room. */
  roomKey: string
  /** A thread's searchable text (its messages), lower-cased. */
  textOf: (thread: string) => string
  /** Open the 24-hour brief over the whole room. */
  onBrief: () => void
  /** Drawn inside the room panel's Threads tab instead of as its own column. */
  embedded?: boolean
  /** Threads the user hasn't opened since they last grew: thread → count. */
  unseen: Readonly<Record<string, number>>
  totalMessages: number
  /** The CEO's desk: what waits on the user, who is working; each opens the
   *  matching panel tab. */
  desk: { needsYou: number; onFloor: () => void; onNeedsYou: () => void; working: number }
}

function Faces({
  allMeta,
  members,
  names
}: {
  allMeta: Record<string, BotMeta>
  members: readonly GroupMember[]
  names: string[]
}) {
  return (
    <span aria-hidden className="flex shrink-0 -space-x-1">
      {names.slice(0, 3).map(name => {
        const member = members.find(m => m.name === name)
        const look = botAppearance(name, member ? botRosterMeta(member, allMeta) : undefined)
        const image = look.image && !isBackfilledFacePng(look.image) ? look.image : null

        return (
          <span className="overflow-hidden rounded-[22%] ring-1 ring-(--ui-bg-primary)" key={name}>
            <BotFace color={avatarColor(look.color, name)} image={image} name={name} shape={look.shape} size={14} />
          </span>
        )
      })}
    </span>
  )
}

export function GroupThreadRail({
  allMeta,
  focusThread,
  items,
  members,
  onNewThread,
  onSelect,
  unseen,
  totalMessages,
  desk,
  roomKey,
  textOf,
  onBrief,
  embedded = false
}: GroupThreadRailProps) {
  const b = useBots()
  const prefs = useValue($roomPrefs)
  const [query, setQuery] = useState('')
  const [showSnoozed, setShowSnoozed] = useState(false)
  const needle = query.trim().toLowerCase()

  const matching = needle
    ? items.filter(item => item.title.toLowerCase().includes(needle) || textOf(item.thread).includes(needle))
    : items

  const pins = prefs.pins[roomKey] || []
  const snoozed = snoozedThreads(prefs, roomKey)
  const pinned = pins.map(thread => matching.find(item => item.thread === thread)).filter(Boolean) as RoomWorkItem[]
  const rest = matching.filter(item => !pins.includes(item.thread) && !snoozed.has(item.thread))
  const sleeping = matching.filter(item => snoozed.has(item.thread) && !pins.includes(item.thread))
  const unseenTotal = Object.values(unseen).reduce((sum, count) => sum + count, 0)

  const nameOf = (name: string) => {
    const member = members.find(m => m.name === name)

    return member ? displayName(member, botRosterMeta(member, allMeta)) : name
  }

  const renderRow = (item: RoomWorkItem) => {
    const active = focusThread === item.thread
    const who = item.working.length ? item.working : item.assignees

    return (
      <li className="group/row relative" key={item.thread}>
        <button
          aria-current={active ? 'true' : undefined}
          className={cn(
            'flex w-full cursor-pointer gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-(--chrome-action-hover)',
            active && 'bg-(--chrome-action-hover) ring-1 ring-(--ui-stroke-secondary)'
          )}
          data-testid="group-thread-row"
          onClick={() => onSelect(item.thread)}
          type="button"
        >
          <span className="relative mt-1.5 flex size-2 shrink-0">
            {item.status === 'working' ? (
              <span className={cn('absolute inset-0 rounded-full motion-safe:animate-ping', GLYPH[item.status])} />
            ) : null}
            <span className={cn('relative size-2 rounded-full', GLYPH[item.status])} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              className={cn(
                'line-clamp-2 text-[0.75rem] leading-snug',
                active || item.status === 'waiting' || unseen[item.thread]
                  ? 'font-semibold text-foreground'
                  : 'text-(--ui-text-secondary)'
              )}
            >
              {item.title}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[0.625rem] text-(--ui-text-quaternary)">
              {who.length ? <Faces allMeta={allMeta} members={members} names={who} /> : null}
              {unseen[item.thread] ? (
                <span
                  aria-label={b.group.threadNew(unseen[item.thread]!)}
                  className="shrink-0 rounded-full bg-(--ui-accent) px-1.5 font-mono font-semibold tabular-nums text-white"
                  data-testid="group-thread-row-unseen"
                  title={b.group.threadNew(unseen[item.thread]!)}
                >
                  {unseen[item.thread]}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                {item.working.length
                  ? b.group.threadWorking(item.working.map(nameOf).join(', '))
                  : `${relativeTime(item.lastAt)} · ${b.group.workCount(item.count)}`}
              </span>
            </span>
          </span>
        </button>
        <span className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
          <button
            aria-label={pins.includes(item.thread) ? b.group.prefs.unpin : b.group.prefs.pin}
            aria-pressed={pins.includes(item.thread)}
            className="flex size-6 cursor-pointer items-center justify-center rounded bg-(--ui-bg-primary) text-(--ui-text-tertiary) shadow-sm ring-1 ring-(--ui-stroke-secondary) hover:text-foreground"
            data-testid="group-thread-pin"
            onClick={() => togglePin(roomKey, item.thread)}
            type="button"
          >
            <Codicon name={pins.includes(item.thread) ? 'pinned' : 'pin'} />
          </button>
          <button
            aria-label={snoozed.has(item.thread) ? b.group.prefs.wake : b.group.prefs.snooze}
            className="flex size-6 cursor-pointer items-center justify-center rounded bg-(--ui-bg-primary) text-(--ui-text-tertiary) shadow-sm ring-1 ring-(--ui-stroke-secondary) hover:text-foreground"
            data-testid="group-thread-snooze"
            onClick={() => snoozeThread(roomKey, item.thread, snoozed.has(item.thread) ? 0 : undefined)}
            type="button"
          >
            <Codicon name={snoozed.has(item.thread) ? 'bell' : 'clock'} />
          </button>
        </span>
      </li>
    )
  }

  return (
    <nav
      aria-label={b.group.threadsTitle}
      className={cn(
        'flex min-h-0 flex-col bg-(--ui-bg-primary)',
        embedded ? 'h-full w-full' : 'w-60 shrink-0 border-r border-(--ui-stroke-secondary)'
      )}
      data-testid="group-thread-rail"
    >
      <div className="flex flex-col gap-1 px-2 pt-2" data-testid="group-room-desk">
        <span className="ui-section-label px-1">{b.group.deskTitle}</span>
        <button
          className={cn(
            'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-left text-[0.75rem] font-semibold transition-colors',
            desk.needsYou
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)'
          )}
          onClick={desk.onNeedsYou}
          type="button"
        >
          <span
            aria-hidden
            className={cn('size-2 rounded-full', desk.needsYou ? 'bg-amber-500' : 'bg-(--ui-text-quaternary)')}
          />
          <span className="flex-1">{b.group.deskNeedsYou}</span>
          <span className="font-mono tabular-nums">{desk.needsYou}</span>
        </button>
        <button
          className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-(--ui-stroke-secondary) px-2.5 text-left text-[0.75rem] text-(--ui-text-secondary) transition-colors hover:bg-(--chrome-action-hover)"
          onClick={desk.onFloor}
          type="button"
        >
          <span aria-hidden className="size-2 rounded-full bg-(--ui-accent)" />
          <span className="flex-1">{b.group.panelFloor}</span>
          <span className="font-mono text-[0.6875rem] tabular-nums text-(--ui-text-tertiary)">
            {b.group.deskFloor(desk.working)}
          </span>
        </button>
        <div className="flex gap-1">
          <Button className="h-7 flex-1 gap-1 px-2 text-[0.6875rem]" onClick={onBrief} size="sm" variant="outline">
            <Codicon name="sparkle" />
            {b.group.prefs.brief}
          </Button>
          <Button
            aria-pressed={prefs.desktopAlerts}
            className="h-7 gap-1 px-2 text-[0.6875rem]"
            onClick={() => void setDesktopAlerts(!prefs.desktopAlerts)}
            size="sm"
            variant={prefs.desktopAlerts ? 'secondary' : 'ghost'}
          >
            <Codicon name={prefs.desktopAlerts ? 'bell-dot' : 'bell-slash'} />
            {prefs.desktopAlerts ? b.group.prefs.alertsOn : b.group.prefs.alertsOff}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <span className="ui-section-label flex-1 px-1">{b.group.threadsTitle}</span>
        <Button
          aria-label={b.group.composerStartNew}
          className="h-6 gap-1 px-1.5 text-[0.7rem]"
          onClick={onNewThread}
          size="sm"
          variant="ghost"
        >
          <Codicon name="add" />
          {b.group.threadsNew}
        </Button>
      </div>
      <div className="px-2 pb-1">
        <label className="flex items-center gap-1.5 rounded-md border border-(--ui-stroke-secondary) px-2 focus-within:border-(--ui-accent)">
          <Codicon className="shrink-0 text-(--ui-text-quaternary)" name="search" />
          <span className="sr-only">{b.group.prefs.search}</span>
          <input
            className="h-7 min-w-0 flex-1 bg-transparent text-[0.75rem] text-foreground outline-none placeholder:text-(--ui-text-quaternary)"
            data-testid="group-thread-search"
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => event.key === 'Escape' && setQuery('')}
            placeholder={b.group.prefs.search}
            type="search"
            value={query}
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <button
          aria-current={focusThread === null ? 'true' : undefined}
          className={cn(
            'mb-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.75rem] transition-colors hover:bg-(--chrome-action-hover)',
            focusThread === null
              ? 'bg-(--chrome-action-hover) font-semibold text-foreground'
              : 'text-(--ui-text-secondary)'
          )}
          data-testid="group-thread-all"
          onClick={() => onSelect(null)}
          type="button"
        >
          <Codicon className="text-(--ui-text-tertiary)" name="comment-discussion" />
          <span className="min-w-0 flex-1 truncate">{b.group.threadsAll}</span>
          {unseenTotal ? (
            <span
              aria-label={b.group.threadNew(unseenTotal)}
              className="rounded-full bg-(--ui-accent) px-1.5 font-mono text-[0.625rem] font-semibold tabular-nums text-white"
              data-testid="group-thread-unseen"
              title={b.group.threadNew(unseenTotal)}
            >
              {unseenTotal}
            </span>
          ) : null}
          <span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">{totalMessages}</span>
        </button>
        {pinned.length ? (
          <section className="mt-2" data-thread-section="pinned">
            <h3 className="m-0 flex items-center gap-1.5 px-2 pb-1 text-[0.625rem] font-semibold tracking-wide text-(--ui-text-quaternary) uppercase">
              <Codicon name="pinned" />
              {b.group.prefs.pinned}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{pinned.map(renderRow)}</ul>
          </section>
        ) : null}
        {SECTIONS.map(status => {
          const rows = rest.filter(item => item.status === status)

          if (!rows.length) {
            return null
          }

          return (
            <section className="mt-2" data-thread-section={status} key={status}>
              <h3
                className={cn(
                  'm-0 flex items-center gap-1.5 px-2 pb-1 text-[0.625rem] font-semibold uppercase tracking-wide',
                  status === 'waiting' ? 'text-amber-700 dark:text-amber-300' : 'text-(--ui-text-quaternary)'
                )}
              >
                {b.group.workStatus[status]}
                <span className="tabular-nums font-normal">{rows.length}</span>
              </h3>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{rows.map(renderRow)}</ul>
            </section>
          )
        })}
        {sleeping.length ? (
          <section className="mt-2" data-thread-section="snoozed">
            <button
              aria-expanded={showSnoozed}
              className="flex w-full cursor-pointer items-center gap-1.5 px-2 pb-1 text-[0.625rem] font-semibold tracking-wide text-(--ui-text-quaternary) uppercase"
              onClick={() => setShowSnoozed(open => !open)}
              type="button"
            >
              <Codicon name={showSnoozed ? 'chevron-down' : 'chevron-right'} />
              {b.group.prefs.snoozed}
              <span className="font-normal tabular-nums">{sleeping.length}</span>
            </button>
            {showSnoozed ? (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{sleeping.map(renderRow)}</ul>
            ) : null}
          </section>
        ) : null}
        {needle && !matching.length ? (
          <p className="m-0 px-2 pt-2 text-[0.6875rem] text-(--ui-text-tertiary)">{b.group.prefs.noMatch}</p>
        ) : null}
      </div>
    </nav>
  )
}
