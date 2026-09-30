/**
 * D3 — routines calendar: every bot's scheduled jobs in one read-only view.
 *
 * Reads through the plugin's existing per-bot `loadRoutines` (cron.manage
 * list) once per open — the roster toolbar is the entry, so there is no new
 * background polling. The "Next up" strip is the soonest live fires across
 * all profiles; the list below groups every upcoming fire by local day,
 * then a paused/disabled tail so a dormant routine still shows.
 */

import {
  cn,
  Codicon,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  nextRunOverdueMs,
  relativeTime,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { loadRoutines } from './cron'
import { $botMeta, botRosterKey } from './data'
import { groupFleetRoutines } from './fleet-schedule'
import type { FleetRoutine } from './fleet-schedule'
import { useBots } from './i18n'
import { displayName } from './labels'
import { botRosterMeta } from './routing'
import type { RosterRow } from './types'

function FleetJobRow({ bot, job }: FleetRoutine) {
  const b = useBots()
  const allMeta = useValue($botMeta)
  const meta = botRosterMeta(bot, allMeta)
  const { shape, color, image } = botAppearance(bot.name, meta)
  const name = displayName(bot, meta)
  const fireAt = Date.parse(String(job.next_run_at || ''))
  const overdue = nextRunOverdueMs(job) !== null
  const paused = job.enabled === false || job.state === 'paused'
  const jobTitle = String(job.name || job.prompt || job.prompt_preview || '').trim() || b.calendar.untitledJob

  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
      <BotFace color={avatarColor(color, bot.name)} image={image} name={bot.name} shape={shape} size={16} />
      <span className="min-w-0 flex-1 truncate text-[0.75rem] text-(--ui-text-secondary)">{jobTitle}</span>
      <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">{name}</span>
      {paused ? (
        <span className="shrink-0 text-[0.65rem] text-(--ui-text-quaternary)">—</span>
      ) : Number.isFinite(fireAt) ? (
        <span
          className={cn(
            'shrink-0 text-[0.65rem] tabular-nums',
            overdue ? 'text-amber-600 dark:text-amber-300' : 'text-(--ui-text-quaternary)'
          )}
        >
          {overdue ? `${b.calendar.overdue} · ` : ''}
          {relativeTime(fireAt)}
        </span>
      ) : null}
    </div>
  )
}

export function RoutinesCalendarDialog({
  bots,
  onClose,
  open
}: {
  bots: RosterRow[]
  onClose: () => void
  open: boolean
}) {
  const b = useBots()
  const [items, setItems] = useState<FleetRoutine[]>([])
  const [partial, setPartial] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setLoading(true)
    setItems([])

    const eligible = bots.filter(bot => !bot?.ghost)

    void Promise.allSettled(eligible.map(bot => loadRoutines(bot))).then(results => {
      if (cancelled) {
        return
      }

      const collected: FleetRoutine[] = []
      let failed = 0

      results.forEach((result, index) => {
        const bot = eligible[index]

        if (result.status === 'fulfilled') {
          for (const job of result.value?.jobs || []) {
            collected.push({ bot, job })
          }
        } else {
          failed += 1
        }
      })

      setItems(collected)
      setPartial(failed > 0)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [open, bots])

  const groups = groupFleetRoutines(items)
  const hasAny = groups.nextUp.length > 0 || groups.days.length > 0 || groups.dormant.length > 0

  return (
    <Dialog
      onOpenChange={value => {
        if (!value) {
          onClose()
        }
      }}
      open={open}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{b.calendar.title}</DialogTitle>
          <DialogDescription>{b.calendar.desc}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] min-h-0 flex-col gap-2 overflow-y-auto">
          {partial ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[0.6875rem] text-amber-700 dark:text-amber-300">
              {b.calendar.loadFailed}
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center gap-1.5 px-1 py-3 text-[0.75rem] text-(--ui-text-tertiary)">
              <Codicon name="loading" spinning />
              {b.calendar.title}
            </div>
          ) : !hasAny ? (
            <div className="px-1 py-4 text-center text-[0.75rem] text-(--ui-text-tertiary)">{b.calendar.empty}</div>
          ) : (
            <>
              {groups.nextUp.length ? (
                <div>
                  <div className="px-1 pb-0.5 ui-section-label">{b.calendar.nextUp}</div>
                  {groups.nextUp.map(item => (
                    <FleetJobRow bot={item.bot} job={item.job} key={`${botRosterKey(item.bot)}:${item.job.job_id}`} />
                  ))}
                </div>
              ) : null}
              {groups.days.map(group => (
                <div key={group.label}>
                  <div className="px-1 pb-0.5 pt-1 ui-section-label">{group.label}</div>
                  {group.items.map(item => (
                    <FleetJobRow bot={item.bot} job={item.job} key={`${botRosterKey(item.bot)}:${item.job.job_id}`} />
                  ))}
                </div>
              ))}
              {groups.dormant.length ? (
                <div>
                  <div className="px-1 pb-0.5 pt-1 ui-section-label">{b.calendar.paused}</div>
                  {groups.dormant.map(item => (
                    <FleetJobRow bot={item.bot} job={item.job} key={`${botRosterKey(item.bot)}:${item.job.job_id}:d`} />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
