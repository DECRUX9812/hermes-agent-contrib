/**
 * The roster's card cell (bot-mode revamp G10): the same bot the list row
 * renders, composed as a card — avatar, name +
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
  host,
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
import { CardAttention } from './card-attention'
import { $botMeta, botActivitySession, botRosterKey, botSourceStatus } from './data'
import { $groupChatWorkspace } from './group-chat'
import { $activeGroupMemberKeys } from './group-presence'
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
  botWorkingMood,
  previewKind,
  rosterRowAge,
  useTurnBusy,
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
  const turnBusy = useTurnBusy()
  const groupKeys = useValue($activeGroupMemberKeys)
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()
  const mood = botWorkingMood(bot, focusedOwner, turnBusy, activeConnectionId, Date.now(), groupKeys)

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
      <article
        aria-busy={isOpening || undefined}
        aria-label={displayName(bot, meta)}
        className={cn(
          'flex w-full min-w-0 flex-col gap-3 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) p-3 text-left transition-colors',
          'hover:bg-(--chrome-action-hover)',
          isActive && 'bg-(--ui-row-active-background)'
        )}
        data-roster-key={botRosterKey(bot)}
        onPointerEnter={warm}
      >
        <button
          aria-label={`${b.roster.openChat}: ${displayName(bot, meta)}`}
          className="grid min-w-0 gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent) focus-visible:ring-offset-2"
          disabled={isOpening}
          onClick={open}
          onFocus={warm}
          type="button"
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className={cn('shrink-0 rounded-lg', !sourceStatus.available && 'grayscale opacity-60')}>
              <BotFace
                color={accent}
                image={photo ? image : null}
                mood={mood}
                name={bot.name}
                shape={shape}
                size={30}
              />
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
                <CardAttention count={attention.count} reason={attention.reason} />
              </div>
              {role ? (
                <div className="min-w-0 truncate text-xs leading-snug text-(--ui-text-tertiary)">{role}</div>
              ) : null}
            </div>
          </div>

          {detailText ? (
            <div
              className={cn(
                'min-w-0 line-clamp-2 text-xs leading-relaxed text-(--ui-text-tertiary)',
                liveTone === 'amber' && 'text-amber-600 dark:text-amber-300',
                !liveText && fromBot && 'italic'
              )}
            >
              {detailText}
            </div>
          ) : null}
          <span className="flex items-center gap-1.5 text-xs font-medium text-(--ui-text-secondary)">
            {isOpening ? <GlyphSpinner ariaLabel={b.bot.openingChat} className="text-xs" /> : null}
            {b.roster.openChat}
            <Codicon aria-hidden name="arrow-right" size="0.75rem" />
          </span>
        </button>

        <div className="mt-auto flex min-w-0 items-center gap-1.5">
          <span className="min-w-0">
            <BotModelChip bot={bot} />
          </span>
          {rowAgeTs ? (
            <span className="ml-auto shrink-0 text-xs text-(--ui-text-tertiary)">
              {b.roster.cardActive(rosterRowAge(rowAgeTs * 1000, t.sidebar.row))}
            </span>
          ) : null}
        </div>
      </article>
    </BotRowMenu>
  )
}
