/**
 * The bot's context menu — the full action surface shared by the roster's
 * list row and card (G10) so a bot right-clicked in either view offers the
 * same open/stop/screen/watch/notify/edit/duplicate/export/file/delete set.
 *
 * The menu computes its own internals (meta, live status, watch state, notify
 * mode, sections) from the row identity, so a card and a row wired through it
 * can never drift on which actions are enabled.
 */

import {
  $ownerNotifyModes,
  $watchedSessionKeys,
  Codicon,
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  host,
  isWatchedSessionId,
  ownerNotifyKey,
  queryClient,
  setOwnerNotifyMode,
  toggleSessionWatched,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { exportBot } from './bot-export'
import { saveSelectedRosterBot } from './bot-state'
import { ensureBotMetadata } from './canonical-chat'
import { $botMeta, $lastRoster, botSelectionKey, isDefaultBot, newBotChat, ROSTER_KEY, saveBotMeta } from './data'
import { botGroups } from './group-membership'
import { fallbackSelectionAfterHide, isBotHidden, isBotPinned } from './hidden-bots'
import { useBots } from './i18n'
import { displayName } from './labels'
import { useBotAttention, useBotLiveStatus } from './live-status'
import { BotModelMenu } from './model-menu'
import { duplicateBot } from './profile-ops'
import { botRecentSession, openBotRecentSession } from './recent-session'
import { $relayInflight, relayLaneKey } from './relay'
import { openRosterBot } from './roster-actions'
import { botRosterMeta, botWorkspaceOwnerKey, setBotsWorkspaceOwner } from './routing'
import { botCanonicalSessionId } from './row-helpers'
import { retryBotDeliveries, stopBotTurn } from './run-controls'
import { openBotScreen } from './screen-open'
import type { RosterRow } from './types'
import { $botSections, botSectionId, moveBotsToSection } from './user-sections'

export interface BotRowMenuProps {
  bot: RosterRow
  /** "Assign task…" — opens the mailbox compose dialog (#48). */
  onAssignTask?: (bot: RosterRow) => void
  onDelete: (bot: RosterRow) => void
  onEdit: (bot: RosterRow) => void
  onGroup: (bot: RosterRow) => void
  /** Opens the New section dialog; the bot is filed into it on create. */
  onNewSection: (bot: RosterRow) => void
  children: ReactNode
}

export function BotRowMenu({ bot, children, onAssignTask, onDelete, onEdit, onGroup, onNewSection }: BotRowMenuProps) {
  const { t } = useI18n()
  const b = useBots()
  const allMeta = useValue($botMeta)
  const meta = botRosterMeta(bot, allMeta)
  const hidden = isBotHidden(bot, allMeta)
  const pinned = isBotPinned(bot, allMeta)
  const groups = botGroups(meta)
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  // A1 — the live status: the E1 stop affordance keys off the same
  // live-turn claim the row's status line makes.
  const live = useBotLiveStatus(bot)
  const canStop = live.kind === 'working' || live.kind === 'stalled'

  // A2 — the attention rollup: the flagged reason still drives the E3 retry
  // item's presence.
  const attention = useBotAttention(bot)

  // Status keys off the canonical Bot Chat — the very session the row opens.
  const canonicalSessionId = botCanonicalSessionId(bot)
  const watchedMap = useValue($watchedSessionKeys)

  const watched = Boolean(
    canonicalSessionId && watchedMap && typeof isWatchedSessionId === 'function' && isWatchedSessionId(canonicalSessionId)
  )

  // E3 — a delivery queued or in flight to this bot.
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

  // Per-bot notification mode (A4): keyed `conn::profile` — the same owner the
  // store resolves for the bot's canonical chat, side-chats and cron runs.
  const ownerNotifyModes = useValue($ownerNotifyModes)
  const notifyKey = ownerNotifyKey(bot?.connectionId, bot?.targetProfile || bot?.name)
  const notifyMode = ownerNotifyModes[notifyKey]

  const sections = useValue($botSections)
  const currentSectionId = botSectionId(bot, allMeta)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void openRosterBot(bot)}>{b.bot.openBotChat}</ContextMenuItem>
        {/* E1 — same stop the row chip fires; kept in the menu so the
            affordance is discoverable and announces itself disabled. */}
        <ContextMenuItem disabled={!canStop} onSelect={stopRun}>
          {b.roster.stopRun}
        </ContextMenuItem>
        {/* E3 — only meaningful while this bot has mail queued or a flagged
            failure the drain can re-drive. */}
        {deliveryInflight || attention.reason ? (
          <ContextMenuItem onSelect={() => retryBotDeliveries()}>{b.roster.retryDeliveries}</ContextMenuItem>
        ) : null}
        {onAssignTask ? (
          <ContextMenuItem onSelect={() => onAssignTask(bot)}>{b.mailbox.assignTask}</ContextMenuItem>
        ) : null}
        <ContextMenuItem onSelect={() => openBotScreen(bot, meta)}>{b.screen.menu}</ContextMenuItem>
        {/* Phone parity (#40): Messaging scoped to this bot's profile — the
            platform cards there carry the deep link + QR. Remote-source bots
            have no platforms on this backend, so the item hides for them. */}
        {!bot.remoteSource && typeof host.navigate === 'function' && (
          <ContextMenuItem onSelect={() => host.navigate(`/messaging?profile=${encodeURIComponent(bot.name)}`)}>
            {b.bot.continueOnPhone}
          </ContextMenuItem>
        )}
        <ContextMenuCheckboxItem
          checked={Boolean(meta?.screenAutoOpen)}
          onSelect={() => {
            void ensureBotMetadata(bot)
              .then(current => {
                const next = !current.screenAutoOpen
                void saveBotMeta(bot, { screenAutoOpen: next })
                host.notify({
                  kind: 'info',
                  message: next
                    ? b.screen.autoOpenOnToast(displayName(bot, current))
                    : b.screen.autoOpenOffToast(displayName(bot, current))
                })
              })
              .catch(error => host.notifyError?.(error, b.bot.metadataLoadFailed))
          }}
        >
          {b.screen.autoOpenMenu}
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            void ensureBotMetadata(bot)
              .then(current => {
                const nextPinned = Boolean(current.pinned)
                void saveBotMeta(bot, {
                  pinned: !nextPinned
                })
                host.notify({
                  kind: 'info',
                  message: nextPinned
                    ? b.bot.unpinnedToast(displayName(bot, current))
                    : b.bot.pinnedToast(displayName(bot, current))
                })
              })
              .catch(error => host.notifyError?.(error, b.bot.metadataLoadFailed))
          }}
        >
          {pinned ? b.bot.unpin : b.bot.pinToTop}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            void ensureBotMetadata(bot)
              .then(current => {
                const nextHidden = Boolean(current.hidden)
                void saveBotMeta(bot, {
                  hidden: !nextHidden
                })

                if (!nextHidden) {
                  fallbackSelectionAfterHide(botSelectionKey(bot))
                }

                host.notify({
                  kind: 'info',
                  message: nextHidden
                    ? b.bot.unhiddenToast(displayName(bot, current))
                    : b.bot.hiddenToast(displayName(bot, current))
                })
              })
              .catch(error => host.notifyError?.(error, b.bot.metadataLoadFailed))
          }}
        >
          {hidden ? b.bot.unhide : b.bot.hide}
        </ContextMenuItem>
        {typeof toggleSessionWatched === 'function' ? (
          <ContextMenuCheckboxItem
            checked={watched}
            disabled={!canonicalSessionId}
            onSelect={() => {
              if (!canonicalSessionId) {
                return
              }

              const next = toggleSessionWatched(canonicalSessionId)

              host.notify({
                kind: 'info',
                message: next ? b.bot.watchToast(displayName(bot, meta)) : b.bot.unwatchToast(displayName(bot, meta))
              })
            }}
          >
            {b.bot.watch}
          </ContextMenuCheckboxItem>
        ) : null}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{b.bot.notifications}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuCheckboxItem
              checked={notifyMode === 'muted'}
              onSelect={() => setOwnerNotifyMode(notifyKey, notifyMode === 'muted' ? null : 'muted')}
            >
              {b.bot.muteAll}
            </ContextMenuCheckboxItem>
            <ContextMenuCheckboxItem
              checked={notifyMode === 'quiet'}
              onSelect={() => setOwnerNotifyMode(notifyKey, notifyMode === 'quiet' ? null : 'quiet')}
            >
              {b.bot.muteQuiet}
            </ContextMenuCheckboxItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() =>
            void ensureBotMetadata(bot)
              .then(() => onEdit(bot))
              .catch(error => host.notifyError?.(error, b.bot.loadFailed))
          }
        >
          {b.bot.editMenu}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            void ensureBotMetadata(bot)
              .then(() => onGroup(bot))
              .catch(error => host.notifyError?.(error, b.bot.groupsLoadFailed))
          }
        >
          {groups.length ? b.bot.groupsMenu(groups.join(', ')) : b.bot.manageGroups}
        </ContextMenuItem>
        <BotModelMenu bot={bot} />
        <ContextMenuItem
          onSelect={() => {
            host.notify({
              kind: 'info',
              message: b.bot.duplicating(displayName(bot, meta))
            })
            duplicateBot(bot, $lastRoster.get())
              .then(name => {
                queryClient.invalidateQueries({
                  queryKey: ROSTER_KEY
                })
                host.notify({
                  kind: 'success',
                  message: b.bot.duplicated(name, bot.name)
                })
              })
              .catch(err => host.notifyError(err, b.bot.duplicateFailed))
          }}
        >
          {b.bot.duplicate}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void exportBot(bot, meta)}>{b.bot.exportBotMenu}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            saveSelectedRosterBot(bot)
            setBotsWorkspaceOwner(botWorkspaceOwnerKey(bot), bot)
            newBotChat(bot)
          }}
        >
          {b.bot.newChatWith}
        </ContextMenuItem>
        {/* Click-to-latest (#93054): the freshest listed session — a cron run,
            a delegated job, a side thread — without moving the card click off
            the canonical Bot Chat. */}
        <ContextMenuItem disabled={!botRecentSession(bot)} onSelect={() => void openBotRecentSession(bot)}>
          Open recent session
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* Filing. Membership is one field on the bot's meta (`sectionId`), so
            this is a one-field write and no list anywhere has to be kept in
            sync with it. */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{b.sections.moveTo}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {sections.map(section => (
              <ContextMenuItem
                disabled={section.id === currentSectionId}
                key={section.id}
                onSelect={() => void moveBotsToSection([bot], section.id)}
              >
                <Codicon className="mr-1.5" name="folder" />
                {section.name}
              </ContextMenuItem>
            ))}
            {sections.length ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onSelect={() => onNewSection(bot)}>
              <Codicon className="mr-1.5" name="new-folder" />
              {b.sections.newSectionEllipsis}
            </ContextMenuItem>
            {currentSectionId ? (
              <ContextMenuItem onSelect={() => void moveBotsToSection([bot], null)}>
                <Codicon className="mr-1.5" name="inbox" />
                {b.sections.removeFromSection}
              </ContextMenuItem>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {isDefaultBot(bot) ? null : <ContextMenuSeparator />}
        {isDefaultBot(bot) ? null : (
          <ContextMenuItem onSelect={() => onDelete(bot)} variant="destructive">
            {t.common.delete}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

