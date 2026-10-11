/**
 * Focus pieces for the room's one-composer flow.
 *
 * GroupThreadHeader — sits over the conversation while one thread is focused:
 *   back to All, the ask, where it stands, who is on it, and (in a team room)
 *   filing it as a team task.
 * GroupComposerContext — the strip above the single bottom composer saying
 *   where the next message goes: a new thread (and who hears it), or a reply
 *   in a named thread with a one-click way out. Replaces the reply boxes that
 *   used to open in the middle of the log.
 */

import { Button, cn, Codicon, host, Tip } from '@hermes/plugin-sdk'
import { useState } from 'react'

import type { RoomWorkItem, RoomWorkStatus } from './group-room-work'
import { useBots } from './i18n'
import { mutateTeam } from './team'

const TONE: Record<RoomWorkStatus, string> = {
  answered: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  open: 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)',
  waiting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  working: 'bg-(--ui-accent)/12 text-(--ui-accent)'
}

export interface GroupThreadHeaderProps {
  item: RoomWorkItem
  nameOf: (name: string) => string
  onBack: () => void
  /** Seat profile that owns the thread's task, when one holds a seat. */
  owner: null | string
  teamId: null | string
}

export function GroupThreadHeader({ item, nameOf, onBack, owner, teamId }: GroupThreadHeaderProps) {
  const b = useBots()
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
      className="flex items-start gap-2 border-b border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 py-2"
      data-testid="group-thread-header"
    >
      <Tip label={b.group.threadsAll}>
        <Button
          aria-label={b.group.threadsAll}
          className="mt-0.5 shrink-0"
          onClick={onBack}
          size="icon-xs"
          variant="ghost"
        >
          <Codicon name="arrow-left" />
        </Button>
      </Tip>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[0.8125rem] leading-snug font-semibold text-foreground">{item.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-(--ui-text-tertiary)">
          <span className={cn('rounded px-1.5 py-px text-[0.625rem] font-medium', TONE[item.status])}>
            {b.group.workStatus[item.status]}
          </span>
          {who.length ? (
            <span className="truncate">
              {item.working.length
                ? b.group.threadWorking(who.map(nameOf).join(', '))
                : b.group.threadPeople(who.map(nameOf).join(', '))}
            </span>
          ) : null}
          <span className="tabular-nums text-(--ui-text-quaternary)">{b.group.workCount(item.count)}</span>
        </div>
      </div>
      {teamId ? (
        <Button className="shrink-0" disabled={filed} onClick={() => void fileTask()} size="sm" variant="secondary">
          <Codicon name={filed ? 'check' : 'tasklist'} />
          {filed ? b.group.taskFiled : b.group.makeTask}
        </Button>
      ) : null}
    </div>
  )
}

export interface GroupComposerContextProps {
  /** Who hears a plain message in a new thread: the lead's name, or '' for everyone. */
  leadName: string
  onClear: () => void
  /** The thread a reply continues; null composes a new thread. */
  replyTitle: null | string
}

export function GroupComposerContext({ leadName, onClear, replyTitle }: GroupComposerContextProps) {
  const b = useBots()

  return (
    <div
      className={cn(
        'mb-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[0.6875rem]',
        replyTitle ? 'bg-(--ui-accent)/10 text-(--ui-accent)' : 'text-(--ui-text-tertiary)'
      )}
      data-testid="group-composer-context"
    >
      <Codicon className="shrink-0" name={replyTitle ? 'reply' : 'add'} />
      <span className="min-w-0 flex-1 truncate">
        {replyTitle
          ? b.group.composerReplyingIn(replyTitle)
          : leadName
            ? b.group.composerNewThreadTo(leadName)
            : b.group.composerNewThreadEveryone}
      </span>
      {replyTitle ? (
        <Tip label={b.group.composerStartNew}>
          <Button
            aria-label={b.group.composerStartNew}
            className="h-5 shrink-0 px-1.5 text-[0.625rem]"
            onClick={onClear}
            size="sm"
            variant="ghost"
          >
            <Codicon name="close" />
            {b.group.composerStartNew}
          </Button>
        </Tip>
      ) : null}
    </div>
  )
}
