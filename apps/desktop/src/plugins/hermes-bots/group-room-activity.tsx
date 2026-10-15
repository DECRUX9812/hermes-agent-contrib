/**
 * The room's collapsible Activity bar: a quiet 32px row under the header
 * showing the latest turn event (or an unresolved failure once the run
 * stopped), expanding into the current run's events newest-first.
 *
 * activitySummary is pure so the "unresolved failure wins once stopped"
 * rule is testable without rendering.
 */

import { Button, cn, Codicon, relativeTime, Tip } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { GROUP_ACTIVITY_GLYPHS, groupActivityLabel, groupActivityTone } from './group-activity'
import type { GroupActivityEntry } from './group-activity'
import { useBots } from './i18n'

/** The collapsed row's summary: the latest event, unless the run stopped
 *  with a member's failure still unresolved — that warning outranks whatever
 *  landed after it. A later success for that member clears it. */
export function activitySummary(
  events: readonly GroupActivityEntry[],
  running: boolean
): GroupActivityEntry | null {
  const latest = events.length ? events[events.length - 1]! : null

  if (running || !events.length) {
    return latest
  }

  const unresolved = new Map<string, GroupActivityEntry>()

  for (const event of events) {
    const key = event.member || ''

    if (event.kind === 'failed' || event.kind === 'timed-out') {
      unresolved.delete(key)
      unresolved.set(key, event)
    } else if (event.kind === 'replied' || event.kind === 'passed' || event.kind === 'delivered') {
      unresolved.delete(key)
    }
  }

  return unresolved.size ? [...unresolved.values()].at(-1)! : latest
}

export interface GroupRoomActivityBarProps {
  events: readonly GroupActivityEntry[]
  group: string
  onStopAll: () => void
  running: boolean
}

export function GroupRoomActivityBar({ events, group, onStopAll, running }: GroupRoomActivityBarProps) {
  const b = useBots()
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const summary = activitySummary(events, running)
  const panelId = `group-activity:${group}`

  const toggle = () => {
    setOpen(prev => {
      if (!prev) {
        setEverOpened(true)
      }

      return !prev
    })
  }

  return (
    <div className="border-b border-line">
      <div className="flex h-8 items-center gap-1 px-4 text-ui-xs text-fg-muted">
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
          onClick={toggle}
          type="button"
        >
          <Codicon className="shrink-0" name={open ? 'chevron-down' : 'chevron-right'} />
          {running ? (
            <span className="motion-ring text-brand rounded-pill shrink-0">
              <span aria-hidden className="block size-1.5 rounded-pill bg-brand" />
            </span>
          ) : null}
          <span className="shrink-0 font-medium text-fg-secondary">{b.group.activity}</span>
          {summary && !open ? (
            <>
              <span className={cn('min-w-0 flex-1 truncate', groupActivityTone(summary.kind))}>
                {groupActivityLabel(summary, group)}
              </span>
              <span className="shrink-0 text-fg-subtle tabular-nums">{relativeTime(summary.at)}</span>
            </>
          ) : null}
        </button>
        {running ? (
          <Tip label={b.group.stopHint}>
            <Button className="shrink-0" onClick={onStopAll} size="xs" variant="ghost">
              <Codicon name="debug-stop" />
              {b.group.stopAll}
            </Button>
          </Tip>
        ) : null}
      </div>
      <div className="motion-collapse" data-open={open}>
        <div id={panelId} inert={!open}>
          {everOpened ? (
            events.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
                {[...events].reverse().map((event, i) => (
                  <li className="flex h-6 items-center gap-1.5 px-4 text-ui-xs" key={`${event.at}:${i}`}>
                    <Codicon
                      className={cn('shrink-0', groupActivityTone(event.kind))}
                      name={GROUP_ACTIVITY_GLYPHS[event.kind] || 'circle-outline'}
                    />
                    <span className={cn('min-w-0 flex-1 truncate', groupActivityTone(event.kind))}>
                      {groupActivityLabel(event, group)}
                    </span>
                    <span className="shrink-0 text-fg-subtle tabular-nums">{relativeTime(event.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-1 text-ui-xs text-fg-muted">{b.group.noActivityYet}</div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
