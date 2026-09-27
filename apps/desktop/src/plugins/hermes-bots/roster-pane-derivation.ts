import { botActivitySession } from './data'
import { botRosterKey, filterBots, preferReachableSameNameRows } from './data'
import type { $groupChats } from './group-chat'
import { groupChatMemberBots, groupChatNames, groupLastActivity } from './group-membership'
import { sortGroupRosterRows } from './group-order'
import { isBotPinned } from './hidden-bots'
import { isBotHidden } from './hidden-bots'
import { displayName } from './labels'
import type { RosterSortMode } from './live-status'
import { filterBotsByGateway, groupMatchesRosterFilters, rosterGatewaySections } from './roster-sections'
import type { rosterGatewayOptions } from './roster-sections'
import { botRosterMeta } from './routing'
import { BOT_ROSTER_SEARCH_THRESHOLD } from './row-helpers'
import { ACTIVE_WINDOW_S, rosterActivityMatches } from './row-helpers'
import type { BotMeta, GroupMember, RosterActivityFilter, RosterKindFilter, RosterRow } from './types'
/** The two row shapes the roster sorts together — `kind` is the discriminant. */
interface RosterBotRow {
  active: boolean
  activity: number
  attention: number
  bot: RosterRow
  kind: 'bot'
  pinned: boolean
}
export interface RosterGroupRow {
  active: boolean
  activity: number
  kind: 'group'
  members: GroupMember[]
  name: string
  pinned: boolean
}

interface RosterRowsInput {
  roster: RosterRow[]
  allMeta: Record<string, BotMeta>
  gatewayFilter: string
  query: string
  activityFilter: RosterActivityFilter
  rowKindFilter: RosterKindFilter
  groupRooms: ReturnType<typeof $groupChats.get>
  activeRosterKeys: Set<string>
  gatewayOptions: ReturnType<typeof rosterGatewayOptions>
  activityOf: (bot: RosterRow) => number
  /** A2 — attention rollup per bot; supplying it switches the row order to
   *  pinned → attention desc → activity desc. Omitted = pinned → activity. */
  attentionOf?: (bot: RosterRow) => number
  isPinned: (bot: RosterRow) => boolean
}

export function deriveRosterRows({
  roster,
  allMeta,
  gatewayFilter,
  query,
  activityFilter,
  rowKindFilter,
  groupRooms,
  activeRosterKeys,
  gatewayOptions,
  activityOf,
  attentionOf,
  isPinned
}: RosterRowsInput) {
  const activeSourceRoster = roster.filter(bot => !bot.remoteSource)
  // Hidden rows remain fully alive and recoverable at the bottom. Every
  // non-display consumer continues to receive the complete roster.
  const hiddenBots = roster.filter(bot => isBotHidden(bot, allMeta))
  const visibleRoster = roster.filter(bot => !isBotHidden(bot, allMeta))
  const gatewayRoster = filterBotsByGateway(visibleRoster, gatewayFilter)

  const filteredRoster = filterBots(gatewayRoster, allMeta, query).filter((bot: RosterRow) =>
    rosterActivityMatches(
      {
        activity: activityOf(bot),
        active: activeRosterKeys.has(botRosterKey(bot))
      },
      activityFilter
    )
  )

  const filteredHiddenBots = filterBots(filterBotsByGateway(hiddenBots, gatewayFilter), allMeta, query).filter(
    (bot: RosterRow) =>
      rosterActivityMatches(
        {
          activity: activityOf(bot),
          active: activeRosterKeys.has(botRosterKey(bot))
        },
        activityFilter
      )
  )

  const groupNames = groupChatNames(allMeta, groupRooms)

  const groupRows = groupNames
    .map(name => ({
      name,
      members: groupChatMemberBots(name, roster, allMeta)
    }))
    .filter(row => groupMatchesRosterFilters(row.name, row.members, allMeta, query, gatewayFilter))
    .map((row): RosterGroupRow => ({
      kind: 'group',
      name: row.name,
      members: row.members,
      pinned: Boolean(groupRooms[row.name]?.pinned),
      activity: groupLastActivity(groupRooms[row.name]),
      active:
        Boolean(
          groupLastActivity(groupRooms[row.name]) &&
          Date.now() - groupLastActivity(groupRooms[row.name]) <= ACTIVE_WINDOW_S * 1000
        ) || row.members.some(member => activeRosterKeys.has(botRosterKey(member)))
    }))
    .filter(row => rowKindFilter !== 'bots' && rosterActivityMatches(row, activityFilter))

  const botRows =
    rowKindFilter === 'groups'
      ? []
      : preferReachableSameNameRows(filteredRoster).map((bot): RosterBotRow => ({
          kind: 'bot',
          bot,
          pinned: isPinned(bot),
          activity: activityOf(bot),
          attention: attentionOf?.(bot) ?? 0,
          active: activeRosterKeys.has(botRosterKey(bot))
        }))

  // Attention-first sort: flagged bots top their band but a pin is still the
  // outer band — the user's own filing never loses to a notification count.
  const compareRows = attentionOf
    ? (
        a: { activity: number; attention?: number; pinned: boolean },
        b: { activity: number; attention?: number; pinned: boolean }
      ) => Number(b.pinned) - Number(a.pinned) || (b.attention ?? 0) - (a.attention ?? 0) || b.activity - a.activity
    : undefined

  const rosterRows = sortGroupRosterRows([...botRows, ...groupRows], groupRooms, compareRows)
  const sortedGroupRows = sortGroupRosterRows(groupRows, groupRooms, compareRows)
  const gatewaySections = rosterGatewaySections(botRows, gatewayOptions, gatewayFilter)
  const showGatewaySections = gatewaySections.sectioned && botRows.length > 0

  return {
    activeSourceRoster,
    hiddenBots,
    visibleRoster,
    filteredHiddenBots,
    groupNames,
    rosterRows,
    sortedGroupRows,
    gatewaySections,
    showGatewaySections
  }
}

interface RosterPresentationInput {
  rowKindFilter: RosterKindFilter
  activityFilter: RosterActivityFilter
  gatewayFilter: string
  query: string
  filteredHiddenBots: RosterRow[]
  hiddenBots: RosterRow[]
  hiddenExpanded: boolean
  roster: RosterRow[]
  groupNames: string[]
  visibleRoster: RosterRow[]
  gatewayOptions: ReturnType<typeof rosterGatewayOptions>
}

export function deriveRosterPresentation({
  rowKindFilter,
  activityFilter,
  gatewayFilter,
  query,
  filteredHiddenBots,
  hiddenBots,
  hiddenExpanded,
  roster,
  groupNames,
  visibleRoster,
  gatewayOptions
}: RosterPresentationInput) {
  const activeFilterCount =
    (rowKindFilter === 'all' ? 0 : 1) + (activityFilter === 'all' ? 0 : 1) + (gatewayFilter === 'all' ? 0 : 1)

  const hasRosterConstraint = Boolean(query.trim()) || activeFilterCount > 0
  const matchingHiddenBots = rowKindFilter === 'groups' ? [] : filteredHiddenBots
  const showHiddenSection = hiddenBots.length > 0 && (!hasRosterConstraint || matchingHiddenBots.length > 0)
  const showHiddenRows = hiddenExpanded || hasRosterConstraint
  const rosterItemCount = roster.length + groupNames.length

  const allBotsHidden =
    !hasRosterConstraint && visibleRoster.length === 0 && groupNames.length === 0 && hiddenBots.length > 0

  const showRosterSearch =
    gatewayOptions.length > 1 || rosterItemCount >= BOT_ROSTER_SEARCH_THRESHOLD || Boolean(query.trim())

  const showRosterFilters =
    gatewayOptions.length > 1 ||
    groupNames.length > 0 ||
    rosterItemCount >= BOT_ROSTER_SEARCH_THRESHOLD ||
    activeFilterCount > 0

  const showRosterTools = showRosterSearch || showRosterFilters

  const hiddenGatewaySections = rosterGatewaySections(
    matchingHiddenBots.map((bot: RosterRow) => ({
      kind: 'bot',
      bot
    })),
    gatewayOptions,
    gatewayFilter
  )

  return {
    activeFilterCount,
    hasRosterConstraint,
    matchingHiddenBots,
    showHiddenSection,
    showHiddenRows,
    allBotsHidden,
    showRosterSearch,
    showRosterFilters,
    showRosterTools,
    hiddenGatewaySections
  }
}

export interface RosterSortSpec {
  /** Per-bot attention rollup; consulted only when `mode` is 'attention'. */
  attentionOf?: (bot: RosterRow) => number
  /** 'recent' (default) is pinned → activity desc; 'attention' inserts the
   *  rollup between the two bands; 'alpha' orders by display name inside
   *  each pin band. */
  mode?: RosterSortMode
}

/** What every sort comparator may need, computed once per call. */
interface RosterSortContext {
  activityOf: (bot: RosterRow) => number
  attentionOf: (bot: RosterRow) => number
  nameOf: (bot: RosterRow) => string
}

/** A new sort mode is one comparator here, one `RosterSortMode` member, and
 *  one i18n label — the pin band and activity tiebreak apply to all of them. */
const ROSTER_SORTS: Record<RosterSortMode, (a: RosterRow, b: RosterRow, ctx: RosterSortContext) => number> = {
  alpha: (a, b, ctx) => ctx.nameOf(a).localeCompare(ctx.nameOf(b)) || ctx.activityOf(b) - ctx.activityOf(a),
  attention: (a, b, ctx) => ctx.attentionOf(b) - ctx.attentionOf(a) || ctx.activityOf(b) - ctx.activityOf(a),
  recent: (a, b, ctx) => ctx.activityOf(b) - ctx.activityOf(a)
}

export function sortRosterBots(
  sourceWithSelectedOwner: RosterRow[],
  allMeta: Record<string, BotMeta>,
  sort?: RosterSortSpec
) {
  // Messaging-app order: most recent activity first, where "activity" is
  // the newest of (bot created, last message in any of its sessions). A
  // freshly created bot tops the list until another bot gets a message.
  // No special slot for the primary bot — it competes on recency too.
  const activityOf = (bot: RosterRow): number => {
    const created = botRosterMeta(bot, allMeta)?.created || bot.ui_meta?.['hermes-bots']?.created || 0
    const lastMsg = (botActivitySession(bot)?.last_active || 0) * 1000

    return Math.max(created, lastMsg)
  }

  // Pin is a source-qualified Desktop preference, not gateway profile state —
  // it stays the outer band under every sort mode.
  const isPinned = (bot: RosterRow): boolean => isBotPinned(bot, allMeta)
  const nameOf = (bot: RosterRow): string => displayName(bot, botRosterMeta(bot, allMeta)).toLowerCase()

  const ctx: RosterSortContext = {
    activityOf,
    attentionOf: sort?.attentionOf ?? (() => 0),
    nameOf
  }

  const comparator = ROSTER_SORTS[sort?.mode ?? 'recent'] ?? ROSTER_SORTS.recent

  const roster = sourceWithSelectedOwner.slice().sort((a, b) => {
    const pa = isPinned(a) ? 1 : 0
    const pb = isPinned(b) ? 1 : 0

    if (pa !== pb) {
      return pb - pa
    }

    return comparator(a, b, ctx)
  })

  return { roster, activityOf, isPinned }
}
