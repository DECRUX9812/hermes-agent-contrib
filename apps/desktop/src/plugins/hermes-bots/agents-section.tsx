/**
 * The Agents fold inside the Sessions rail — the roster's compact form.
 *
 * One rail, one scroll column: a bot sits beside the sessions it works in,
 * not behind a pane tab. Rows reuse the roster's own order (pins, then
 * recency — `sortRosterBots`) and the same click path the Bots pane owns
 * (`openRosterBot`), so the canonical Bot Chat identity contract never
 * forks by surface: a click here resolves (profile, "Bot Chat") exactly as
 * a roster row does.
 *
 * The section is deliberately shallow — it caps at a handful of rows and
 * ends in an "All bots" row into the pane, which stays the management
 * surface (edit, delete, groups, filters). It never becomes a second
 * roster; the moment it grows filters or menus it has re-introduced the
 * split this fold exists to remove.
 */

import {
  cn,
  Codicon,
  DisclosureCaret,
  host,
  RowButton,
  SessionStatusDot,
  SidebarPanelLabel,
  SidebarRowLead,
  SidebarSectionMeta,
  Tip,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import {
  $agentsSectionOpen,
  $botChatFocused,
  $focusedBotOwner,
  $selectedRosterKey,
  focusedRosterOwner,
  setAgentsSectionOpen
} from './bot-state'
import { CreateAgentDialog } from './create-dialog'
import {
  $botAttention,
  $botMeta,
  $lastRoster,
  annotateBotSource,
  botActivitySession,
  botAttentionHint,
  botHandle,
  botRosterKey,
  botSelectionKey,
  botSourceStatus,
  preferReachableSameNameRows,
  useRoster
} from './data'
import { $groupChatWorkspace } from './group-chat'
import { isBotHidden } from './hidden-bots'
import { useBots } from './i18n'
import { displayName, stripPreviewMarkdown } from './labels'
import { openRosterBot } from './roster-actions'
import { sortRosterBots } from './roster-pane-derivation'
import { usePublishRosterSnapshot } from './roster-pane-lifecycle'
import { botRosterMeta } from './routing'
import {
  A2A_PREFIX_RE,
  botCanonicalSessionId,
  botRowOwnsWorkspace,
  previewKind,
  rosterRowAge,
  warmRosterBot
} from './row-helpers'
import type { RosterRow } from './types'

/** Rows the section renders before the "All bots" footer takes over. */
const AGENTS_ROW_CAP = 7

export function AgentsSection() {
  const { t } = useI18n()
  const b = useBots()
  const open = useValue($agentsSectionOpen)
  const { data, error, refetch } = useRoster()
  const allMeta = useValue($botMeta)
  const gatewayUp = useValue(host.state.gateway) === 'open'
  const [createOpen, setCreateOpen] = useState(false)

  // Same resilience rule the pane applies: a failed refresh renders the last
  // good snapshot rather than erasing the rail section on a transient blip.
  const live = Array.isArray(data?.profiles) ? data.profiles : null
  const source = live ?? (error ? $lastRoster.get() : [])
  const sourceSnapshot = Array.isArray(data?.sources) ? data.sources : []

  const { roster } = sortRosterBots(source, allMeta)
  // This fold is the roster surface that is always mounted — it owns the
  // lifecycle publishes ($lastRoster, workspace labels, meta merge, unread
  // poll) whether or not the Bots pane tab is fronted.
  usePublishRosterSnapshot({
    data,
    live,
    roster,
    allMeta,
    activeSourceRoster: roster.filter(row => !row?.remoteSource)
  })

  // The pane's own visible-set rule minus its filters: hidden bots stay out,
  // same-name twins across sources collapse to the reachable one.
  const visible = preferReachableSameNameRows(
    roster.filter(bot => !isBotHidden(bot, allMeta) && botSourceStatus(annotateBotSource(bot, sourceSnapshot)).available)
  )

  // While the rail's search runs, this section IS its bots result set — the
  // contribution stays mounted (sidebar.listTop `searchable`) and narrows to
  // matching rows; the cap and the "All bots" door step aside.
  const searchQuery = useValue(host.state.sidebarSearchQuery).trim().toLowerCase()

  const matched = searchQuery
    ? visible.filter(bot => {
        const meta = botRosterMeta(bot, allMeta)
        const hay = [bot.name, displayName(bot, meta), botHandle(bot.name, bot)]

        return hay.some(field => field?.toLowerCase().includes(searchQuery))
      })
    : visible

  const shown = searchQuery ? matched : visible.slice(0, AGENTS_ROW_CAP)
  const loading = !data && !error

  // No matching bots during a search — the sessions Results column owns the
  // space; an empty BOTS header would read as "you have no bots".
  if (searchQuery && shown.length === 0) {
    return null
  }

  return (
    <section aria-label={t.common.bots} className="px-0">
      <div className="group/section flex shrink-0 items-center justify-between gap-1 pb-1 pt-1.5">
        <button
          aria-expanded={open}
          className="group/section-label flex w-fit min-w-0 items-center gap-1 bg-transparent text-left leading-none"
          onClick={() => setAgentsSectionOpen(!open)}
          type="button"
        >
          <SidebarPanelLabel>{t.common.bots}</SidebarPanelLabel>
          {visible.length > 0 && <SidebarSectionMeta>{visible.length}</SidebarSectionMeta>}
          <DisclosureCaret
            className="text-(--ui-text-tertiary) opacity-0 transition group-hover/section-label:opacity-100"
            open={open}
          />
        </button>
        {/* The Bots pane is the roster's full surface — the header's gear
            fronts it so management is one click even when every row fits. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <Tip label={b.bot.newTitle}>
            <button
              aria-label={b.bot.newTitle}
              className="grid size-5 place-items-center rounded-sm bg-transparent text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) hover:text-foreground group-hover/section:opacity-100 focus-visible:opacity-100"
              onClick={() => setCreateOpen(true)}
              type="button"
            >
              <Codicon name="add" size="0.75rem" />
            </button>
          </Tip>
          <Tip label={b.agents.manage}>
            <button
              aria-label={b.agents.manage}
              className="grid size-5 place-items-center rounded-sm bg-transparent text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) hover:text-foreground group-hover/section:opacity-100 focus-visible:opacity-100"
              onClick={() => host.revealPane('hermes-bots:pane')}
              type="button"
            >
              <Codicon name="settings-gear" size="0.75rem" />
            </button>
          </Tip>
        </div>
      </div>

      {open && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-px pb-1">
          {shown.map(bot => (
            <AgentRow bot={bot} key={botRosterKey(bot)} />
          ))}
          {/* A failed first read is not an empty account — say so and offer
              the same retry the pane does rather than "Create your first". */}
          {!loading && visible.length === 0 && error && (
            <div className="grid gap-1 px-2 py-1.5">
              <span className="text-[0.8125rem] leading-snug text-(--ui-text-tertiary)">
                {gatewayUp
                  ? b.roster.rosterUnavailable(error instanceof Error ? error.message : 'gateway error')
                  : b.roster.waitingForGateway}
              </span>
              <RowButton
                className="flex w-fit min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[0.8125rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-foreground"
                onClick={() => void refetch()}
              >
                <Codicon className="shrink-0 text-[0.75rem]" name="refresh" />
                <span className="min-w-0 truncate">{b.roster.retryNow}</span>
              </RowButton>
            </div>
          )}
          {!loading && !error && visible.length === 0 && (
            <RowButton
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={() => setCreateOpen(true)}
            >
              <Codicon className="shrink-0 text-[0.75rem]" name="add" />
              <span className="min-w-0 truncate">{b.roster.emptyDesc}</span>
            </RowButton>
          )}
          {visible.length > 0 && !searchQuery && (
            <RowButton
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[0.8125rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={() => host.revealPane('hermes-bots:pane')}
            >
              <span className="min-w-0 truncate">{b.agents.allBots(visible.length)}</span>
              <Codicon className="ml-auto shrink-0 text-[0.75rem] text-(--ui-text-quaternary)" name="arrow-right" />
            </RowButton>
          )}
        </div>
      )}

      {/* The dialog lives here so "+" works without the pane mounted. It
          portals to <body>, so its DOM position is display-only. Same
          active-source roster the pane hands it — remote rows can't create. */}
      <CreateAgentDialog
        onClose={() => {
          setCreateOpen(false)
          void refetch()
        }}
        open={createOpen}
        roster={roster.filter(row => !row?.remoteSource)}
      />
    </section>
  )
}

/** One compact bot row — the session row's anatomy (face, name, age, status
 *  dot) without the pane row's drag handle or context menu: this rail is for
 *  opening, the pane is for managing. */
function AgentRow({ bot }: { bot: RosterRow }) {
  const { t } = useI18n()
  const b = useBots()
  const allMeta = useValue($botMeta)
  const meta = botRosterMeta(bot, allMeta)
  const focusedOwner = focusedRosterOwner(useValue($focusedBotOwner))
  const selectedRosterKey = useValue($selectedRosterKey)
  const botChatFocused = useValue($botChatFocused)
  const activeGroup = useValue($groupChatWorkspace)
  const attentionByKey = useValue($botAttention)
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  const isActive = botRowOwnsWorkspace(bot, activeGroup, botChatFocused, focusedOwner, selectedRosterKey)
  const sourceStatus = botSourceStatus(bot)
  const { shape, color, image } = botAppearance(bot.name, meta)
  const photo = Boolean(image && !isBackfilledFacePng(image))

  // Preview/age/status all key off the canonical Bot Chat (same rule the
  // pane row follows — preview identity == click identity).
  const previewSession = bot.canonical_session || bot.last_session
  const activitySession = botActivitySession(bot)
  const rowAgeTs = Math.max(activitySession?.last_active || 0, bot.worker_session?.last_active || 0)
  const canonicalSessionId = botCanonicalSessionId(bot)

  const attention =
    attentionByKey[botSelectionKey(bot)] ||
    attentionByKey[botRosterKey(bot)] ||
    attentionByKey[`${bot?.connectionId || activeConnectionId}::${bot?.name || 'default'}`] ||
    null

  const { fromBot } = previewKind(previewSession?.preview)

  const displayPreview = stripPreviewMarkdown(
    fromBot ? (previewSession?.preview || '').replace(A2A_PREFIX_RE, '').trim() || '…' : previewSession?.preview || ''
  )

  const rowTooltip = [displayName(bot, meta), sourceStatus.label].filter(Boolean).join(' · ')

  return (
    <RowButton
      aria-label={rowTooltip}
      className={cn(
        'flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors',
        'hover:bg-(--chrome-action-hover)',
        isActive && 'bg-(--ui-row-active-background)'
      )}
      data-roster-key={botRosterKey(bot)}
      // Roving keyboard row — same rail contract as session rows (arrows walk
      // it, Tab doesn't stop on it).
      data-sidebar-row=""
      onClick={() => void openRosterBot(bot)}
      onPointerEnter={() => warmRosterBot(bot)}
      tabIndex={-1}
    >
      <div className={cn('shrink-0', !sourceStatus.available && 'grayscale opacity-60')}>
        <BotFace color={avatarColor(color, bot.name)} image={photo ? image : null} name={bot.name} shape={shape} size={26} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <SidebarRowLead>
              <SessionStatusDot storedSessionId={canonicalSessionId} />
            </SidebarRowLead>
            <Tip label={rowTooltip}>
              <span className="min-w-0 truncate text-[0.8125rem] font-medium">{displayName(bot, meta)}</span>
            </Tip>
          </div>
          {attention ? (
            <Tip label={botAttentionHint(attention.reason)}>
              <Codicon
                aria-label={b.roster.needsAttention}
                className="shrink-0 text-[0.6875rem] text-amber-600 dark:text-amber-300"
                name="warning"
              />
            </Tip>
          ) : null}
          {rowAgeTs ? (
            <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">
              {rosterRowAge(rowAgeTs * 1000, t.sidebar.row)}
            </span>
          ) : null}
        </div>
        {displayPreview ? (
          <div className="flex min-w-0 items-center text-xs text-(--ui-text-tertiary)">
            <span className={cn('min-w-0 truncate', fromBot && 'italic')}>{displayPreview}</span>
          </div>
        ) : null}
      </div>
    </RowButton>
  )
}
