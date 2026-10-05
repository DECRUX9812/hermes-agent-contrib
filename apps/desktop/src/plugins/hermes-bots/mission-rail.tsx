/**
 * G1 — the mission rail: the context rail of the bot workspace triptych
 * (roster rail | bot chat | this rail), laid out like a teammate's profile:
 * a hero (face with its live mood, name, what it is doing right now) over
 * four tabs — Activity (the chat read as tasks, activity-feed.tsx),
 * Approvals (what it is waiting on you for, plus its ask rules), Scheduled
 * (task log + routines) and Bot (reach, sessions, computer, deliverables).
 * The open tab persists under `mission-rail-tab-v1`; collapsible sections
 * inside a tab keep their fold under `mission-rail-v1`. Folding the rail
 * itself is the pane's own collapse (the vertical tab), which returns the
 * classic chat width.
 */

import {
  AskRulesCard,
  Button,
  cn,
  Codicon,
  GlyphSpinner,
  host,
  PanelEmpty,
  ReachCard,
  Tip,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import { type ReactNode, useState } from 'react'

import { BotActivityFeed } from './activity-feed'
import { activityNow } from './activity-format'
import { AUTOPILOT_ICONS, autopilotPresets, type RoutinePreset } from './autopilot'
import { useAutopilotText } from './autopilot-i18n'
import { avatarColor, botAppearance, BotFace } from './avatar'
import { BotCardMeta } from './bot-card-meta'
import { BotDeliverablesSection } from './bot-deliverables'
import { BotSessionDeck } from './bot-session-deck'
import { $focusedBotOwner, $selectedBot, focusedRosterOwner } from './bot-state'
import { BotTaskLog } from './bot-task-log'
import { BotTopicProjectMenu } from './bot-topic-project-menu'
import {
  $lastJobs,
  CreateRoutineDialog,
  resolveRoutineOwner,
  routineCreateTarget,
  RoutineDetailDialog,
  routineFilterHint,
  RoutineRow,
  selectRoutineJobs,
  useRoutines
} from './cron'
import { $botMeta, $lastRoster, botHandle, newBotChat } from './data'
import { EditProfileDialog } from './edit-profile-dialog'
import { useBots } from './i18n'
import { botRole, displayName } from './labels'
import { botLiveStatusLabel, useBotLiveStatus } from './live-status'
import {
  $railCollapsed,
  $railTab,
  RAIL_TAB_IDS,
  type RailSectionId,
  type RailTabId,
  setRailSectionCollapsed,
  setRailTab
} from './rail-state'
import { openRosterBot } from './roster-actions'
import { botRosterMeta } from './routing'
import { BotComputerPanel } from './screen-panel'
import { ShareBotDialog } from './share-dialog'
import { useShareText } from './share-i18n'
import type { RosterRow } from './types'

/** One collapsible rail section: the slim header row carries the fold
 *  affordance (+ an optional trailing action) and is all that remains when
 *  the section is folded away. */
function RailSection({
  action,
  children,
  id,
  title
}: {
  action?: ReactNode
  children: ReactNode
  id: RailSectionId
  title: string
}) {
  const collapsed = Boolean(useValue($railCollapsed)[id])

  return (
    <section className="border-t border-(--ui-stroke-secondary)" data-testid={`rail-section:${id}`}>
      <div className="flex items-center">
        <button
          aria-expanded={!collapsed}
          aria-label={title}
          className="flex min-w-0 flex-1 items-center gap-1 px-2.5 py-1.5 text-left transition-colors hover:bg-(--chrome-action-hover)"
          onClick={() => setRailSectionCollapsed(id, !collapsed)}
          type="button"
        >
          <Codicon className="text-(--ui-text-quaternary)" name={collapsed ? 'chevron-right' : 'chevron-down'} />
          <span className="truncate ui-section-label">{title}</span>
        </button>
        {action && !collapsed ? <span className="shrink-0 px-1">{action}</span> : null}
      </div>
      {collapsed ? null : children}
    </section>
  )
}

const WORKING_KINDS = new Set(['working', 'routine', 'group', 'background', 'delegated'])

/** The rail's hero: the bot's face (its mood follows the work), name, and a
 *  live line saying what it is doing right now — the running step when its
 *  chat is mid-turn, else the roster's live status. Then the two things you
 *  do with a teammate (message it, hand it a project) and quiet icons. */
function BotHero({
  bot,
  meta,
  onEdit
}: {
  bot: RosterRow
  meta?: Parameters<typeof botAppearance>[1]
  onEdit: () => void
}) {
  const b = useBots()
  const live = useBotLiveStatus(bot)
  const tasks = useValue(host.state.focusedActivity)
  const now = activityNow(tasks, b.activity)
  const { shape, color, image } = botAppearance(bot.name, meta)
  const name = displayName({ name: bot.name }, meta)
  const handle = botHandle(bot.name, bot)
  const subtitle = botRole(bot, meta)
  const where = bot.connectionLabel || (bot.connectionId && bot.connectionId !== 'local' ? '' : b.bot.thisDevice)
  const tone = now ? 'working' : (LIVE_TONE[live.kind] ?? 'idle')
  const inFlight = tasks.at(-1)?.steps.some(step => step.action.status === 'running')
  const mood = now ? (inFlight ? 'work' : 'think') : WORKING_KINDS.has(live.kind) ? 'work' : 'idle'
  const share = useShareText()
  const [sharing, setSharing] = useState(false)

  return (
    <div className="flex flex-col items-center px-4 pb-4 pt-5 text-center" data-testid="rail-profile-card">
      <div className="relative">
        <BotFace
          color={avatarColor(color, bot.name)}
          image={image}
          mood={mood}
          name={bot.name}
          shape={shape}
          size={84}
        />
        <Tip label={b.bot.editTitle}>
          <Button
            aria-label={b.bot.editTitle}
            className="absolute -bottom-0.5 -right-0.5 size-7 rounded-full border border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) shadow-sm hover:bg-(--chrome-action-hover)"
            onClick={onEdit}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="edit" size="0.8rem" />
          </Button>
        </Tip>
      </div>
      <h2 className="mt-3 max-w-full truncate text-lg font-semibold leading-tight text-foreground">{name}</h2>
      <p
        className={cn(
          'mt-1 flex max-w-full items-center gap-1.5 text-[0.8125rem]',
          tone === 'waiting' ? 'text-amber-700 dark:text-amber-300' : 'text-(--ui-text-tertiary)'
        )}
        data-testid="rail-live-line"
        data-tone={tone}
      >
        {tone === 'working' ? (
          <GlyphSpinner className="shrink-0 text-[0.85rem] text-(--ui-accent)" spinner="breathe" />
        ) : (
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              tone === 'waiting' ? 'bg-current' : 'bg-(--ui-text-quaternary)'
            )}
          />
        )}
        <span className="truncate">{now ?? botLiveStatusLabel(live, b.roster)}</span>
      </p>
      <p className="mt-0.5 max-w-full truncate text-[0.6875rem] text-(--ui-text-quaternary)">
        {[subtitle, where, name.trim().toLowerCase() !== handle.toLowerCase() ? `@${handle}` : '']
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
        <Button onClick={() => void newBotChat(bot)} size="xs">
          <Codicon name="comment-add" />
          {b.bot.newTopic}
        </Button>
        <BotTopicProjectMenu bot={bot} />
        <Tip label={b.bot.inbox}>
          <Button aria-label={b.bot.inbox} onClick={() => void openRosterBot(bot)} size="icon-xs" variant="ghost">
            <Codicon name="inbox" />
          </Button>
        </Tip>
        <Tip label={share.title(name)}>
          <Button aria-label={share.title(name)} onClick={() => setSharing(true)} size="icon-xs" variant="ghost">
            <Codicon name="share" />
          </Button>
        </Tip>
        <ShareBotDialog bot={bot} meta={meta ?? null} onOpenChange={setSharing} open={sharing} />
      </div>
    </div>
  )
}

const TAB_ICONS: Record<RailTabId, string> = {
  activity: 'list-unordered',
  approvals: 'shield',
  scheduled: 'history',
  bot: 'hubot'
}

/** Icon tabs in one pill track; the open tab lifts out of it. */
function RailTabs({
  badges,
  onChange,
  value
}: {
  badges: Partial<Record<RailTabId, number>>
  onChange: (id: RailTabId) => void
  value: RailTabId
}) {
  const a = useBots().activity

  return (
    <div
      aria-label={useBots().rail.title}
      className="mx-3 grid grid-cols-4 gap-0.5 rounded-full bg-(--ui-inline-code-background) p-1"
      role="tablist"
    >
      {RAIL_TAB_IDS.map(id => {
        const active = id === value
        const badge = badges[id] ?? 0

        return (
          <Tip key={id} label={a.tabs[id]}>
            <button
              aria-controls={`rail-panel-${id}`}
              aria-label={badge ? `${a.tabs[id]} (${badge})` : a.tabs[id]}
              aria-selected={active}
              className={cn(
                'relative grid h-8 place-items-center rounded-full transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)/40',
                active
                  ? 'bg-(--ui-chat-bubble-background) text-foreground shadow-sm ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10'
                  : 'text-(--ui-text-tertiary) hover:text-foreground'
              )}
              data-testid={`rail-tab:${id}`}
              id={`rail-tab-${id}`}
              onClick={() => onChange(id)}
              role="tab"
              type="button"
            >
              <Codicon name={TAB_ICONS[id]} size="0.95rem" />
              {badge ? (
                <span className="absolute right-[calc(50%-1.05rem)] top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-amber-500 px-1 text-[0.5625rem] font-semibold leading-none text-white">
                  {badge > 9 ? '9+' : badge}
                </span>
              ) : null}
            </button>
          </Tip>
        )
      })}
    </div>
  )
}

const ATTENTION_ICONS: Record<string, string> = {
  approval: 'shield',
  clarify: 'question',
  error: 'error',
  secret: 'key',
  sudo: 'lock',
  vaultCode: 'lock',
  vaultSave: 'lock',
  vaultUnlock: 'lock'
}

/** What the bot's chat is parked on, waiting for you, and the rules that
 *  decide what it asks about. Answering happens where it always has (the
 *  chat's own prompt, or the inbox); this tab is where you see it. */
function ApprovalsPanel({ bot, name }: { bot: RosterRow; name: string }) {
  const b = useBots()
  const a = b.activity
  const items = useValue(host.state.attentionItems)
  const sessionId = useValue(host.state.focusedSessionId)
  const mine = sessionId ? items.filter(item => item.sessionId === sessionId) : []

  return (
    <div className="grid gap-3 px-3 pb-3 pt-1">
      {mine.length ? (
        <ul className="grid gap-1.5" data-testid="rail-approvals">
          {mine.map(item => (
            <li className="flex gap-2.5 rounded-xl bg-amber-500/8 px-2.5 py-2" key={item.id}>
              <Codicon
                className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"
                name={ATTENTION_ICONS[item.kind] ?? 'bell'}
                size="0.95rem"
              />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[0.8125rem] font-medium leading-snug text-foreground [overflow-wrap:anywhere]">
                  {item.title}
                </span>
                {item.detail ? (
                  <span className="line-clamp-2 text-[0.75rem] text-(--ui-text-tertiary)">{item.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid gap-1 px-1 py-4 text-center">
          <Codicon className="mx-auto text-(--ui-text-quaternary)" name="shield" size="1.2rem" />
          <div className="text-[0.8125rem] font-medium text-(--ui-text-secondary)">{a.approvalsEmpty}</div>
          <div className="text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">{a.approvalsBody}</div>
        </div>
      )}
      {typeof host.navigate === 'function' ? (
        <Button className="justify-self-center" onClick={() => host.navigate('/inbox')} size="xs" variant="ghost">
          <Codicon name="inbox" />
          {a.openInbox}
        </Button>
      ) : null}
      {!bot.remoteSource && <AskRulesCard name={name} profile={bot.name} />}
    </div>
  )
}

/** "Put <bot> on autopilot": presets that prefill the routine dialog. A
 *  preset whose title already names one of the bot's routines is hidden. */
function AutopilotChips({
  name,
  onCustom,
  onPick,
  taken
}: {
  name: string
  /** Offered when this card stands in for the empty state. */
  onCustom?: () => void
  onPick: (preset: RoutinePreset) => void
  taken: string[]
}) {
  const a = useAutopilotText()
  const presets = autopilotPresets(a).filter(({ label }) => !taken.some(title => title.endsWith(label)))

  if (!presets.length) {
    return null
  }

  return (
    <div className="mx-2.5 mb-2 mt-1 rounded-xl bg-(--ui-widget-surface-background) p-2.5" data-slot="autopilot">
      <p className="text-[0.75rem] font-medium text-foreground">{a.heading(name)}</p>
      <p className="mb-2 text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">{a.hint}</p>
      <div className="flex flex-wrap gap-1">
        {presets.map(({ id, label, preset }) => (
          <Button key={id} onClick={() => onPick(preset)} size="xs" variant="secondary">
            <Codicon name={AUTOPILOT_ICONS[id]} />
            {label}
          </Button>
        ))}
        {onCustom && (
          <Button onClick={onCustom} size="xs" variant="ghost">
            <Codicon name="add" />
            {a.custom}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Badge tone per live-status kind: working (accent), waiting on you
 *  (amber), everything else quiet. */
const LIVE_TONE: Partial<Record<ReturnType<typeof useBotLiveStatus>['kind'], 'idle' | 'waiting' | 'working'>> = {
  'needs-input': 'waiting',
  stalled: 'waiting',
  working: 'working',
  routine: 'working',
  group: 'working',
  background: 'working',
  delegated: 'working'
}

/** The rail's content for the bot the workspace currently belongs to —
 *  same owner-resolution ladder the pane always used (exact roster row or
 *  fail closed). */
export function MissionRail() {
  const selected = useValue($selectedBot)
  const focusedOwner = focusedRosterOwner(useValue($focusedBotOwner))
  // Subscribe instead of a bare read: BotsPane owns the roster fetch and
  // can hydrate (or replace) rows after this rail mounted, so a .get()
  // snapshot captured while the roster was still empty pinned the pane on
  // "unavailable" until some unrelated atom happened to re-render it (#94483).
  const owner = resolveRoutineOwner(useValue($lastRoster), focusedOwner, selected)
  const bot = String(owner?.name || focusedOwner?.name || 'default').trim() || 'default'
  const allMeta = useValue($botMeta)
  const meta = owner ? botRosterMeta(owner, allMeta) : null
  const { data, error, isLoading, refetch } = useRoutines(owner)
  const b = useBots()
  const { t } = useI18n()
  const c = t.cron
  const [createOpen, setCreateOpen] = useState(false)
  const [createOwner, setCreateOwner] = useState<RosterRow | null>(null)
  // Hold the id, not the record: the 20s poll replaces every job object, and
  // an open inspector must follow the live row (next run, pause, last error)
  // instead of freezing the snapshot that was on screen when it opened.
  const [detailJobId, setDetailJobId] = useState<null | string>(null)
  const [editing, setEditing] = useState(false)
  const tab = useValue($railTab)
  const attention = useValue(host.state.attentionItems)
  const focusedSessionId = useValue(host.state.focusedSessionId)
  const approvalCount = focusedSessionId ? attention.filter(item => item.sessionId === focusedSessionId).length : 0
  const createTarget = owner ? routineCreateTarget(createOwner, bot) : null

  const [preset, setPreset] = useState<null | RoutinePreset>(null)

  const openCreate = (seed: null | RoutinePreset = null) => {
    if (!owner) {
      return
    }

    setPreset(seed)
    setCreateOwner(owner)
    setCreateOpen(true)
  }

  if (!owner) {
    return <PanelEmpty description={b.cron.needsRosterFirst} icon="hubot" title={b.rail.title} />
  }

  const view = selectRoutineJobs(data, error, $lastJobs.get(), bot)

  if (view.live) {
    $lastJobs.set(view.live)
  }

  const jobs = view.jobs
  const detailJob = detailJobId ? jobs.find(job => job.job_id === detailJobId) || null : null

  const staleNotice = error && !view.live && view.all.length ? b.cron.staleNotice : null

  const filterHint = routineFilterHint(view.all, jobs)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
      <BotHero bot={owner} meta={meta} onEdit={() => setEditing(true)} />
      <RailTabs badges={{ approvals: approvalCount }} onChange={setRailTab} value={tab} />
      <div
        aria-labelledby={`rail-tab-${tab}`}
        className="mt-3 min-h-0"
        data-testid={`rail-panel:${tab}`}
        id={`rail-panel-${tab}`}
        role="tabpanel"
      >
        {tab === 'activity' ? <BotActivityFeed name={displayName(owner, meta)} /> : null}
        {tab === 'approvals' ? <ApprovalsPanel bot={owner} name={displayName(owner, meta)} /> : null}
        {tab === 'scheduled' ? (
          <>
            <RailSection id="tasks" title={b.rail.tasks}>
              <BotTaskLog jobs={jobs} onOpenRoutine={setDetailJobId} owner={owner} />
            </RailSection>
            <RailSection
              action={
                <Tip label={c.newCron}>
                  <Button aria-label={c.newCron} onClick={() => openCreate()} size="icon-xs" variant="ghost">
                    <Codicon name="add" />
                  </Button>
                </Tip>
              }
              id="routines"
              title={c.title}
            >
              {staleNotice ? (
                <div className="mx-3 mb-1 rounded-md bg-(--chrome-action-hover) px-2 py-1.5 text-[0.6875rem] text-(--ui-text-tertiary)">
                  {staleNotice}
                </div>
              ) : null}
              {isLoading && !view.all.length ? (
                <div className="flex items-center justify-center py-4">
                  <GlyphSpinner className="text-(--ui-text-tertiary)" spinner="breathe" />
                </div>
              ) : error && !view.all.length ? (
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
              ) : jobs.length === 0 && !filterHint ? (
                // Nothing scheduled and nothing hidden by the filter: the autopilot
                // card below IS the empty state, with a way to write one from scratch.
                <AutopilotChips
                  name={displayName(owner, meta)}
                  onCustom={() => openCreate()}
                  onPick={openCreate}
                  taken={[]}
                />
              ) : jobs.length === 0 ? (
                // `filterHint` is the informative case (jobs exist on the profile but
                // none are tagged for this bot), so it wins the description slot.
                <PanelEmpty
                  action={
                    <Button onClick={() => openCreate()} size="sm">
                      {c.newCron}
                    </Button>
                  }
                  description={filterHint || c.emptyDescNew}
                  icon="watch"
                  title={c.emptyTitleNew}
                />
              ) : (
                <div className="grid gap-1.5 px-2.5 pb-2 pt-1">
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
              {!isLoading && !error && jobs.length > 0 && (
                <AutopilotChips
                  name={displayName(owner, meta)}
                  onPick={openCreate}
                  taken={jobs.map(job => String(job.name || ''))}
                />
              )}
            </RailSection>
          </>
        ) : null}
        {tab === 'bot' ? (
          <>
            <BotCardMeta bot={owner} />
            {/* Every bot, an address: its own Telegram/Slack link as a QR, or the
                one step that gives it one. Remote-source bots have no platforms on
                this backend (same rule as the menu's "Continue on phone"). */}
            {!owner.remoteSource && (
              <ReachCard
                className="mx-3 mb-3"
                name={displayName(owner, meta)}
                onManage={
                  typeof host.navigate === 'function'
                    ? () => host.navigate(`/messaging?profile=${encodeURIComponent(owner.name)}`)
                    : undefined
                }
                profile={owner.name}
              />
            )}
            {/* The session deck and deliverables own their section headers
                (title + count + refresh), so they sit outside RailSection. */}
            <div className="border-t border-(--ui-stroke-secondary)">
              <BotSessionDeck owner={owner} />
            </div>
            <RailSection id="computer" title={b.screen.panelTitle}>
              <div className="px-3 pb-2 pt-1">
                <BotComputerPanel bot={owner} meta={meta} />
              </div>
            </RailSection>
            <div className="border-t border-(--ui-stroke-secondary)">
              <BotDeliverablesSection owner={owner} />
            </div>
          </>
        ) : null}
      </div>
      <RoutineDetailDialog
        job={detailJob}
        onClose={() => setDetailJobId(null)}
        open={Boolean(detailJob)}
        owner={owner}
      />
      <CreateRoutineDialog
        // Non-null past the `!owner` early return above: `routineCreateTarget`
        // falls back to the active profile name.
        bot={createTarget!}
        // TODO(bot-mode-types): `createTarget` is a roster row whenever a create
        // owner is set, so this key stringifies to "[object Object]" instead of
        // identifying the target bot. Cast to keep the as-written behavior.
        key={createTarget as string}
        onClose={() => {
          setCreateOpen(false)
          setCreateOwner(null)
          setPreset(null)
        }}
        open={createOpen}
        preset={preset}
      />
      <EditProfileDialog bot={editing ? owner : null} onClose={() => setEditing(false)} open={editing} />
    </div>
  )
}
