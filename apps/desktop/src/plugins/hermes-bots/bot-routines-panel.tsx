import { Button, Codicon, host, relativeTime, useI18n } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { AUTOPILOT_ICONS, autopilotPresets, type RoutinePreset } from './autopilot'
import { useAutopilotText } from './autopilot-i18n'
import { mutateBotRoutine, useBotRoutines, useLegacyCronJobs } from './bot-routines'
import type { BotRoutine } from './bot-routines'
import { CreateRoutineDialog } from './cron'
import { useBots } from './i18n'
import type { RosterRow, RoutineJob } from './types'

function lastStatus(value: string | null | undefined, b: ReturnType<typeof useBots>) {
  if (!value) {
    return '—'
  }

  if (value === 'success' || value === 'completed' || value === 'ok') {
    return b.cron.succeeded
  }

  if (value === 'failed' || value === 'error' || value === 'delivery_failed') {
    return b.cron.failed
  }

  return value
}

function formatNextRun(value: string | null | undefined, b: ReturnType<typeof useBots>) {
  if (!value) {
    return b.cron.paused
  }

  const timestamp = Date.parse(value)

  return Number.isFinite(timestamp) ? relativeTime(timestamp) : value
}

function RoutineRow({
  bot,
  onEdit,
  routine
}: {
  bot: RosterRow
  onEdit: (routine: BotRoutine) => void
  routine: BotRoutine
}) {
  const { t } = useI18n()
  const b = useBots()
  const [busy, setBusy] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const enabled = routine.enabled
  const kind = routine.kind === 'watch' ? b.routines.kindWatch : b.routines.kindSchedule

  const run = async (action: 'pause' | 'remove' | 'resume' | 'run_now') => {
    if (busy) {
      return
    }

    setBusy(true)

    try {
      await mutateBotRoutine(bot, action, routine.id)
      setConfirmingRemove(false)
    } catch (error) {
      host.notifyError(error, b.routines.actionFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="grid gap-1.5 border-b border-line px-2 py-2 last:border-b-0" data-testid={`routine:${routine.id}`}>
      <div className="flex min-w-0 items-center gap-2">
        <Codicon
          aria-label={enabled ? b.cron.active : b.cron.paused}
          className={enabled ? 'shrink-0 text-success' : 'shrink-0 text-fg-muted'}
          name={enabled ? 'check' : 'debug-pause'}
        />
        <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-fg">{routine.name}</span>
        <span className="shrink-0 text-ui-2xs text-fg-muted">{kind}</span>
      </div>
      <div className="grid gap-x-2 gap-y-1 pl-5 text-ui-2xs text-fg-muted sm:grid-cols-2">
        <span className="truncate" title={routine.schedule}>
          {routine.schedule}
        </span>
        <span className="truncate">
          {b.cron.nextRun}: {formatNextRun(routine.next_run_at, b)}
        </span>
        <span className="truncate">
          {b.routines.lastStatus}: {lastStatus(routine.last_status, b)}
        </span>
        {routine.last_run_at ? (
          <span className="truncate">
            {b.cron.lastRun}: {relativeTime(Date.parse(routine.last_run_at))}
          </span>
        ) : null}
      </div>
      {confirmingRemove ? (
        <div aria-label={b.routines.confirmRemove} className="flex items-center gap-2 pl-5 text-ui-xs" role="group">
          <span className="flex-1 text-fg-secondary">{b.routines.removePrompt(routine.name)}</span>
          <Button disabled={busy} onClick={() => void run('remove')} size="xs" variant="destructive">
            {busy ? t.common.saving : t.common.remove}
          </Button>
          <Button disabled={busy} onClick={() => setConfirmingRemove(false)} size="xs" variant="text">
            {t.common.cancel}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1 pl-5">
          <Button disabled={busy} onClick={() => void run(enabled ? 'pause' : 'resume')} size="xs" variant="ghost">
            <Codicon name={enabled ? 'debug-pause' : 'play'} />
            {enabled ? b.routines.pause : b.routines.resume}
          </Button>
          <Button disabled={busy || !enabled} onClick={() => void run('run_now')} size="xs" variant="ghost">
            <Codicon name="play" />
            {b.routines.runNow}
          </Button>
          <Button disabled={busy} onClick={() => onEdit(routine)} size="xs" variant="ghost">
            <Codicon name="edit" />
            {b.routines.edit}
          </Button>
          <Button disabled={busy} onClick={() => setConfirmingRemove(true)} size="xs" variant="ghost">
            <Codicon name="trash" />
            {t.common.remove}
          </Button>
        </div>
      )}
    </li>
  )
}

function LegacyCronList({ jobs }: { jobs: RoutineJob[] }) {
  const b = useBots()

  if (!jobs.length) {
    return null
  }

  return (
    <section className="grid gap-1 pt-2" data-testid="legacy-cron-list">
      <h3 className="px-2 text-ui-xs font-medium text-fg-muted">{b.routines.legacyTitle}</h3>
      <ul className="grid">
        {jobs.map(job => (
          <li className="flex min-w-0 items-center gap-2 px-2 py-1.5 text-ui-xs text-fg-muted" key={job.job_id}>
            <Codicon className="shrink-0" name="calendar" />
            <span className="min-w-0 flex-1 truncate">
              {job.name || job.prompt_preview || job.prompt || b.cron.untitled}
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {job.enabled === false ? b.cron.paused : formatNextRun(job.next_run_at, b)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RoutinePresets({
  name,
  onCreate,
  routines
}: {
  name: string
  onCreate: (preset?: RoutinePreset) => void
  routines: BotRoutine[]
}) {
  const a = useAutopilotText()
  const presets = autopilotPresets(a).filter(({ label }) => !routines.some(routine => routine.name.endsWith(label)))

  if (!presets.length) {
    return null
  }

  return (
    <div className="grid gap-1.5 border-t border-line px-2 pt-2" data-slot="autopilot">
      <p className="text-ui-xs font-medium text-fg">{a.heading(name)}</p>
      <p className="text-ui-2xs leading-snug text-fg-muted">{a.hint}</p>
      <div className="flex flex-wrap gap-1">
        {presets.map(({ id, label, preset }) => (
          <Button key={id} onClick={() => onCreate(preset)} size="xs" variant="secondary">
            <Codicon name={AUTOPILOT_ICONS[id]} />
            {label}
          </Button>
        ))}
        <Button onClick={() => onCreate()} size="xs" variant="ghost">
          <Codicon name="add" />
          {a.custom}
        </Button>
      </div>
    </div>
  )
}

export function BotRoutinesPanel({
  bot,
  name,
  onCreate
}: {
  bot: RosterRow
  name: string
  onCreate: (preset?: RoutinePreset) => void
}) {
  const b = useBots()
  const routinesQuery = useBotRoutines(bot)
  const legacyQuery = useLegacyCronJobs(bot)
  const [editingId, setEditingId] = useState<null | string>(null)
  const routines = routinesQuery.data || []
  const legacyJobs = legacyQuery.data || []
  const editing = routines.find(routine => routine.id === editingId) || null

  return (
    <div className="grid gap-1 px-2 pb-2 pt-1" data-testid="bot-routines">
      {routinesQuery.isLoading && !routinesQuery.data ? (
        <div className="px-2 py-3 text-center text-ui-xs text-fg-muted">{b.routines.loading}</div>
      ) : routinesQuery.isError && !routinesQuery.data ? (
        <div className="grid justify-items-start gap-2 px-2 py-3">
          <p className="text-ui-xs text-danger">{b.routines.loadFailed}</p>
          <Button onClick={() => void routinesQuery.refetch()} size="xs" variant="secondary">
            {b.routines.retry}
          </Button>
        </div>
      ) : routines.length ? (
        <ul className="grid" data-testid="routine-list">
          {routines.map(routine => (
            <RoutineRow bot={bot} key={routine.id} onEdit={routine => setEditingId(routine.id)} routine={routine} />
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-center gap-2 px-2 py-4 text-center">
          <p className="text-ui-xs text-fg-muted">{b.routines.empty}</p>
        </div>
      )}
      {!routinesQuery.isLoading && !routinesQuery.isError ? (
        <RoutinePresets name={name} onCreate={onCreate} routines={routines} />
      ) : null}
      {legacyQuery.data ? <LegacyCronList jobs={legacyJobs} /> : null}
      <CreateRoutineDialog
        bot={bot}
        onClose={() => setEditingId(null)}
        open={Boolean(editingId && editing)}
        routine={editing}
      />
    </div>
  )
}
