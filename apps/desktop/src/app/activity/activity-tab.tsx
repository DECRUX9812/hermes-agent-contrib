import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { sessionTitle } from '@/lib/chat-runtime'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { $desktopActionTasks, type RailTaskStatus } from '@/store/activity'
import { $sessions } from '@/store/session'

// Activity tab — what every bot is doing and has done, newest first.
// Two honest sources: desktop action tasks (real background work) and recent
// sessions (real conversations). No invented activity, ever.

interface ActivityRow {
  id: string
  label: string
  detail: string
  status: RailTaskStatus
  updatedAt: number
}

function statusIcon(status: RailTaskStatus) {
  switch (status) {
    case 'running':
      return <GlyphSpinner className="text-violet-300" />
    case 'error':
      return <Codicon name="error" className="text-red-400" />
    default:
      return <Codicon name="check" className="text-emerald-400" />
  }
}

export function ActivityTab() {
  const actionTasks = useStore($desktopActionTasks)
  const sessions = useStore($sessions)

  const rows = useMemo<ActivityRow[]>(() => {
    const actions: ActivityRow[] = Object.values(actionTasks).map(({ status, updatedAt }) => ({
      id: `action:${status.name}`,
      label: status.name,
      detail: status.running ? 'Running now' : status.exit_code === 0 ? 'Completed' : 'Failed',
      status: status.running ? 'running' : status.exit_code === 0 ? 'success' : 'error',
      updatedAt
    }))

    const recentSessions: ActivityRow[] = (sessions ?? [])
      .filter(s => (s.last_active ?? 0) > 0)
      .sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))
      .slice(0, 10)
      .map(s => ({
        id: `session:${s.id}`,
        label: sessionTitle(s),
        detail: 'Conversation',
        status: 'success' as RailTaskStatus,
        updatedAt: s.last_active ?? 0
      }))

    return [...actions, ...recentSessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
  }, [actionTasks, sessions])

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
        <Codicon name="pulse" className="text-[2rem] text-(--ui-text-quaternary)" />
        <p className="text-[0.875rem] font-medium text-foreground">Nothing happening yet</p>
        <p className="max-w-60 text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">
          When bots run tasks or you start conversations, they will show up here.
        </p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-1" aria-label="Recent activity">
      {rows.map(row => (
        <li
          key={row.id}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2',
            'hover:bg-(--ui-control-hover-background)'
          )}
        >
          <span className="grid size-6 shrink-0 place-items-center" aria-hidden="true">
            {statusIcon(row.status)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[0.8125rem] font-medium text-foreground">{row.label}</div>
            <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">{row.detail}</div>
          </div>
          <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">
            {relativeTime(row.updatedAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}
