/**
 * The roster's card cell (bot-mode revamp G10): the same bot the list row
 * renders, composed as a card — avatar with the persona accent ring, name +
 * role subtitle, model chip, recency, last-activity preview, and the primary
 * Open chat action. Reads the SAME sources as the row ($botMeta, live status,
 * attention rollup, canonical-session preview) so card and list never tell
 * different stories, and wraps in the shared BotRowMenu so right-click parity
 * holds.
 */

import {
  $watchedSessionKeys,
  cn,
  Codicon,
  GlyphSpinner,
  isWatchedSessionId,
  SessionStatusDot,
  Tip,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'

import { botAccentColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { BotRowMenu, type BotRowMenuProps } from './bot-menu'
import { $botChatFocused, $focusedBotOwner, $pendingBotOpen, $selectedRosterKey, focusedRosterOwner } from './bot-state'
import { $botMeta, botActivitySession, botAttentionHint, botRosterKey, botSourceStatus } from './data'
import { $groupChatWorkspace } from './group-chat'
import { useBots } from './i18n'
import { botRole, displayName, stripPreviewMarkdown } from './labels'
import { botLiveStatusLabel, useBotAttention, useBotLiveStatus } from './live-status'
import { BotModelChip } from './model-menu'
import { openRosterBot } from './roster-actions'
import { botRosterMeta } from './routing'
import {
  A2A_PREFIX_RE,
  botCanonicalSessionId,
  botRowOwnsWorkspace,
  previewKind,
  rosterRowAge,
  warmRosterBot
} from './row-helpers'

export function BotCard({
  bot,
  onAssignTask,
  onDelete,
  onEdit,
  onGroup,
  onNewSection
}: Omit<BotRowMenuProps, 'children'>) {
  const { t } = useI18n()
  const b = useBots()
  const focusedOwner = focusedRosterOwner(useValue($focusedBotOwner))
  const selectedRosterKey = useValue($selectedRosterKey)
  const pendingOpenKey = useValue($pendingBotOpen)?.key
  const isOpening = pendingOpenKey === botRosterKey(bot)
  const botChatFocused = useValue($botChatFocused)
  const allMeta = useValue($botMeta)
  const meta = botRosterMeta(bot, allMeta)

  const sourceStatus = botSourceStatus(bot)
  const last = bot.last_session
  const activeGroup = useValue($groupChatWorkspace)
  const isActive = botRowOwnsWorkspace(bot, activeGroup, botChatFocused, focusedOwner, selectedRosterKey)

  const { shape, color, image } = botAppearance(bot.name, meta)
  const photo = Boolean(image && !isBackfilledFacePng(image))

  const previewSession = bot.canonical_session || last
  const activitySession = botActivitySession(bot)
  const rowAgeTs = Math.max(activitySession?.last_active || 0, bot.worker_session?.last_active || 0)

  const canonicalSessionId = botCanonicalSessionId(bot)
  const watchedMap = useValue($watchedSessionKeys)

  const watched = Boolean(
    canonicalSessionId &&
    watchedMap &&
    typeof isWatchedSessionId === 'function' &&
    isWatchedSessionId(canonicalSessionId)
  )

  const attention = useBotAttention(bot)
  const live = useBotLiveStatus(bot)

  const { fromBot } = previewKind(previewSession?.preview)

  const displayPreview = stripPreviewMarkdown(
    fromBot ? (previewSession?.preview || '').replace(A2A_PREFIX_RE, '').trim() || '…' : previewSession?.preview || ''
  )

  const liveText = live.kind === 'idle' || live.kind === 'unknown' ? null : botLiveStatusLabel(live, b.roster)

  const detailText = liveText || displayPreview || (live.kind === 'idle' ? b.roster.liveIdle : '')

  const role = botRole(bot, meta)
  const accent = botAccentColor(bot, meta)

  const open = () => void openRosterBot(bot)
  const warm = () => warmRosterBot(bot)

  const liveTone = live.kind === 'needs-input' || live.kind === 'stalled' ? 'amber' : liveText ? 'live' : null

  return (
    <BotRowMenu
      bot={bot}
      onAssignTask={onAssignTask}
      onDelete={onDelete}
      onEdit={onEdit}
      onGroup={onGroup}
      onNewSection={onNewSection}
    >
      <div
        aria-busy={isOpening || undefined}
        aria-label={displayName(bot, meta)}
        className={cn(
          'flex w-full min-w-0 cursor-pointer flex-col gap-1.5 overflow-hidden rounded-lg border border-(--ui-stroke-secondary) p-2.5 text-left transition-colors',
          'hover:bg-(--chrome-action-hover)',
          isActive && 'bg-(--ui-row-active-background)'
        )}
        data-roster-key={botRosterKey(bot)}
        onClick={open}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            open()
          }
        }}
        onPointerEnter={warm}
        role="button"
        style={{ backgroundImage: `linear-gradient(135deg, ${accent}0d, transparent 60%)` }}
        tabIndex={0}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn('shrink-0 rounded-lg', !sourceStatus.available && 'grayscale opacity-60')}
            style={{ boxShadow: `0 0 0 1px ${accent}80` }}
          >
            <BotFace color={accent} image={photo ? image : null} name={bot.name} shape={shape} size={30} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <SessionStatusDot storedSessionId={canonicalSessionId} />
              {watched ? (
                <Tip label={b.bot.watching}>
                  <Codicon className="shrink-0 text-[0.6875rem] text-(--ui-accent)" name="eye" />
                </Tip>
              ) : null}
              <span className="min-w-0 truncate text-[0.8125rem] font-medium">{displayName(bot, meta)}</span>
              {attention.count > 0 ? (
                <Tip
                  label={
                    attention.reason ? botAttentionHint(attention.reason) : b.roster.attentionItems(attention.count)
                  }
                >
                  <span
                    aria-label={b.roster.needsAttention}
                    className="flex shrink-0 items-center gap-0.5 text-[0.6875rem] font-medium tabular-nums text-amber-600 dark:text-amber-300"
                  >
                    <Codicon name="warning" />
                    {attention.count}
                  </span>
                </Tip>
              ) : null}
            </div>
            {role ? (
              <div className="min-w-0 truncate text-[0.6875rem] leading-snug text-(--ui-text-quaternary)">{role}</div>
            ) : null}
          </div>
        </div>

        {detailText ? (
          <div
            className={cn(
              'min-w-0 truncate text-[0.6875rem] text-(--ui-text-tertiary)',
              liveTone === 'amber' && 'text-amber-600 dark:text-amber-300',
              !liveText && fromBot && 'italic'
            )}
          >
            {detailText}
          </div>
        ) : null}

        <div className="mt-auto flex min-w-0 items-center gap-1.5">
          {/* The chip's own click must not double as an open — the dropdown
              trigger stops propagation itself via this wrapper. */}
          <span onClick={event => event.stopPropagation()}>
            <BotModelChip bot={bot} />
          </span>
          {rowAgeTs ? (
            <span className="ml-auto shrink-0 text-[0.625rem] text-(--ui-text-quaternary)">
              {b.roster.cardActive(rosterRowAge(rowAgeTs * 1000, t.sidebar.row))}
            </span>
          ) : null}
        </div>

        <button
          className="mt-0.5 w-full rounded-md border border-(--ui-stroke-secondary) py-1 text-[0.6875rem] font-medium text-(--ui-text-secondary) transition-colors hover:bg-(--ui-control-active-background) hover:text-foreground"
          onClick={event => {
            event.stopPropagation()
            open()
          }}
          type="button"
        >
          {isOpening ? <GlyphSpinner ariaLabel={b.bot.openingChat} className="inline-block text-xs" /> : null}
          {b.roster.openChat}
        </button>
      </div>
    </BotRowMenu>
  )
}
