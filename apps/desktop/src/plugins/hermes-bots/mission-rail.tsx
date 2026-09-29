/**
 * G1 — the mission rail: the context rail of the bot workspace triptych
 * (roster rail | bot chat | this rail). One rail section per concern —
 * profile card on top, then the dated task log (G8), the bot's computer
 * (F2's BotComputerPanel) above Routines, deliverables at the foot. Every
 * collapsible section persists its fold under `mission-rail-v1`; folding
 * the rail itself is the pane's own collapse (the vertical tab), which
 * returns the classic chat width.
 *
 * Section slots are additive — a future F1 'Sessions' deck drops in as one
 * RailSection here plus one id in RAIL_SECTION_IDS.
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

import { avatarColor, botAppearance, BotFace } from './avatar'
import { BotDeliverablesSection } from './bot-deliverables'
import { BotSessionDeck } from './bot-session-deck'
import { $focusedBotOwner, $selectedBot, focusedRosterOwner } from './bot-state'
import { BotTaskLog } from './bot-task-log'
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
import { $botMeta, $lastRoster, botHandle } from './data'
import { EditProfileDialog } from './edit-profile-dialog'
import { useBots } from './i18n'
import { botRole, displayName } from './labels'
import { botLiveStatusLabel, useBotLiveStatus } from './live-status'
import { NewTaskButton } from './new-task'
import { $railCollapsed, type RailSectionId, setRailSectionCollapsed } from './rail-state'
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

/** The rail's top card (revamp "teammate" header): face, name, a state badge
 *  in the live-status tone, what it is and where it lives, then the two things
 *  you do with a teammate — message it, or hand it a task — with edit/export
 *  as quiet icons. */
function BotProfileCard({
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
  const { shape, color, image } = botAppearance(bot.name, meta)
  const name = displayName({ name: bot.name }, meta)
  const handle = botHandle(bot.name, bot)
  // G3 persona role one-liner; falls back to the description's first
  // sentence, empty when nothing says what the bot is for.
  const subtitle = botRole(bot, meta)
  const where = bot.connectionLabel || (bot.connectionId && bot.connectionId !== 'local' ? '' : b.bot.thisDevice)
  const tone = LIVE_TONE[live.kind] ?? 'idle'
  const share = useShareText()
  const [sharing, setSharing] = useState(false)

  return (
    <div className="px-3 pt-3 pb-3" data-testid="rail-profile-card">
      <div className="flex items-center gap-2.5">
        <BotFace color={avatarColor(color, bot.name)} image={image} name={bot.name} shape={shape} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-foreground">{name}</span>
            <span
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[0.625rem] font-medium',
                tone === 'working' && 'bg-(--ui-accent)/12 text-(--ui-accent)',
                tone === 'waiting' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                tone === 'idle' && 'bg-(--ui-inline-code-background) text-(--ui-text-tertiary)'
              )}
              data-tone={tone}
            >
              {tone !== 'idle' ? <span className="size-1.5 rounded-full bg-current" /> : null}
              {botLiveStatusLabel(live, b.roster)}
            </span>
          </div>
          <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">
            {[subtitle, where, name.trim().toLowerCase() !== handle.toLowerCase() ? `@${handle}` : '']
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="flex shrink-0 items-center self-start">
          <Tip label={b.bot.editTitle}>
            <Button aria-label={b.bot.editTitle} onClick={onEdit} size="icon-xs" variant="ghost">
              <Codicon name="edit" />
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
      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        <Button onClick={() => void openRosterBot(bot)} size="xs">
          <Codicon name="comment" />
          {b.roster.openChat}
        </Button>
        <NewTaskButton bot={bot} labeled />
      </div>
      {/* Every bot, an address: its own Telegram/Slack link as a QR, or the
          one step that gives it one. Remote-source bots have no platforms on
          this backend (same rule as the menu's "Continue on phone"). */}
      {!bot.remoteSource && (
        <ReachCard
          className="mt-3"
          name={name}
          onManage={
            typeof host.navigate === 'function'
              ? () => host.navigate(`/messaging?profile=${encodeURIComponent(bot.name)}`)
              : undefined
          }
          profile={bot.name}
        />
      )}
      {!bot.remoteSource && <AskRulesCard className="mt-2" name={name} profile={bot.name} />}
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
  const createTarget = owner ? routineCreateTarget(createOwner, bot) : null

  const openCreate = () => {
    if (!owner) {
      return
    }

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
      <BotProfileCard bot={owner} meta={meta} onEdit={() => setEditing(true)} />
      <RailSection id="tasks" title={b.rail.tasks}>
        <BotTaskLog jobs={jobs} onOpenRoutine={setDetailJobId} owner={owner} />
      </RailSection>
      {/* F1's session deck owns its own section header (title + count +
          refresh/new-chat live in its RosterSectionHeader) and fold state —
          like the deliverables section it sits outside the RailSection
          chrome rather than double-headering. */}
      <div className="border-t border-(--ui-stroke-secondary)">
        <BotSessionDeck owner={owner} />
      </div>
      <RailSection id="computer" title={b.screen.panelTitle}>
        <div className="px-3 pb-2 pt-1">
          <BotComputerPanel bot={owner} meta={meta} />
        </div>
      </RailSection>
      <RailSection
        action={
          <Tip label={c.newCron}>
            <Button aria-label={c.newCron} onClick={openCreate} size="icon-xs" variant="ghost">
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
        ) : jobs.length === 0 ? (
          // `filterHint` is the informative case (jobs exist on the profile but
          // none are tagged for this bot), so it wins the description slot.
          <PanelEmpty
            action={
              <Button onClick={openCreate} size="sm">
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
              <RoutineRow job={job} key={job.job_id} onOpen={opened => setDetailJobId(opened.job_id)} owner={owner} />
            ))}
          </div>
        )}
      </RailSection>
      {/* Deliverables keeps its own header row (count + refresh live in it),
          so it isn't folded into a RailSection — RailSection headers exist to
          carry the collapse affordance. */}
      <div className="border-t border-(--ui-stroke-secondary)">
        <BotDeliverablesSection owner={owner} />
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
        }}
        open={createOpen}
      />
      <EditProfileDialog bot={editing ? owner : null} onClose={() => setEditing(false)} open={editing} />
    </div>
  )
}
