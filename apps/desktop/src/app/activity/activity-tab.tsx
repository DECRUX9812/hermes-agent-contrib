import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { EmptyState } from '@/components/ui/empty-state'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { Loader } from '@/components/ui/loader'
import { sessionTitle } from '@/lib/chat-runtime'
import { relativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { $desktopActionTasks, type RailTaskStatus } from '@/store/activity'
import { $sessions, $sessionsLoading } from '@/store/session'

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
      return <Codicon className="text-red-400" name="error" />

    default:
      return <Codicon className="text-emerald-400" name="check" />
  }
}

export function ActivityTab() {
  const actionTasks = useStore($desktopActionTasks)
  const sessions = useStore($sessions)
  const loading = useStore($sessionsLoading)

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

  if (loading) {
    return (
      <div className="grid min-h-48 place-items-center">
        <Loader className="size-6 text-(--ui-text-tertiary)" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        description="When bots run tasks or you start conversations, they will show up here."
        title="Nothing happening yet"
      />
    )
  }

  return (
    <ul aria-label="Recent activity" className="flex flex-col gap-1">
      {rows.map(row => (
        <li
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2',
            'hover:bg-(--ui-control-hover-background)'
          )}
          key={row.id}
        >
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center">
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
