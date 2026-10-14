/**
 * One thread beside the room: its header, its entries, and its own reply box.
 * Opening a thread no longer filters the room's log, so the reader keeps
 * their place in the conversation, and the main composer keeps starting new
 * threads while this box continues this one.
 */

import { Button, cn, Codicon, host } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { RoomWorkItem, RoomWorkStatus } from './group-room-work'
import { useBots } from './i18n'
import { useRoomText } from './room-i18n'
import { mutateTeam } from './team'

const NEAR_BOTTOM_PX = 96

const THREAD_STATUS_PILL: Record<RoomWorkStatus, string> = {
  answered: 'bg-success/10 text-success',
  open: 'bg-hover text-fg-muted',
  waiting: 'bg-warning/10 text-warning',
  working: 'bg-info/10 text-info'
}

export interface GroupThreadPanelHeaderProps {
  item: RoomWorkItem
  nameOf: (name: string) => string
  onClose: () => void
  /** Stop the thread's running turns (shown while it is working). */
  onStop?: () => void
  /** Seat profile that owns the thread's task, when one holds a seat. */
  owner: null | string
  teamId: null | string
}

/** The open thread's own header: title, status + who + reply count, the
 *  team's Make-task action, Stop while it works, Close. */
export function GroupThreadPanelHeader({ item, nameOf, onClose, onStop, owner, teamId }: GroupThreadPanelHeaderProps) {
  const b = useBots()
  const text = useRoomText()
  const [filed, setFiled] = useState(false)
  const who = item.working.length ? item.working : item.assignees

  const fileTask = async () => {
    try {
      await mutateTeam('bots_team.goal.upsert', { owner, team_id: teamId, title: item.title })
      setFiled(true)
    } catch (err) {
      host.notifyError(err, 'Team')
    }
  }

  return (
    <div
      className="flex min-h-13 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5"
      data-testid="group-thread-header"
    >
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-ui-sm font-semibold text-fg">{item.title}</div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ui-2xs text-fg-muted">
          <span className={cn('shrink-0 rounded-pill px-1.5 py-px font-semibold', THREAD_STATUS_PILL[item.status])}>
            {b.group.workStatus[item.status]}
          </span>
          {who.length ? (
            <span className="min-w-0 truncate">
              {item.working.length
                ? b.group.threadWorking(who.map(nameOf).join(', '))
                : b.group.threadPeople(who.map(nameOf).join(', '))}
            </span>
          ) : null}
          <span className="shrink-0 tabular-nums text-fg-subtle">{b.group.workCount(item.count)}</span>
        </div>
      </div>
      {teamId ? (
        <Button className="shrink-0" disabled={filed} onClick={() => void fileTask()} size="sm" variant="ghost">
          <Codicon name={filed ? 'check' : 'tasklist'} />
          {filed ? b.group.taskFiled : b.group.makeTask}
        </Button>
      ) : null}
      {onStop && item.status === 'working' ? (
        <Button className="shrink-0" onClick={onStop} size="sm" variant="ghost">
          <Codicon name="debug-stop" />
          {b.group.stopWork}
        </Button>
      ) : null}
      <Button aria-label={text.threadClose} className="shrink-0" onClick={onClose} size="icon-xs" variant="ghost">
        <Codicon name="close" />
      </Button>
    </div>
  )
}

export interface GroupThreadPanelProps {
  /** The thread's entries, already rendered by the room. */
  children: ReactNode
  composer: ReactNode
  /** Grows as entries land; the panel follows the tail while the reader is there. */
  entryCount: number
  header: ReactNode
  onClose: () => void
  thread: string
}

export function GroupThreadPanel({ children, composer, entryCount, header, onClose, thread }: GroupThreadPanelProps) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    stick.current = true
    const el = scroller.current

    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [thread])

  useEffect(() => {
    const el = scroller.current

    if (el && stick.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [entryCount])

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      data-testid="group-thread-panel"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      {header}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        data-testid="group-thread-log"
        onScroll={event => {
          const el = event.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
        }}
        ref={scroller}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1 px-2.5 pt-1 pb-2">{children}</div>
      </div>
      <div className="border-t border-line bg-surface p-2">{composer}</div>
    </section>
  )
}
