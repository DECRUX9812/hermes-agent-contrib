/**
 * The room's thread rail: every piece of work in the room as one row, grouped
 * by where it stands — Needs you · Working · Open · Answered — so a glance
 * says what is happening without reading the conversation (the "parallel work
 * threads, not one endless chat" pattern agent UIs converged on).
 *
 * "All activity" on top is the full arrival-ordered room; a thread row focuses
 * the conversation on that thread and points the composer at it.
 */

import { Button, cn, Codicon, relativeTime } from '@hermes/plugin-sdk'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
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
  totalMessages: number
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
  totalMessages
}: GroupThreadRailProps) {
  const b = useBots()

  const nameOf = (name: string) => {
    const member = members.find(m => m.name === name)

    return member ? displayName(member, botRosterMeta(member, allMeta)) : name
  }

  return (
    <nav
      aria-label={b.group.threadsTitle}
      className="flex min-h-0 w-60 shrink-0 flex-col border-r border-(--ui-stroke-secondary) bg-(--ui-bg-primary)"
      data-testid="group-thread-rail"
    >
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
          <span className="text-[0.625rem] tabular-nums text-(--ui-text-quaternary)">{totalMessages}</span>
        </button>
        {SECTIONS.map(status => {
          const rows = items.filter(item => item.status === status)

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
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {rows.map(item => {
                  const active = focusThread === item.thread
                  const who = item.working.length ? item.working : item.assignees

                  return (
                    <li key={item.thread}>
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
                          {status === 'working' ? (
                            <span
                              className={cn('absolute inset-0 rounded-full motion-safe:animate-ping', GLYPH[status])}
                            />
                          ) : null}
                          <span className={cn('relative size-2 rounded-full', GLYPH[status])} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span
                            className={cn(
                              'line-clamp-2 text-[0.75rem] leading-snug',
                              active || status === 'waiting'
                                ? 'font-semibold text-foreground'
                                : 'text-(--ui-text-secondary)'
                            )}
                          >
                            {item.title}
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 text-[0.625rem] text-(--ui-text-quaternary)">
                            {who.length ? <Faces allMeta={allMeta} members={members} names={who} /> : null}
                            <span className="min-w-0 flex-1 truncate">
                              {item.working.length
                                ? b.group.threadWorking(item.working.map(nameOf).join(', '))
                                : `${relativeTime(item.lastAt)} · ${b.group.workCount(item.count)}`}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </nav>
  )
}
