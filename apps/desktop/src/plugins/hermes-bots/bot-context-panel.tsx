/**
 * Bot Context Panel — the per-bot right rail from the bot-mode redesign: an
 * agent header (face, name, live status), a four-view segmented toolbar, and
 * a Now / Today / Yesterday activity timeline fed by the bot's own routine
 * runs, with the full routines list one tab over.
 *
 * Every row is backend evidence: routine last-runs with their recorded
 * statuses, the bot's recent session, live group-turn presence. No derived
 * activity model, no invented tasks.
 */

import {
  Button,
  Codicon,
  codiconIcon,
  DAY,
  GlyphSpinner,
  nominalDayStart,
  PanelEmpty,
  relativeTime,
  SegmentedControl,
  Tip,
  useI18n,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { $focusedBotOwner, $selectedBot, focusedRosterOwner } from './bot-state'
import {
  CreateRoutineDialog,
  loadRoutines,
  resolveRoutineOwner,
  routineCreateTarget,
  RoutineDetailDialog,
  routineFilterHint,
  routineLastResult,
  RoutineRow,
  routineTitle,
  scheduleLabel,
  selectRoutineJobs
} from './cron'
import { $botMeta, $lastRoster, botRosterKey } from './data'
import { $groupClarify, $groupChatWorkspace } from './group-chat'
import { $activeGroupMemberKeys } from './group-presence'
import { type BotsText, useBots } from './i18n'
import { displayName } from './labels'
import { botRecentSession, openBotRecentSession } from './recent-session'
import { EditProfileDialog } from './edit-profile-dialog'
import { openRosterBot } from './roster-actions'
import { cn } from '@/lib/utils'
import { botRosterMeta } from './routing'
import type { RosterRow, RoutineJob } from './types'

type PanelView = 'history' | 'saved' | 'scheduled' | 'tasks'

// Module-level so the tab icons keep a stable component identity across renders.
const TASKS_ICON = codiconIcon('list-tree')
const SCHEDULED_ICON = codiconIcon('clock')
const HISTORY_ICON = codiconIcon('history')
const SAVED_ICON = codiconIcon('bookmark')

/** A routine run worth a timeline row: it fired, and the gateway recorded when. */
export interface PanelTaskRun {
  at: number
  detail: null | string
  id: string
  result: null | string
  status: 'error' | 'ok'
  title: string
}

/** Completed routine runs, newest first. Jobs that never fired have no row. */
export function panelTaskRuns(jobs: RoutineJob[], c: BotsText['cron']): PanelTaskRun[] {
  const runs: PanelTaskRun[] = []

  for (const job of jobs) {
    const at = job.last_run_at ? new Date(job.last_run_at).getTime() : Number.NaN

    if (!Number.isFinite(at)) {
      continue
    }

    const failed =
      job.last_status === 'error' ||
      job.last_status === 'delivery_failed' ||
      Boolean(job.last_fire_error || job.last_delivery_error)

    runs.push({
      at,
      detail: job.last_fire_error || job.last_delivery_error || scheduleLabel(job.schedule) || null,
      id: job.job_id,
      result: routineLastResult(job.last_status, c),
      status: failed ? 'error' : 'ok',
      title: routineTitle(job, c)
    })
  }

  return runs.sort((a, b) => b.at - a.at)
}

// "Today" / "Yesterday" / "Oct 24" — the timeline group label.
function panelDayLabel(at: number, p: BotsText['panel']): string {
  const key = nominalDayStart(at)
  const now = Date.now()

  if (key === nominalDayStart(now)) {
    return p.today
  }

  if (key === nominalDayStart(now - DAY)) {
    return p.yesterday
  }

  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function RunTile({ status }: { status: 'error' | 'ok' | 'running' }) {
  if (status === 'running') {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--ui-accent)/12 text-(--ui-accent)">
        <GlyphSpinner spinner="breathe" />
      </span>
    )
  }

  return (
    <span
      className={
        status === 'error'
          ? 'grid size-6 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive'
          : 'grid size-6 shrink-0 place-items-center rounded-full bg-(--ui-inline-code-background) text-(--ui-text-secondary)'
      }
    >
      <Codicon name={status === 'error' ? 'error' : 'check'} size="0.8125rem" />
    </span>
  )
}

function TaskRow({ run }: { run: PanelTaskRun }) {
  return (
    <div className="flex min-w-0 items-start gap-2 px-2 py-1.5">
      <RunTile status={run.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-(--ui-text-primary)">{run.title}</div>
        {run.detail ? (
          <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">{run.detail}</div>
        ) : null}
      </div>
      <span className="shrink-0 text-[0.6875rem] text-(--ui-text-tertiary)">{relativeTime(run.at)}</span>
    </div>
  )
}

export function BotContextPanel() {
    const [editing, setEditing] = useState<null | RosterRow>(null)
const selected = useValue($selectedBot)
  const focusedOwner = focusedRosterOwner(useValue($focusedBotOwner))
  // Same owner ladder as the routines pane: an authoritative focused owner
  // wins through its exact roster row, otherwise the roster-clicked bot.
  const owner = resolveRoutineOwner(useValue($lastRoster), focusedOwner, selected)
  const bot = String(owner?.name || focusedOwner?.name || 'default').trim() || 'default'
  const allMeta = useValue($botMeta)
  const meta = owner ? botRosterMeta(owner, allMeta) : null
  const { color, image, shape } = botAppearance(bot, meta)
  const b = useBots()
  const { t } = useI18n()
  const c = t.cron
  const p = b.panel
  const [view, setView] = useState<PanelView>('tasks')
  // The scheduled tab shares the routines query shape (same endpoint, same
  // poll) under this panel's own key; last-good mirrors $lastJobs so a failed
  // refresh keeps showing the previous list with the stale notice.
  const [lastGood, setLastGood] = useState<RoutineJob[]>([])
  const [detailJobId, setDetailJobId] = useState<null | string>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createOwner, setCreateOwner] = useState<RosterRow | null>(null)
  const working = useValue($activeGroupMemberKeys).has(owner ? botRosterKey(owner) : '')
  // Needs-you strip (parity with the reference bot pane): pending clarify and
  // approval prompts where THIS bot is the blocked member, or that sit in a
  // room it belongs to — who asked, what for, and a jump to the room.
  const needsYou = Object.values(useValue($groupClarify) || {})
    .filter(prompt => prompt && (prompt.member === bot || prompt.member === owner?.name || prompt.memberKey === botRosterKey(owner || ({} as RosterRow))))
    .sort((a, b) => (a.at || 0) - (b.at || 0))

  const routines = useQuery({
    queryKey: ['bot-context-panel', 'routines', bot],
    queryFn: () => loadRoutines(owner as RosterRow),
    enabled: Boolean(owner?.name),
    refetchInterval: 20000,
    staleTime: 8000
  })

  const { data, dataUpdatedAt, error, isLoading, refetch } = routines
  const jobsView = selectRoutineJobs(data, error, lastGood, bot)

  // Mirror the last good list outside render: a render-phase set loops when
  // the query resolves, an effect settles after paint.
  useEffect(() => {
    if (jobsView.live) {
      setLastGood(jobsView.live)
    }
  }, [jobsView.live])

  if (!owner) {
    return <PanelEmpty description={b.cron.needsRosterFirst} icon="hubot" title={c.title} />
  }

  const jobs = jobsView.jobs
  const runs = panelTaskRuns(jobs, b.cron)
  const groups: Array<{ key: number; runs: PanelTaskRun[] }> = []

  for (const run of runs) {
    const key = nominalDayStart(run.at)
    const last = groups[groups.length - 1]

    if (last && last.key === key) {
      last.runs.push(run)
    } else {
      groups.push({ key, runs: [run] })
    }
  }

  const detailJob = detailJobId ? jobs.find(job => job.job_id === detailJobId) || null : null
  const createTarget = routineCreateTarget(createOwner, bot)
  const staleNotice = error && !jobsView.live && jobsView.all.length ? b.cron.staleNotice : null
  const reachable = owner.sourceReachable !== false && !owner.ghost && !owner.sourceMissing
  const statusText = working ? p.workingNow : reachable ? b.cron.active : p.offline
  const recent = botRecentSession(owner)

  const openCreate = () => {
    setCreateOwner(owner)
    setCreateOpen(true)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col items-center px-4 pt-4 text-center">
        <BotFace color={avatarColor(color, bot)} image={image} name={bot} shape={shape} size={56} />
        <div className="mt-2 max-w-full truncate text-sm font-semibold text-(--ui-text-primary)">
          {displayName({ name: bot }, meta)}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center">
          <span
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium',
              working
                ? 'bg-(--ui-green)/12 text-(--ui-green)'
                : reachable
                  ? 'bg-(--ui-surface-overlay) text-(--ui-text-tertiary)'
                  : 'bg-destructive/10 text-destructive'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                working ? 'bg-(--ui-green)' : reachable ? 'bg-(--ui-text-quaternary)' : 'bg-destructive/70'
              )}
            />
            <span className="truncate">{statusText}</span>
          </span>
        </div>
      </div>
      <div className="px-3 pt-3">
        <SegmentedControl
          className="w-full"
          onChange={setView}
          options={[
            { icon: TASKS_ICON, id: 'tasks', label: p.tasks },
            { icon: SCHEDULED_ICON, id: 'scheduled', label: p.scheduled },
            { icon: HISTORY_ICON, id: 'history', label: p.history },
            { icon: SAVED_ICON, id: 'saved', label: p.saved }
          ]}
          value={view}
        />
      </div>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {needsYou.length ? (
        <div className="mx-1.5 mb-1 grid gap-1 rounded-md border border-(--ui-icon-attention)/35 bg-(--ui-icon-attention)/8 px-2 py-1.5" data-slot="bots-needs-you">
          <div className="px-1 pb-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-(--ui-icon-attention)">
            {b.group.needsYourInput} · {needsYou.length}
          </div>
          {needsYou.map(prompt => {
            const question = prompt.kind === 'approval' ? prompt.question : (prompt.questions || []).map(q => q.question).filter(Boolean).join(' · ')
            return (
              <button
                className="flex min-w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-(--chrome-action-hover)"
                key={`${prompt.group}:${prompt.requestId}`}
                onClick={() => $groupChatWorkspace.set(prompt.group)}
                type="button"
              >
                <Codicon className="shrink-0 text-(--ui-icon-attention)" name="info" size="0.9375rem" />
                <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-(--ui-text-secondary)">
                  <span className="font-medium text-(--ui-text-primary)">@{prompt.member}</span>
                  {' '}{question || b.group.needsYourInput}
                </span>
                <Codicon className="shrink-0 text-(--ui-text-quaternary)" name="arrow-right" size="0.8125rem" />
              </button>
            )
          })}
        </div>
      ) : null}
      {view === 'tasks' ? (
          <div className="px-1.5 py-1.5">
            {working ? (
              <div>
                <div className="px-2 pt-1 text-xs font-semibold text-(--ui-text-primary)">{p.now}</div>
                <div className="flex min-w-0 items-start gap-2 px-2 py-1.5">
                  <RunTile status="running" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-(--ui-text-primary)">{p.workingNow}</div>
                  </div>
                </div>
              </div>
            ) : null}
            {runs.length === 0 && !isLoading ? (
              <PanelEmpty description={p.noRuns} icon="list-tree" title={p.tasks} />
            ) : (
              groups.map(group => (
                <div key={group.key}>
                  <div className="flex items-baseline gap-1.5 px-2 pt-2">
                    <span className="text-xs font-semibold text-(--ui-text-primary)" data-testid="panel-day">
                      {panelDayLabel(group.runs[0].at, p)}
                    </span>
                    <span className="text-[0.6875rem] text-(--ui-text-tertiary)">
                      {p.tasksCompleted(group.runs.length)}
                    </span>
                  </div>
                  {group.runs.map(run => (
                    <TaskRow key={run.id} run={run} />
                  ))}
                </div>
              ))
            )}
          </div>
        ) : null}
        {view === 'scheduled' ? (
          <div className="flex min-h-full flex-col px-1.5 py-1.5">
            <div className="flex items-center justify-end px-1">
              <Tip label={c.newCron}>
                <Button aria-label={c.newCron} onClick={openCreate} size="icon-xs" variant="ghost">
                  <Codicon name="add" />
                </Button>
              </Tip>
            </div>
            {staleNotice ? (
              <div className="mx-1.5 mt-1 rounded-md bg-(--chrome-action-hover) px-2 py-1.5 text-[0.6875rem] text-(--ui-text-tertiary)">
                {staleNotice}
              </div>
            ) : null}
            {isLoading && !jobsView.all.length ? (
              <div className="flex flex-1 items-center justify-center py-8">
                <GlyphSpinner className="text-(--ui-text-tertiary)" spinner="breathe" />
              </div>
            ) : error && !jobsView.all.length ? (
              <PanelEmpty
                action={
                  <Button onClick={() => void refetch()} size="sm" variant="secondary">
                    {t.common.retry}
                  </Button>
                }
                description={b.cron.readFailure}
                icon="warning"
                title={c.failedLoad}
              />
            ) : jobs.length === 0 ? (
              <PanelEmpty
                action={
                  <Button onClick={openCreate} size="sm">
                    {c.newCron}
                  </Button>
                }
                description={routineFilterHint(jobsView.all, jobs) || c.emptyDescNew}
                icon="watch"
                title={c.emptyTitleNew}
              />
            ) : (
              <div className="grid gap-0.5">
                {jobs.map(job => (
                  <RoutineRow job={job} key={job.job_id} onOpen={opened => setDetailJobId(opened.job_id)} owner={owner} />
                ))}
              </div>
            )}
            <RoutineDetailDialog job={detailJob} onClose={() => setDetailJobId(null)} open={Boolean(detailJob)} />
            <CreateRoutineDialog
              bot={createTarget!}
              key={createTarget as string}
              onClose={() => {
                setCreateOpen(false)
                setCreateOwner(null)
              }}
              open={createOpen}
            />
          </div>
        ) : null}
        {view === 'history' ? (
          <div className="px-1.5 py-1.5">
            {recent ? (
              <button
                className="flex min-w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-(--chrome-action-hover)"
                onClick={() => void openBotRecentSession(owner)}
                type="button"
              >
                <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="history" size="0.9375rem" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--ui-text-primary)">
                  {recent.title || recent.id}
                </span>
                <Codicon className="shrink-0 text-(--ui-text-quaternary)" name="arrow-right" size="0.8125rem" />
              </button>
            ) : (
              <PanelEmpty description={p.noHistory} icon="history" title={p.history} />
            )}
          </div>
        ) : null}
        {view === 'saved' ? (
          <div className="px-1.5 py-1.5">
            <PanelEmpty description={p.noSaved} icon="bookmark" title={p.saved} />
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-(--ui-stroke-tertiary) px-3 py-2">
        <span className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">
          {dataUpdatedAt ? relativeTime(dataUpdatedAt) : p.updatedNow}
        </span>
        <div className="flex items-center gap-1">
          {owner ? (
            <Button onClick={() => setEditing(owner)} size="sm" variant="ghost">
              {b.bot.editMenu}
            </Button>
          ) : null}
          <Button onClick={() => void openRosterBot(owner)} size="sm" variant="secondary">
            {p.openChat} →
          </Button>
        </div>
      </div>
      {owner ? (
        <EditProfileDialog
          bot={editing}
          onClose={() => setEditing(null)}
          open={Boolean(editing)}
        />
      ) : null}
    </div>
  )
}
