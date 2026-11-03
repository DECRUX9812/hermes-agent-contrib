/**
 * Bot Context Panel — the per-bot right rail from the bot-mode redesign: an
 * agent header (face, name, live status), a segmented toolbar, and one
 * session-scoped activity feed. The feed selects one conversation at a time
 * and shows that session's tool calls and approvals in order; the full
 * routines list stays one tab over, and History lists the bot's conversations.
 *
 * Every row is backend evidence: persisted `session.history` tool rows, live
 * `tool.*` events for the focused runtime, mirrored approval prompts, and
 * routine last-runs. No cross-session merge, no invented tasks.
 */

import {
  atom,
  Button,
  cn,
  Codicon,
  codiconIcon,
  host,
  PanelEmpty,
  relativeTime,
  SegmentedControl,
  Tip,
  useI18n,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { $focusedBotOwner, $selectedBot, focusedRosterOwner } from './bot-state'
import { $canonicalGroupBindings } from './canonical-group-registry'
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
import { $botMeta, $lastRoster, botRosterKey, saveBotMeta } from './data'
import { EditProfileDialog } from './edit-profile-dialog'
import { $groupActivity } from './group-activity'
import { $groupChats, $groupClarify } from './group-chat'
import { $activeGroupMemberKeys } from './group-presence'
import { stopGroupThread } from './group-rounds'
import { type BotsText, useBots } from './i18n'
import { displayName, slugifyProfileName } from './labels'
import { openBotSession } from './recent-session'
import { openRosterBot } from './roster-actions'
import { botConnectionRoute, botRosterMeta } from './routing'
import { ScreenHero } from './screen-hero'
import { useScreenPortalState } from './screen-portal'
import { $sessionActivity } from './session-activity'
import { SessionActivityPanel } from './session-activity-panel'
import { ID } from './shared'
import type { RosterRow, RoutineJob } from './types'

type PanelView = 'history' | 'scheduled' | 'tasks'

// Module-level so the tab icons keep a stable component identity across renders.
const TASKS_ICON = codiconIcon('list-tree')
const SCHEDULED_ICON = codiconIcon('clock')
const HISTORY_ICON = codiconIcon('history')

/** A timeline row. Two kinds share the timeline because they are the two
 *  things a bot actually does: a scheduled routine fires, and a conversation
 *  happens. Before sessions were a source the timeline could only show
 *  routines, so a bot used the normal way — chatting — reported "no completed
 *  runs yet" forever (DESK-052 follow-up: an empty panel that was empty by
 *  construction, not by absence of work). */
export interface PanelTaskRun {
  at: number
  detail: null | string
  id: string
  kind: 'routine' | 'session'
  result: null | string
  status: 'error' | 'ok' | 'session'
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
      kind: 'routine',
      result: routineLastResult(job.last_status, c),
      status: failed ? 'error' : 'ok',
      title: routineTitle(job, c)
    })
  }

  return runs.sort((a, b) => b.at - a.at)
}

/** One listed conversation the bot's profile owns, as a timeline row. */
interface PanelSessionSource {
  id: string
  last_active?: null | number
  message_count?: null | number
  resolved_id?: null | string
  title?: null | string
}

/** A listed conversation as a timeline row. `last_active` is unix SECONDS
 *  (SessionPreview / SessionInfo), so it is scaled once, here. */
export function panelSessionRuns(sessions: PanelSessionSource[], p: BotsText['panel']): PanelTaskRun[] {
  const runs: PanelTaskRun[] = []

  for (const session of sessions) {
    const id = String(session.id || '').trim()
    const seconds = Number(session.last_active ?? 0)
    const at = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Number.NaN

    if (!id || !Number.isFinite(at)) {
      continue
    }

    const count = Number(session.message_count ?? 0)

    runs.push({
      at,
      detail: Number.isFinite(count) && count > 0 ? p.sessionMessages(count) : null,
      id,
      kind: 'session',
      result: null,
      status: 'session',
      title: String(session.title || '').trim() || id
    })
  }

  return runs.sort((a, b) => b.at - a.at)
}

/** Stable stand-in for shells that predate `host.state.activePaneId`. */
const NO_PANE = atom<null | string | undefined>(undefined)

/** `plugin-workspace:<id>` is what openWorkspace turns a plugin tab into. */
const PANE_PREFIX = 'plugin-workspace:'

/** The room whose tab owns the workspace, or null. Room tabs are opened with
 *  `${ID}:group:${slug}`, so the pane suffix is the whole mapping. */
function roomForPane(paneId: null | string | undefined): null | string {
  if (!paneId || !paneId.startsWith(PANE_PREFIX)) {
    return null
  }

  const key = paneId.slice(PANE_PREFIX.length)
  const prefix = `${ID}:group:`

  if (!key.startsWith(prefix)) {
    return null
  }

  const slug = key.slice(prefix.length)

  // A gateway room is keyed by its canonical key (`canonical:<conn>:<profile>:<id>`),
  // not by its display name, so search both registries — the local rooms and the
  // canonical bindings — before giving up.
  const candidates = [...Object.keys($groupChats.get()), ...Object.keys($canonicalGroupBindings.get())]

  return candidates.find(candidate => slugifyProfileName(candidate) === slug) ?? null
}

/** The name to show for a room key: its gateway display name when the binding
 *  knows one, otherwise the key itself (the legacy local rooms do that today). */
function roomDisplayName(key: string): string {
  return $canonicalGroupBindings.get()[key]?.roomName || key
}

/** What the rail shows while a room owns the workspace. The bot panel's
 *  Activity/Scheduled/History tabs are bot-scoped, so leaving them on screen
 *  would describe the wrong object — the room gets identity, and its routines
 *  live in the room's own "Scheduled jobs" pane. */
function RoomRail({ group }: { group: string }) {
  const b = useBots()
  const bindings = useValue($canonicalGroupBindings)
  const room = useValue($groupChats)[group]
  const binding = bindings[group]
  const members = room?.members ?? []
  const name = binding?.roomName || group

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col items-center px-4 pt-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-xl bg-(--chrome-action-hover) text-(--ui-text-secondary)">
          <Codicon name="organization" size="1.25rem" />
        </span>
        <div className="mt-2 max-w-full truncate text-sm font-semibold text-(--ui-text-primary)">{name}</div>
        {/* Only when the roster is actually known: a gateway room keeps its
            members server-side, and "0 bots" would be a wrong fact, not a
            missing one. */}
        {room ? (
          <div className="mt-0.5 text-11 text-(--ui-text-secondary)">{b.group.memberCount(members.length)}</div>
        ) : null}
      </div>
      <ul className="mt-4 grid gap-1 px-3">
        {members.map(member => (
          <li className="truncate rounded-md px-2 py-1 text-xs text-(--ui-text-secondary)" key={member.name}>
            {member.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Only a live/controlled screen earns the big preview. A stopped or
 *  unknown screen used to paint an empty black rectangle at the top of the
 *  rail; the compact hero below already says what the bot is doing. */
function LiveScreenHero({ bot, meta }: { bot: RosterRow; meta: Parameters<typeof botAppearance>[1] }) {
  const { tone } = useScreenPortalState(bot)

  if (tone !== 'live' && tone !== 'human' && tone !== 'other') {
    return null
  }

  return <ScreenHero bot={bot} meta={meta} />
}

export function BotContextPanel() {
  const [editing, setEditing] = useState<null | RosterRow>(null)
  const selected = useValue($selectedBot)
  const focusedOwner = focusedRosterOwner(useValue($focusedBotOwner))
  // Same owner ladder as the routines pane: an authoritative focused owner
  // wins through its exact roster row, otherwise the roster-clicked bot.
  //
  // Known limitation, measured rather than assumed: opening a group room leaves
  // host.state.focusedStoredSessionId pointing at the PREVIOUS bot chat (it does
  // not clear), so this pane keeps describing that bot while a room owns the
  // workspace. Nothing in the host currently distinguishes "a room tab exists"
  // from "a room tab is focused", so the fix is a focused-tab signal from the
  // host — not a heuristic here. Do not paper over it by hiding the pane on
  // some other state; that would hide it during ordinary bot chats too.
  const owner = resolveRoutineOwner(useValue($lastRoster), focusedOwner, selected)
  const bot = String(owner?.name || focusedOwner?.name || 'default').trim() || 'default'
  const allMeta = useValue($botMeta)
  const activityStore = useValue($sessionActivity)
  const groupPrompts = useValue($groupClarify)
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

  // A room owns the workspace as a plugin tab. `focusedStoredSessionId` does not
  // clear for it (measured), so the bot panel went on describing the previous
  // bot chat inside the room; the raw active pane id is the only thing that
  // answers "is the room's tab the one on screen".
  const activePaneId = useValue(host.state.activePaneId ?? NO_PANE)
  const focusedRoom = roomForPane(activePaneId)

  // Rooms where this bot sits AND a round is live — the Running round strip.
  const runningRoom = Object.entries(useValue($groupChats) || {}).find(
    ([, room]) =>
      room && room.running && Array.isArray(room.members) && room.members.some(member => member && member.name === bot)
  )

  // Inline goal editing (Homie Spot parity): the bot's working goal lives in
  // bot-meta, edits save through saveBotMeta like every other meta field.
  const rooms = useValue($groupChats)
  const activityByRoom = useValue($groupActivity)

  const activity = Object.entries(rooms || {})
    .filter(
      ([, room]) => room && Array.isArray(room.members) && room.members.some(member => member && member.name === bot)
    )
    .flatMap(([group, room]) => (activityByRoom[group]?.events || []).map(event => ({ ...event, group })))
    .sort((a, b) => (b.at || 0) - (a.at || 0))

  // Swarm compression: consecutive same-member same-kind entries collapse
  // into one row with a count instead of flooding the feed.
  const feed = activity.slice(0, 20).reduce<typeof activity>((rows, event) => {
    const last = rows[rows.length - 1]

    if (last && last.member === event.member && last.kind === event.kind) {
      ;(last as { count?: number }).count = ((last as { count?: number }).count || 1) + 1
    } else {
      rows.push({ ...event })
    }

    return rows
  }, [])

  const goal = meta?.goal || ''
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalDraft, setGoalDraft] = useState('')
  const goalInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingGoal) {
      goalInput.current?.focus()
      goalInput.current?.select()
    }
  }, [editingGoal])

  const commitGoal = () => {
    const text = goalDraft.trim()

    if (!text || !owner) {
      return
    }

    void saveBotMeta(owner, { goal: text })
    setEditingGoal(false)
    setGoalDraft('')
  }

  const routines = useQuery({
    queryKey: ['bot-context-panel', 'routines', bot],
    queryFn: () => loadRoutines(owner as RosterRow),
    enabled: Boolean(owner?.name),
    refetchInterval: 20000,
    staleTime: 8000
  })

  const { data, dataUpdatedAt, error, isLoading, refetch } = routines
  const jobsView = selectRoutineJobs(data, error, lastGood, bot)

  // The bot's own listed conversations — the missing half of "activity". The
  // timeline below used to be routines-only, so a bot used the normal way
  // (chatting) reported "No completed runs yet" forever even with a full
  // history. `listPersistedSessions` reads the profile's own state, so this
  // needs no gateway dial and cannot wedge the panel.
  const sessionsQuery = useQuery({
    queryKey: ['bot-context-panel', 'sessions', bot],
    queryFn: async () => {
      if (typeof host.listPersistedSessions !== 'function') {
        return []
      }

      const route = owner ? botConnectionRoute(owner) : null
      const page = await host.listPersistedSessions(route || null, { limit: 25, profile: bot })

      return (page?.sessions || []).filter(session => Boolean(String(session?.id || '').trim()))
    },
    enabled: Boolean(owner?.name),
    refetchInterval: 30000,
    staleTime: 8000
  })

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
  const sessionRuns = panelSessionRuns(sessionsQuery.data || [], p)

  const detailJob = detailJobId ? jobs.find(job => job.job_id === detailJobId) || null : null
  const createTarget = routineCreateTarget(createOwner, bot)
  const staleNotice = error && !jobsView.live && jobsView.all.length ? b.cron.staleNotice : null
  const reachable = owner.sourceReachable !== false && !owner.ghost && !owner.sourceMissing
  const statusText = working ? p.workingNow : reachable ? b.cron.active : p.offline

  // A conversation row carries only what the timeline needs to draw; opening
  // it wants the stored counts too, so they ride along from the same query.
  const openSessionRow = (run: PanelTaskRun) => {
    const source = (sessionsQuery.data || []).find(session => session.id === run.id)

    void openBotSession(owner, {
      id: run.id,
      message_count: source?.message_count,
      title: run.title
    })
  }

  const openCreate = () => {
    setCreateOwner(owner)
    setCreateOpen(true)
  }

  // The avatar's mood and the line under it follow what THIS bot is doing
  // right now, across the sessions the panel has already loaded. A pending
  // approval outranks a running tool: the bot is waiting on the operator, not
  // on itself.
  const botActivity = Object.entries(activityStore)
    .filter(([key]) => key.startsWith(`${bot}::`))
    .flatMap(([, items]) => items)

  const running = botActivity.find(item => item.status === 'running')

  const waitingCount = Math.max(
    botActivity.filter(item => item.status === 'waiting' || item.status === 'pending').length,
    Object.values(groupPrompts).some(prompt => prompt?.member === bot && prompt.kind === 'approval') ? 1 : 0
  )

  const waiting = waitingCount > 0

  const currentTask = running
    ? `${p.workingNow} · ${running.title}`
    : waiting
      ? `${waitingCount} approval${waitingCount === 1 ? '' : 's'} waiting`
      : ''

  const mood = waiting ? 'think' : working || running ? 'work' : 'idle'
  const statusLine = currentTask || statusText

  if (focusedRoom) {
    return <RoomRail group={focusedRoom} />
  }

  return (
    <div className="flex h-full flex-col">
      {owner ? (
        <div className="px-3 pt-3">
          <LiveScreenHero bot={owner} meta={meta} />
        </div>
      ) : null}
      <div className="flex flex-col items-center px-4 pb-1 pt-6 text-center">
        <div className="relative">
          <span
            aria-hidden="true"
            className={cn(
              'absolute -inset-2.5 rounded-full bg-gradient-to-br via-transparent blur-md',
              waiting
                ? 'from-(--ui-icon-attention)/22 to-(--ui-icon-attention)/8'
                : working || running
                  ? 'from-(--ui-green)/20 to-(--ui-green)/8'
                  : 'from-(--ui-accent)/18 to-(--ui-accent)/8'
            )}
          />
          <BotFace color={avatarColor(color, bot)} image={image} mood={mood} name={bot} shape={shape} size={76} />
          {owner ? (
            <Tip label={b.bot.editTitle}>
              <Button
                aria-label={b.bot.editTitle}
                className="absolute -bottom-1 -right-1 size-7 rounded-full border border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) shadow-sm hover:bg-(--chrome-action-hover)"
                onClick={() => setEditing(owner)}
                size="icon-xs"
                variant="ghost"
              >
                <Codicon className="text-(--ui-text-secondary)" name="symbol-color" size="0.8rem" />
              </Button>
            </Tip>
          ) : null}
        </div>
        <div className="mt-3 max-w-full truncate text-base font-semibold leading-tight text-(--ui-text-primary)">
          {displayName({ name: bot }, meta)}
        </div>
        <div className="mt-1 flex min-w-0 max-w-full items-center">
          <span
            aria-live="polite"
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-11 font-medium',
              waiting
                ? 'border border-(--ui-stroke-tertiary) bg-(--ui-icon-attention)/10 text-(--ui-text-primary)'
                : working || running
                  ? 'border border-(--ui-green)/25 bg-(--ui-green)/12 text-(--ui-green)'
                  : reachable
                    ? 'border border-(--ui-stroke-tertiary) bg-(--ui-surface-overlay) text-(--ui-text-secondary)'
                    : 'border border-destructive/25 bg-destructive/10 text-destructive'
            )}
          >
            {working || running ? (
              <span aria-hidden="true" className="relative flex size-1.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-current" />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  waiting ? 'bg-(--ui-icon-attention)' : reachable ? 'bg-(--ui-text-quaternary)' : 'bg-destructive/70'
                )}
              />
            )}
            <span className="truncate">{statusLine}</span>
          </span>
        </div>
      </div>
      <div className="px-3 pt-3">
        <SegmentedControl
          className="w-full"
          onChange={setView}
          options={[
            { icon: TASKS_ICON, id: 'tasks', label: p.activity },
            { icon: SCHEDULED_ICON, id: 'scheduled', label: p.scheduled },
            { icon: HISTORY_ICON, id: 'history', label: p.history }
          ]}
          value={view}
        />
      </div>
      {/* Keyed by owner: a bot/room switch remounts this body instead of
          cross-flashing the previous bot's routines and needs-you strip while
          the new owner's query is still loading (stale-flash defect). */}
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain" key={bot}>
        {runningRoom ? (
          <div
            className="mx-1.5 mb-1 flex items-center justify-between gap-2 rounded-lg border border-(--ui-green)/35 bg-(--ui-green)/8 px-2 py-2 shadow-2xs"
            data-slot="bot-live-round"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5 text-11 font-medium text-(--ui-green)">
              <span aria-hidden="true" className="size-1.5 shrink-0 animate-pulse rounded-full bg-(--ui-green)" />
              <span className="truncate">
                {b.panel.runningRound} · {runningRoom[0]}
              </span>
            </span>
            <Button
              className="min-h-7 shrink-0"
              onClick={() => void stopGroupThread(runningRoom[0], null, runningRoom[1].members)}
              size="sm"
              variant="ghost"
            >
              {b.panel.stopRound}
            </Button>
          </div>
        ) : null}
        {!reachable ? (
          <div
            className="mx-1.5 mb-1 rounded-lg border border-(--ui-icon-attention)/35 bg-(--ui-icon-attention)/8 px-2 py-2 text-11 leading-snug text-(--ui-text-secondary) shadow-2xs"
            data-slot="bot-unreachable"
            role="status"
          >
            {b.panel.unreachable}
          </div>
        ) : null}
        <div
          className="mx-1.5 mb-1 rounded-lg border border-(--ui-stroke-tertiary) px-2 py-2 shadow-2xs transition-colors hover:border-(--ui-stroke-secondary) hover:bg-(--chrome-action-hover)"
          data-slot="bot-goal"
        >
          {editingGoal ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={event => {
                event.preventDefault()
                commitGoal()
              }}
            >
              <input
                aria-label={b.panel.goalInput}
                className="h-7 min-w-0 flex-1 rounded-md border border-(--ui-stroke-tertiary) bg-transparent px-2 text-xs outline-none transition-colors focus-visible:border-(--dt-ring) focus-visible:ring-1 focus-visible:ring-(--dt-ring)"
                onChange={event => setGoalDraft(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setEditingGoal(false)
                    setGoalDraft('')
                  }
                }}
                placeholder={goal || b.panel.goalPlaceholder}
                ref={goalInput}
                value={goalDraft}
              />
              <Button
                className="min-h-7"
                disabled={!goalDraft.trim() || goalDraft.trim() === goal}
                size="sm"
                type="submit"
                variant="secondary"
              >
                {b.panel.goalSet}
              </Button>
            </form>
          ) : (
            <div className="group flex min-h-7 items-center gap-1">
              <span className="max-h-16 min-w-0 flex-1 overflow-hidden text-xs leading-relaxed text-(--ui-text-secondary)">
                {goal || <span className="text-(--ui-text-secondary)">{b.panel.goalEmpty}</span>}
              </span>
              {owner ? (
                <Button
                  aria-label={b.panel.goalEdit}
                  className="min-h-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => {
                    setGoalDraft(goal)
                    setEditingGoal(true)
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Codicon name="edit" size="0.6875rem" />
                </Button>
              ) : null}
            </div>
          )}
        </div>
        {feed.length ? (
          <div
            className="mx-1.5 mb-1 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-surface-overlay)/50 px-2 py-2 shadow-2xs"
            data-slot="bot-live-activity"
          >
            <div className="px-1 pb-1 text-10 font-semibold uppercase tracking-wider text-(--ui-text-secondary)">
              {b.panel.liveActivity}
            </div>
            <ul className="grid gap-0.5">
              {feed.slice(0, 6).map((event, i) => (
                <li
                  className="flex min-w-0 items-center gap-2 px-1 py-1 text-11"
                  key={`${event.group}:${event.at}:${i}`}
                >
                  <Codicon
                    className={
                      event.kind === 'failed'
                        ? 'shrink-0 text-destructive'
                        : event.kind === 'stopped' || event.kind === 'cancelled'
                          ? 'shrink-0 text-(--ui-icon-attention)'
                          : 'shrink-0 text-(--ui-text-secondary)'
                    }
                    name={event.kind === 'failed' ? 'error' : event.kind === 'queued' ? 'watch' : 'check'}
                    size="0.8125rem"
                  />
                  <span className="min-w-0 flex-1 truncate text-(--ui-text-secondary)">
                    <span className="font-medium text-(--ui-text-primary)">@{event.member || '—'}</span> {event.kind}
                    {(event as { count?: number }).count && (event as { count?: number }).count! > 1
                      ? ` ×${(event as { count?: number }).count}`
                      : ''}
                    {(event as { reason?: string }).reason ? ` — ${(event as { reason?: string }).reason}` : ''}
                  </span>
                  <span className="shrink-0 text-10 tabular-nums text-(--ui-text-secondary)">
                    {relativeTime(event.at || 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {view === 'tasks' ? (
          <SessionActivityPanel
            bot={bot}
            jobs={jobs}
            onOpenScheduled={() => setView('scheduled')}
            onRetrySessions={() => void sessionsQuery.refetch()}
            owner={owner}
            sessions={(sessionsQuery.data || []) as PanelSessionSource[]}
            sessionsError={Boolean(sessionsQuery.error)}
            sessionsLoading={sessionsQuery.isLoading}
          />
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
              <div className="mx-1.5 mt-1 rounded-md bg-(--chrome-action-hover) px-2 py-1.5 text-11 text-(--ui-text-secondary)">
                {staleNotice}
              </div>
            ) : null}
            {isLoading && !jobsView.all.length ? (
              <div aria-busy="true" className="grid flex-1 content-start gap-2 px-2 py-2" data-slot="bot-panel-loading">
                <div aria-hidden="true" className="h-8 animate-pulse rounded-md bg-(--ui-control-active-background)" />
                <div aria-hidden="true" className="h-8 animate-pulse rounded-md bg-(--ui-control-active-background)" />
                <div
                  aria-hidden="true"
                  className="h-8 w-3/4 animate-pulse rounded-md bg-(--ui-control-active-background)"
                />
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
                  <RoutineRow
                    job={job}
                    key={job.job_id}
                    onOpen={opened => setDetailJobId(opened.job_id)}
                    owner={owner}
                  />
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
            {sessionRuns.length ? (
              // Every listed conversation, not just the newest one. The
              // timeline above already knows about all of them, so a History
              // tab that showed exactly one row was the panel disagreeing with
              // itself — and the one row was the row you could already reach
              // from the footer's "Open chat".
              <div className="grid gap-0.5">
                {sessionRuns.map(run => (
                  <button
                    className="flex min-w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)"
                    key={run.id}
                    onClick={() => openSessionRow(run)}
                    type="button"
                  >
                    <Codicon className="shrink-0 text-(--ui-text-secondary)" name="history" size="0.9375rem" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-(--ui-text-primary)">{run.title}</span>
                      {run.detail ? (
                        <span className="block truncate text-10 text-(--ui-text-secondary)">{run.detail}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-10 tabular-nums text-(--ui-text-secondary)">
                      {relativeTime(run.at)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <PanelEmpty description={p.noHistory} icon="history" title={p.history} />
            )}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-(--ui-stroke-tertiary) px-3 py-2">
        {/* A bare "now" is not a fact: it names no subject and reads as a
            control. The footer says what is fresh. */}
        <span className="truncate text-11 text-(--ui-text-secondary)">
          {dataUpdatedAt ? p.updatedAt(relativeTime(dataUpdatedAt)) : p.updatedNow}
        </span>
        {/* The actions keep their width; the timestamp is the text that
            truncates. Without shrink-0 the buttons compressed first, so the
            footer read "Open chat …" — a label clipped by its own row. */}
        <div className="flex shrink-0 items-center gap-1">
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
      {owner ? <EditProfileDialog bot={editing} onClose={() => setEditing(null)} open={Boolean(editing)} /> : null}
    </div>
  )
}
