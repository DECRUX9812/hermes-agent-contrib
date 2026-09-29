/**
 * The two rows the Bots rail lists: one bot, and one group chat.
 *
 * Rows only. Both take their bot or room and their context-menu callbacks as
 * props and own no roster state, so the pane above them decides what to list
 * and the row decides only how it reads.
 */

import {
  $watchedSessionKeys,
  Badge,
  cn,
  Codicon,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  GlyphSpinner,
  haptic,
  host,
  isWatchedSessionId,
  RowButton,
  SessionStatusDot,
  Tip,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'

import { botAccentColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { BotRowMenu } from './bot-menu'
import { $botChatFocused, $focusedBotOwner, $pendingBotOpen, $selectedRosterKey, focusedRosterOwner } from './bot-state'
import { $botMeta, botActivitySession, botAttentionHint, botHandle, botRosterKey, botSourceStatus } from './data'
import { $groupChats, $groupChatWorkspace, groupChatRoomKey } from './group-chat'
import { groupLastActivity } from './group-membership'
import { toggleGroupChatPinned } from './group-pin'
import { $activeGroupMemberKeys } from './group-presence'
import { $groupReadAt, groupLastRoundSummary, groupUnreadCount } from './group-unread'
import { isBotHidden, isBotPinned } from './hidden-bots'
import { useBots } from './i18n'
import { botRole, displayName, stripPreviewMarkdown } from './labels'
import { botLiveStatusLabel, useBotAttention, useBotHealth, useBotLiveStatus } from './live-status'
import { $relayInflight, relayLaneKey } from './relay'
import { openRosterBot } from './roster-actions'
import { botRosterMeta } from './routing'
import {
  A2A_PREFIX_RE,
  botCanonicalSessionId,
  botRowOwnsWorkspace,
  botWorkingMood,
  previewKind,
  rosterRowAge,
  useTurnBusy,
  warmRosterBot,
  workerActiveAt
} from './row-helpers'
import { stopBotTurn } from './run-controls'
import type { GroupMember, RosterRow } from './types'
import {
  $botSections,
  $draggingBot,
  BOT_DRAG_MIME,
  groupChatSectionId,
  groupDragKey,
  moveGroupChatsToSection
} from './user-sections'

// ── bot row ──────────────────────────────────────────────────────────────────

interface BotRowProps {
  bot: RosterRow
  /** "Assign task…" — opens the mailbox compose dialog (#48). */
  onAssignTask?: (bot: RosterRow) => void
  onDelete: (bot: RosterRow) => void
  onEdit: (bot: RosterRow) => void
  onGroup: (bot: RosterRow) => void
  /** Opens the New section dialog; the bot is filed into it on create. */
  onNewSection: (bot: RosterRow) => void
  /** Open mailbox notes addressed to this bot — the row's task badge. */
  openTasks?: number
  showHandle?: boolean
}

export function BotRow({
  bot,
  onAssignTask,
  onDelete,
  onEdit,
  onGroup,
  onNewSection,
  openTasks,
  showHandle
}: BotRowProps) {
  const { t } = useI18n()
  const b = useBots()
  const focusedOwner = focusedRosterOwner(useValue($focusedBotOwner))
  const selectedRosterKey = useValue($selectedRosterKey)
  const pendingOpenKey = useValue($pendingBotOpen)?.key
  const isOpening = pendingOpenKey === botRosterKey(bot)
  const botChatFocused = useValue($botChatFocused)
  const activeGroup = useValue($groupChatWorkspace)
  const allMeta = useValue($botMeta)
  const meta = botRosterMeta(bot, allMeta)
  const hidden = isBotHidden(bot, allMeta)
  const pinned = isBotPinned(bot, allMeta)
  const sourceStatus = botSourceStatus(bot)
  const last = bot.last_session
  // Highlight follows the chat on screen (focused session's owner), not the
  // gateway socket's home — a focused tab doesn't swap the socket, and on the
  // old keying the wrong bot stayed highlighted while you read another's chat.
  // A selected group chat suppresses every bot-row highlight: the group row
  // owns the selection then (#88979).
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()
  // The highlight follows whoever owns the MAIN workspace. While a chat owns
  // it, that chat's profile wins (a stale roster click must not key the
  // highlight to a bot you are not reading). With no focused chat, the
  // source-qualified selection is the owner — and it is the only rule that
  // can highlight a remote row, which has no focusable local chat.
  const isActive = botRowOwnsWorkspace(bot, activeGroup, botChatFocused, focusedOwner, selectedRosterKey)

  const { shape, color, image } = botAppearance(bot.name, meta)
  // Keep user photos/pets. Drop the 160px SVG backfill so the math face can move.
  const photo = Boolean(image && !isBackfilledFacePng(image))
  const turnBusy = useTurnBusy()
  // Preview identity must match click identity (#88200): when the backend
  // resolved the pinned canonical chat, preview THAT session — not the
  // profile's most recent (but unrelated) activity. Activity signals
  // (age label, pulse dot) follow the same rule via botActivitySession:
  // the canonical Bot Chat is hidden from last_session, so keying age off
  // last_session alone shows "6d ago" on a bot you just messaged.
  const previewSession = bot.canonical_session || last
  const activitySession = botActivitySession(bot)
  // A live kanban/tool worker gates only the pulse/mood (#90268). The age is
  // the last time the bot did ANYTHING — chat or delegated worker run — so a
  // delegate-only specialist that ran all day no longer snaps back to "11d"
  // the moment the 150 s liveness window lapses (#105874). An absent
  // worker_session (past the gateway's 20-row window) degrades to chat age.
  const workerActive = workerActiveAt(bot)
  const rowAgeTs = Math.max(activitySession?.last_active || 0, bot.worker_session?.last_active || 0)

  const groupKeys = useValue($activeGroupMemberKeys)
  const botMood = botWorkingMood(bot, focusedOwner, turnBusy, activeConnectionId, Date.now(), groupKeys)
  // Status keys off the canonical Bot Chat — the very session this row opens,
  // so the dot and the click can never describe different conversations.
  const canonicalSessionId = botCanonicalSessionId(bot)
  // B5 — Watch: the row mirrors the session rail's watch strip, subscribed
  //  to the same keys atom so the eye paints the moment the chip strip (or
  //  this menu) flips it. Watched state keys off the canonical chat's stored
  //  id — the toggle itself resolves the durable pin id.
  const watchedMap = useValue($watchedSessionKeys)

  const watched = Boolean(
    canonicalSessionId &&
    watchedMap &&
    typeof isWatchedSessionId === 'function' &&
    isWatchedSessionId(canonicalSessionId)
  )

  // A2 — the attention rollup: inbox items + quiet unread/needs-input dots
  // counted under the bot's proven owner scope (never the ambient gateway —
  // a same-named bot on another connection inherits nothing), plus the
  // recorded failure flag whose reason still drives the tooltip.
  const attention = useBotAttention(bot)
  // A1 — the live status line: needs-input > live turn > routine > group >
  // background > delegated worker > honest floor. Built from signals that
  // expire (dot claims, job state, round keys, heartbeat) — never the clock.
  const live = useBotLiveStatus(bot)
  // E1 — the stop affordance keys off the same live-turn claim the status
  // line makes; the action resolves the canonical chat's runtime id at click
  // time (run-controls.stopBotTurn), never a remembered session pointer.
  const canStop = live.kind === 'working' || live.kind === 'stalled'
  // E2 — the health chip: unreachable source > recorded failure flag > a
  // failed work item on the canonical runtime. Renderer-side derivation over
  // existing atoms only.
  const health = useBotHealth(bot)
  // E3 — a delivery queued or in flight to this bot shows on the row tooltip.
  const inflight = useValue($relayInflight)

  const deliveryInflight = inflight.has(
    relayLaneKey(String(bot?.connectionId || activeConnectionId), String(bot?.name || 'default'))
  )

  const stopRun = () => {
    void stopBotTurn(bot).then(result => {
      if (result === 'failed') {
        host.notifyError?.(new Error('session.interrupt rejected'), b.roster.stopRunFailed)
      }
    })
  }

  // WHO sent the last message (bot-to-bot DM vs human) — the full stored
  // history lives in the canonical chat, not inline.
  // Preview identity must match click identity (#88200): when the backend
  // resolved the pinned canonical chat, preview THAT session — not the
  // profile's most recent (but unrelated) activity. Liveness checks above
  // keep last_session semantics: any recent activity means the bot is alive.
  const { fromBot } = previewKind(previewSession?.preview)

  // DM previews read like DMs: strip the delivery prefix, keep the message.
  const displayPreview = stripPreviewMarkdown(
    fromBot ? (previewSession?.preview || '').replace(A2A_PREFIX_RE, '').trim() || '…' : previewSession?.preview || ''
  )

  const handle = botHandle(bot.name, bot)
  const gatewayLabel = bot.connectionLabel || (bot.connectionId === 'local' ? b.bot.thisDevice : '')

  // The live claim outranks the preview — a stale message tail under an
  // actively working bot reads as frozen. 'Idle' only fills the line when
  // nothing else would render (the floor, not a permanent caption); an
  // unreachable source shows its preview, or nothing — never a guess.
  const liveText = live.kind === 'idle' || live.kind === 'unknown' ? null : botLiveStatusLabel(live, b.roster)

  const detailText = liveText || displayPreview || (live.kind === 'idle' ? b.roster.liveIdle : '')

  const liveTone = live.kind === 'needs-input' || live.kind === 'stalled' ? 'amber' : liveText ? 'live' : null

  const showDetailsRow = Boolean(showHandle || detailText || fromBot)

  // G3 — persona: role subtitle (explicit `meta.role` or the description's
  // first sentence) and the accent color = the avatar's own color —
  // deterministic from the name when unset, and the AvatarPicker's existing
  // color choice IS the override, so no second palette exists to drift.
  const role = botRole(bot, meta)
  const accent = botAccentColor(bot, meta)

  const rowTooltip = [
    displayName(bot, meta),
    `@${handle}`,
    gatewayLabel,
    sourceStatus.label,
    deliveryInflight ? b.roster.deliveryInFlight : ''
  ]
    .filter(Boolean)
    .join(' · ')

  // E2 — the chip's tooltip: the source label when unreachable, the flagged
  // reason's hint otherwise, with the generic "last run failed" fallback.
  const healthLabel =
    health.kind === 'unreachable'
      ? sourceStatus.label
      : health.detail === 'last_run_failed'
        ? b.roster.lastRunFailed
        : health.detail === 'stalled'
          ? b.roster.liveStalled
          : health.detail
            ? botAttentionHint(health.detail)
            : b.roster.needsAttention

  // Pointer-over pre-warm (see row-helpers.warmRosterBot): dials the bot's
  // own backend — its own source when source-scoped — before the click lands.
  const warm = () => warmRosterBot(bot)

  // Rows and Active Now share the exact-owner open path; only that path may
  // activate a source and resolve the canonical Bot Chat.
  const open = () => void openRosterBot(bot)

  // DRAG lives on the row button itself: it already takes pointer events, so
  // the click that opens the bot and the drag that files it are one element's
  // gestures. The drag carries the roster key under a private MIME type, so
  // only a section block can accept it.
  const rosterKey = botRosterKey(bot)
  const dragging = useValue($draggingBot) === rosterKey

  const row = (
    <RowButton
      aria-busy={isOpening || undefined}
      aria-label={rowTooltip}
      className={cn(
        'flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-2 text-left transition-colors',
        'hover:bg-(--chrome-action-hover)',
        isActive && 'bg-(--ui-row-active-background)',
        // The row being dragged fades in place; the browser's drag image is
        // the row itself, so the ghost under the pointer is the full row.
        dragging && 'opacity-40'
      )}
      data-roster-key={rosterKey}
      draggable
      onClick={open}
      onDragEnd={() => $draggingBot.set(null)}
      onDragStart={event => {
        event.dataTransfer.setData(BOT_DRAG_MIME, rosterKey)
        event.dataTransfer.effectAllowed = 'move'
        $draggingBot.set(rosterKey)
      }}
      onPointerEnter={warm}
    >
      <div
        className={cn('shrink-0 rounded-lg', !sourceStatus.available && 'grayscale opacity-60')}
        style={{ boxShadow: `0 0 0 1px ${accent}80` }}
      >
        <BotFace color={accent} image={photo ? image : null} mood={botMood} name={bot.name} shape={shape} size={34} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            {pinned ? (
              <Tip label={b.roster.pinned}>
                <Codicon className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)" name="pinned" />
              </Tip>
            ) : null}
            {hidden ? (
              <Tip label={b.roster.hiddenFromRoster}>
                <Codicon className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)" name="eye-closed" />
              </Tip>
            ) : null}
            {watched ? (
              <Tip label={b.bot.watching}>
                <Codicon className="shrink-0 text-[0.6875rem] text-(--ui-accent)" name="eye" />
              </Tip>
            ) : null}
            <Tip label={rowTooltip}>
              <span className="min-w-0 shrink truncate text-[0.8125rem] font-medium">{displayName(bot, meta)}</span>
            </Tip>
            {/* Name and role read as one line ("Atlas Engineer"), so the row
                is two lines — who, then what it is doing — not three. */}
            {role ? (
              <span className="min-w-0 shrink-[2] truncate text-[0.6875rem] text-(--ui-text-quaternary)">{role}</span>
            ) : null}
          </div>
          {canStop ? (
            <Tip label={b.roster.stopRun}>
              <span
                aria-label={b.roster.stopRun}
                className="flex shrink-0 cursor-pointer items-center text-[0.6875rem] text-destructive"
                onClick={event => {
                  event.stopPropagation()
                  stopRun()
                }}
                role="button"
              >
                <Codicon name="debug-stop" />
              </span>
            </Tip>
          ) : null}
          {health.kind !== 'ok' ? (
            <Tip label={healthLabel}>
              <span
                aria-label={healthLabel}
                className={cn(
                  'flex shrink-0 items-center text-[0.6875rem]',
                  health.kind === 'unreachable' ? 'text-destructive' : 'text-amber-600 dark:text-amber-300'
                )}
              >
                <Codicon name={health.kind === 'unreachable' ? 'debug-disconnect' : 'warning'} />
              </span>
            </Tip>
          ) : null}
          {attention.count > 0 ? (
            <Tip
              label={attention.reason ? botAttentionHint(attention.reason) : b.roster.attentionItems(attention.count)}
            >
              <span
                aria-label={
                  attention.reason
                    ? `${b.roster.needsAttention}: ${botAttentionHint(attention.reason)}`
                    : b.roster.attentionItems(attention.count)
                }
                className="flex shrink-0 items-center gap-0.5 text-[0.6875rem] font-medium tabular-nums text-amber-600 dark:text-amber-300"
                onClick={event => {
                  event.stopPropagation()
                  open()
                }}
              >
                <Codicon name="warning" />
                {attention.count}
              </span>
            </Tip>
          ) : null}
          {openTasks ? (
            <Tip label={b.mailbox.openTasks(openTasks)}>
              <span className="flex shrink-0 items-center gap-0.5 text-[0.6875rem] text-(--ui-text-tertiary)">
                <Codicon aria-label={b.mailbox.section} name="inbox" />
                {openTasks}
              </span>
            </Tip>
          ) : null}
          {isOpening ? (
            <GlyphSpinner ariaLabel={b.bot.openingChat} className="shrink-0 text-xs text-(--ui-text-secondary)" />
          ) : null}
          {rowAgeTs ? (
            <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">
              {rosterRowAge(rowAgeTs * 1000, t.sidebar.row)}
            </span>
          ) : null}
        </div>
        {showDetailsRow ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-(--ui-text-tertiary)">
            {/* The status dot leads the status line it describes (working,
                waiting on you, unread), keyed off the canonical Bot Chat —
                the very session this row opens. */}
            <SessionStatusDot className="shrink-0" storedSessionId={canonicalSessionId} />
            {showHandle ? (
              <span className="shrink-0 font-mono text-[0.6875rem] text-(--ui-text-quaternary)">{`@${handle}`}</span>
            ) : null}
            {showHandle && detailText ? <span className="shrink-0 text-(--ui-text-quaternary)">·</span> : null}
            {detailText ? (
              <span
                className={cn(
                  'min-w-0 truncate',
                  liveTone === 'amber' && 'text-amber-600 dark:text-amber-300',
                  liveTone === 'live' && 'text-(--ui-text-secondary)',
                  !liveText && fromBot && 'italic'
                )}
              >
                {detailText}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </RowButton>
  )

  return (
    <BotRowMenu
      bot={bot}
      onAssignTask={onAssignTask}
      onDelete={onDelete}
      onEdit={onEdit}
      onGroup={onGroup}
      onNewSection={onNewSection}
    >
      {row}
    </BotRowMenu>
  )
}

/** One group chat as one quiet roster row. The room owns one visual identity;
 *  member details stay in its tooltip and workspace instead of competing
 *  with bot avatars in the narrow sidebar. */
interface GroupRowProps {
  active: boolean
  group: string
  members: GroupMember[]
  needsYou: boolean
  onDisband: (room: { members: GroupMember[]; name: string }) => void
  /** Opens the New section dialog; the group is filed into it on create. */
  onNewSection: (group: string) => void
  onOpen: (group: string) => void
}

export function GroupRow({ active, group, members, needsYou, onOpen, onDisband, onNewSection }: GroupRowProps) {
  const { t } = useI18n()
  const b = useBots()
  const rooms = useValue($groupChats)
  const sections = useValue($botSections)
  const currentSectionId = groupChatSectionId(group, rooms)

  const room = rooms[group] || {
    log: []
  }

  const log = Array.isArray(room.log) ? room.log : []
  const last = log.length ? log[log.length - 1] : null
  const lastAt = groupLastActivity(room)
  const readAt = useValue($groupReadAt)[groupChatRoomKey(group, room)] || 0
  const unread = groupUnreadCount(log, readAt)
  const { text: roundText } = groupLastRoundSummary(room)
  // Room previews speak the same handle vocabulary as the roster, mentions
  // and the group prompt: the primary profile is @hermes, not @default.
  const lastFrom = last?.from?.name || ''

  const lastHandle = botHandle(
    lastFrom || 'bot',
    members.find(member => member?.name === lastFrom)
  )

  const preview = last
    ? `${last.from?.kind === 'user' ? b.group.you : `@${lastHandle}`}: ${stripPreviewMarkdown(roundText) || '…'}`
    : b.group.memberCount(members.length)

  const availableMembers = members.filter(member => botSourceStatus(member).available).length
  const availabilityLabel = b.group.availableCount(availableMembers, members.length)

  // Same drag contract as a bot row, under the group's own key shape so a
  // drop zone can tell which kind landed without decoding roster keys.
  const dragKey = groupDragKey(group)
  const dragging = useValue($draggingBot) === dragKey

  const row = (
    <RowButton
      aria-label={`${group}, ${b.group.memberCount(members.length)}, ${availabilityLabel}`}
      className={cn(
        'flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-2 text-left transition-colors',
        'hover:bg-(--chrome-action-hover)',
        active && 'bg-(--ui-row-active-background)',
        dragging && 'opacity-40'
      )}
      draggable
      onClick={() => {
        haptic('tap')
        onOpen(group)
      }}
      onDragEnd={() => $draggingBot.set(null)}
      onDragStart={event => {
        event.dataTransfer.setData(BOT_DRAG_MIME, dragKey)
        event.dataTransfer.effectAllowed = 'move'
        $draggingBot.set(dragKey)
      }}
    >
      <div className="relative flex w-[34px] shrink-0 items-center justify-center">
        {room.image ? (
          <img
            alt=""
            className={cn(
              'size-8 rounded-md object-cover ring-1 ring-(--ui-stroke-tertiary)',
              availableMembers === 0 && 'grayscale opacity-60'
            )}
            src={room.image}
          />
        ) : (
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-md bg-(--chrome-action-hover) text-(--ui-text-tertiary)',
              availableMembers === 0 && 'opacity-60'
            )}
          >
            <Codicon name="organization" />
          </span>
        )}
        {members.length > 0 && availableMembers < members.length ? (
          <Tip label={availabilityLabel}>
            <span
              aria-label={availabilityLabel}
              className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-(--ui-bg-primary) text-[0.625rem] text-amber-600 ring-1 ring-(--ui-stroke-tertiary) dark:text-amber-300"
            >
              <Codicon name="debug-disconnect" />
            </span>
          </Tip>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{group}</span>
          {room.pinned ? (
            <Tip label={b.roster.pinned}>
              <Codicon className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)" name="pinned" />
            </Tip>
          ) : null}
          {needsYou ? (
            <Tip label={b.group.needsYourInput}>
              <Codicon aria-label={b.roster.needsInput} className="shrink-0 text-(--ui-accent)" name="question" />
            </Tip>
          ) : null}
          {unread > 0 ? (
            <Badge aria-label={b.group.unreadCount(unread)} className="shrink-0" size="xs" variant="solid">
              {unread > 99 ? '99+' : unread}
            </Badge>
          ) : null}
          {lastAt ? (
            <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">
              {rosterRowAge(lastAt, t.sidebar.row)}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 truncate text-xs text-(--ui-text-tertiary)">{preview}</div>
      </div>
    </RowButton>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onOpen(group)}>Open Group Chat</ContextMenuItem>
        <ContextMenuSeparator />
        {/* Same affordance as a bot row's pin; pinned rooms lead the roster
            band, and the flag lives on the room record. */}
        <ContextMenuItem
          onSelect={() => {
            const pinned = toggleGroupChatPinned(group)

            if (pinned !== null) {
              host.notify({ kind: 'info', message: `${group} ${pinned ? 'pinned to top' : 'unpinned'}` })
            }
          }}
        >
          {room.pinned ? 'Unpin' : 'Pin to top'}
        </ContextMenuItem>
        {/* Filing — the same submenu a bot row gets, driving the room-record
            assignment instead of profile meta. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{b.sections.moveTo}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {sections.map(section => (
              <ContextMenuItem
                disabled={section.id === currentSectionId}
                key={section.id}
                onSelect={() => moveGroupChatsToSection([group], section.id)}
              >
                <Codicon className="mr-1.5" name="folder" />
                {section.name}
              </ContextMenuItem>
            ))}
            {sections.length ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onSelect={() => onNewSection(group)}>
              <Codicon className="mr-1.5" name="new-folder" />
              {b.sections.newSectionEllipsis}
            </ContextMenuItem>
            {currentSectionId ? (
              <ContextMenuItem onSelect={() => moveGroupChatsToSection([group], null)}>
                <Codicon className="mr-1.5" name="inbox" />
                {b.sections.removeFromSection}
              </ContextMenuItem>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() =>
            onDisband({
              name: group,
              members
            })
          }
        >
          {b.group.deleteAction}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
