/**
 * A1 + A2 — the roster's ops-surface signals.
 *
 * A1 — live status line (`botLiveStatus` / `useBotLiveStatus`): what the bot
 * is doing RIGHT NOW, assembled from signals that actually expire — the
 * canonical Bot Chat's status dot (needs-input / working / stalled /
 * background), the in-flight routine under its `[bot:<slug>]` tag, an active
 * group round, a live delegated worker. A clock is never one of them: a
 * finished turn leaves `last_active` behind forever, so recency can only ever
 * have meant "happened", never "happening". Signals exhaust → honest 'idle'
 * when the source is reachable, 'unknown' when it isn't — never a spinner
 * that lies. A backend that reports no turn state simply yields a quiet dot
 * map and the row falls through to routine/worker signals, then the floor.
 *
 * A2 — attention rollup (`botAttentionCount` / `useBotAttention`): one number
 * per bot = the attention-inbox items and unread/needs-input dots attributed
 * to its PROVEN owner scope (`conn:<id>::<profile>` / bare profile), plus the
 * recorded failure flag. Owner attribution is deliberate: two connections can
 * both run a profile named `ops`, and each badge must count only its own
 * bot's sessions — never the ambient gateway's guess.
 *
 * Plus `RosterSortMode` — the roster's sort preference ('recent' today,
 * 'attention' floats bots with open items to the top of their band; a pin
 * always outranks both).
 */

import { atom, host, jobState, useValue } from '@hermes/plugin-sdk'
import type { CronJob, PluginSessionOwner, SessionDotState } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

import { $botAttention, botRosterKey, botSelectionKey, botSourceStatus } from './data'
import { $activeGroupMemberKeys } from './group-presence'
import type { BotsText } from './i18n'
import { botCanonicalRuntimeId, botCanonicalSessionId, workerActiveAt } from './row-helpers'
import { getPluginCtx } from './shared'
import type { RosterRow } from './types'

// ── A1: live status ──────────────────────────────────────────────────────────

export type BotLiveKind =
  'background' | 'delegated' | 'group' | 'idle' | 'needs-input' | 'routine' | 'stalled' | 'unknown' | 'working'

export interface BotLiveStatus {
  /** Tool label or routine title, when the kind carries one. */
  detail?: string
  kind: BotLiveKind
}

export interface BotLiveSignals {
  /** Status dot of the canonical Bot Chat — the row's session by construction. */
  dot?: SessionDotState
  /** A live group round includes this bot. */
  group?: boolean
  /** The bot's source is reachable (false → the quiet floor is 'unknown'). */
  reachable?: boolean
  /** Titles of this bot's in-flight `[bot:<slug>]` routines. */
  routines?: readonly string[]
  /** The tool a running item on the canonical chat is executing, if known. */
  tool?: string
  /** A delegated kanban/tool worker heartbeat is live. */
  worker?: boolean
}

/** What the row reports, in the order the user should see it: a blocked turn
 *  first, the live turn next, then background machinery, then the floor. */
export function botLiveStatus(signals: BotLiveSignals): BotLiveStatus {
  if (signals.dot === 'needs-input') {
    return { kind: 'needs-input' }
  }

  if (signals.dot === 'working' || signals.dot === 'stalled') {
    return { detail: signals.tool || undefined, kind: signals.dot }
  }

  const routine = (signals.routines || []).find(title => title.trim())

  if (routine) {
    return { detail: routine, kind: 'routine' }
  }

  if (signals.group) {
    return { kind: 'group' }
  }

  if (signals.dot === 'background') {
    return { kind: 'background' }
  }

  if (signals.worker) {
    return { kind: 'delegated' }
  }

  return { kind: signals.reachable === false ? 'unknown' : 'idle' }
}

export function botLiveStatusLabel(status: BotLiveStatus, c: BotsText['roster']): string {
  switch (status.kind) {
    case 'needs-input':
      return c.needsInput

    case 'working':
      return status.detail ? c.liveWorkingTool(status.detail) : c.liveWorking

    case 'stalled':
      return c.liveStalled

    case 'routine':
      return status.detail ? c.liveRoutine(status.detail) : c.liveRoutineUnnamed

    case 'group':
      return c.liveGroup

    case 'background':
      return c.liveBackground

    case 'delegated':
      return c.liveDelegated

    case 'idle':
      return c.liveIdle

    case 'unknown':
      return c.statusUnknown
  }
}

/** `Running Inbox sweep`-shaped label, so 'working' never claims a name. */
const ROUTINE_BOT_TAG = /^\[bot:([a-z0-9][a-z0-9_-]*)\]\s*/i

function routineOwnerName(job: Pick<CronJob, 'name'>): null | string {
  return (
    String(job?.name || '')
      .match(ROUTINE_BOT_TAG)?.[1]
      ?.toLowerCase() ?? null
  )
}

function routineDisplayTitle(job: Pick<CronJob, 'name'>): string {
  return String(job?.name || '')
    .replace(ROUTINE_BOT_TAG, '')
    .trim()
}

/** Only jobs the bot's own tag claims AND the scheduler marks running — an
 *  untagged job is never guessed into a bot's row, and a finished run
 *  leaves no residue. An empty/missing jobs list (scope not loaded, remote
 *  scope uncovered) degrades to 'no routine', honest by construction. */
export function runningRoutineTitles(jobs: readonly CronJob[] | undefined, bot: Pick<RosterRow, 'name'>): string[] {
  const name = String(bot?.name || '')
    .trim()
    .toLowerCase()

  if (!name) {
    return []
  }

  return (jobs || [])
    .filter(job => routineOwnerName(job) === name && jobState(job) === 'running')
    .map(routineDisplayTitle)
    .filter(Boolean)
}

function liveTool(items: readonly { currentTool?: string; state: string }[] | undefined): string | undefined {
  return items?.find(item => item.state === 'running' && item.currentTool)?.currentTool
}

export function useBotLiveStatus(bot: RosterRow): BotLiveStatus {
  const dotById = useValue(host.state.dotStateBySession)
  const statusItems = useValue(host.state.statusItemsBySession)
  const storedByRuntime = useValue(host.state.storedSessionByRuntimeId)
  const cronJobs = useValue(host.state.cronJobs)
  const groupKeys = useValue($activeGroupMemberKeys)

  const canonicalId = botCanonicalSessionId(bot)

  const runtimeId = useMemo(
    () => botCanonicalRuntimeId(bot, storedByRuntime || {}) ?? undefined,
    [bot, storedByRuntime]
  )

  const items = runtimeId ? statusItems?.[runtimeId] : undefined

  return botLiveStatus({
    dot: canonicalId ? dotById?.[canonicalId] : undefined,
    group: groupKeys.has(botRosterKey(bot)),
    reachable: botSourceStatus(bot).available,
    routines: runningRoutineTitles(cronJobs, bot),
    tool: liveTool(items),
    worker: workerActiveAt(bot)
  })
}

// ── A2: attention rollup ─────────────────────────────────────────────────────

const ownerNameKey = (value: string | null | undefined): string =>
  String(value || '')
    .trim()
    .toLowerCase()

/** Every scope key this bot's sessions can publish attention under: the
 *  `conn:<id>::<name>` route key (its own connection, or the ambient one for
 *  an unscoped row) plus the bare profile name — but only for local/unscoped
 *  bots, since a bare-owner session can only live on the primary socket. */
export function botAttentionKeys(bot: Pick<RosterRow, 'connectionId' | 'name'>, activeConnectionId: string): string[] {
  const name = String(bot?.name || 'default').trim() || 'default'
  const connectionId = String(bot?.connectionId || '').trim()
  const connection = connectionId || String(activeConnectionId || '').trim()
  const keys = new Set<string>()

  if (connection) {
    keys.add(`conn:${connection}::${name}`)
  }

  if (!connectionId || connectionId === 'local') {
    keys.add(name)
  }

  return [...keys]
}

/** Does a proven session owner name THIS bot? Profile must match on
 *  `profile` or `targetProfile`, and connection must match: a bare owner
 *  (connection-free route) only ever resolves for unscoped/local bots. */
export function sessionOwnerMatchesBot(
  owner: null | PluginSessionOwner | undefined,
  bot: Pick<RosterRow, 'connectionId' | 'name'>,
  activeConnectionId: string
): boolean {
  if (!owner) {
    return false
  }

  const name = ownerNameKey(bot?.name) || 'default'
  const profiles = [owner.profile, owner.targetProfile].map(ownerNameKey)

  if (!profiles.includes(name)) {
    return false
  }

  const ownerConnection = ownerNameKey(owner.connectionId)
  const botConnection = ownerNameKey(bot?.connectionId) || ownerNameKey(activeConnectionId)

  if (!ownerConnection) {
    return !botConnection || botConnection === 'local'
  }

  return ownerConnection === botConnection
}

export interface BotAttentionSignals {
  activeConnectionId: string
  /** Dot on the hidden canonical chat — counts when the owner ladder misses it. */
  canonicalDot?: SessionDotState
  /** True when the canonical chat's owner resolved AND named this bot. */
  canonicalOwnedByBot: boolean
  /** The recorded needs-attention flag (background failure, group turn, …). */
  flagged: boolean
  /** `conn:<id>::<profile>` / bare-profile keyed counts from core. */
  ownerCounts: Record<string, number>
}

export function botAttentionCount(bot: Pick<RosterRow, 'connectionId' | 'name'>, signals: BotAttentionSignals): number {
  let count = 0

  for (const key of botAttentionKeys(bot, signals.activeConnectionId)) {
    count += signals.ownerCounts[key] || 0
  }

  const quietAttention = signals.canonicalDot === 'unread' || signals.canonicalDot === 'needs-input'

  if (quietAttention && !signals.canonicalOwnedByBot) {
    count += 1
  }

  if (signals.flagged) {
    count += 1
  }

  return count
}

export interface BotAttention {
  count: number
  /** The recorded flag's reason (drives the badge tooltip when set). */
  reason?: string
}

/** Per-row rollup — owner-scoped counts plus the canonical chat's quiet dot
 *  plus the recorded flag. The canonical-dot leg exists for the window where
 *  the hidden chat finished out of view and no provenance stamped its owner. */
export function useBotAttention(bot: RosterRow): BotAttention {
  const ownerCounts = useValue(host.state.attentionCountsByOwner)
  const dotById = useValue(host.state.dotStateBySession)
  const attentionMap = useValue($botAttention)
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  const canonicalId = botCanonicalSessionId(bot)

  const flag =
    attentionMap?.[botSelectionKey(bot) || ''] ||
    attentionMap?.[botRosterKey(bot)] ||
    attentionMap?.[`${bot?.connectionId || activeConnectionId}::${bot?.name || 'default'}`] ||
    null

  const count = botAttentionCount(bot, {
    activeConnectionId,
    canonicalDot: canonicalId ? dotById?.[canonicalId] : undefined,
    canonicalOwnedByBot: Boolean(
      canonicalId && sessionOwnerMatchesBot(host.sessionOwner?.(canonicalId), bot, activeConnectionId)
    ),
    flagged: Boolean(flag),
    ownerCounts: ownerCounts || {}
  })

  return { count, reason: flag?.reason }
}

/** Roster-wide counts keyed by `botRosterKey` — the attention-first sort's
 *  input. Shares the same pure rollup the row badge reads, so a badge and a
 *  sort position can never disagree. */
export function useRosterAttentionCounts(roster: readonly RosterRow[]): ReadonlyMap<string, number> {
  const ownerCounts = useValue(host.state.attentionCountsByOwner)
  const dotById = useValue(host.state.dotStateBySession)
  const attentionMap = useValue($botAttention)
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  return useMemo(() => {
    const counts = new Map<string, number>()

    for (const bot of roster) {
      const canonicalId = botCanonicalSessionId(bot)

      const flagged = Boolean(
        attentionMap?.[botSelectionKey(bot) || ''] ||
        attentionMap?.[botRosterKey(bot)] ||
        attentionMap?.[`${bot?.connectionId || activeConnectionId}::${bot?.name || 'default'}`]
      )

      const count = botAttentionCount(bot, {
        activeConnectionId,
        canonicalDot: canonicalId ? dotById?.[canonicalId] : undefined,
        canonicalOwnedByBot: Boolean(
          canonicalId && sessionOwnerMatchesBot(host.sessionOwner?.(canonicalId), bot, activeConnectionId)
        ),
        flagged,
        ownerCounts
      })

      if (count > 0) {
        counts.set(botRosterKey(bot), count)
      }
    }

    return counts
  }, [activeConnectionId, attentionMap, dotById, ownerCounts, roster])
}

// ── E2: health badge ─────────────────────────────────────────────────────────
// A small chip on the row when the bot is unhealthy, derived from signals the
// renderer already holds — nothing polls: the owning gateway's reachability,
// the recorded needs-attention flag (classified relay-delivery and group-turn
// failures), and a failed work item on the canonical chat's live runtime.

export type BotHealthKind = 'attention' | 'ok' | 'unreachable'

export interface BotHealth {
  /** The classified attention reason when the flag set one; the component
   *  maps it through `botAttentionHint` for the tooltip. */
  detail?: string
  kind: BotHealthKind
}

export interface BotHealthSignals {
  /** A work item on the canonical chat's runtime ended in 'failed'. */
  lastRunFailed?: boolean
  /** The owning gateway can't be reached right now (missing or errored). */
  reachable?: boolean
  /** The recorded flag's classified reason, when one is set. */
  reason?: null | string
}

/** Priority the row shows: an unreachable source outranks every in-band
 *  signal — a bot whose backend is gone cannot report a failure itself. */
export function botHealth(signals: BotHealthSignals): BotHealth {
  if (signals.reachable === false) {
    return { kind: 'unreachable' }
  }

  if (signals.reason) {
    return { detail: signals.reason, kind: 'attention' }
  }

  if (signals.lastRunFailed) {
    return { detail: 'last_run_failed', kind: 'attention' }
  }

  return { kind: 'ok' }
}

export function useBotHealth(bot: RosterRow): BotHealth {
  const attentionMap = useValue($botAttention)
  const dotById = useValue(host.state.dotStateBySession)
  const statusItems = useValue(host.state.statusItemsBySession)
  const storedByRuntime = useValue(host.state.storedSessionByRuntimeId)
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  const flag =
    attentionMap?.[botSelectionKey(bot) || ''] ||
    attentionMap?.[botRosterKey(bot)] ||
    attentionMap?.[`${bot?.connectionId || activeConnectionId}::${bot?.name || 'default'}`]

  const canonicalId = botCanonicalSessionId(bot)
  const runtimeId = canonicalId ? botCanonicalRuntimeId(bot, storedByRuntime || {}) : null
  const items = runtimeId ? statusItems?.[runtimeId] : undefined

  return botHealth({
    lastRunFailed: Boolean(items?.some(item => item.state === 'failed')),
    reachable: botSourceStatus(bot).available,
    // A stalled canonical turn is a health signal too — the bot is mid-turn
    // but nothing has moved, so surface it under the same chip.
    reason: flag?.reason || (canonicalId && dotById?.[canonicalId] === 'stalled' ? 'stalled' : null)
  })
}

// ── roster sort preference ───────────────────────────────────────────────────

export type RosterSortMode = 'alpha' | 'attention' | 'recent'

/** Roster order is a per-window presentation choice (like the activity
 *  filters beside it); it persists under plugin storage so a restarted
 *  window keeps the user's triage view. */
const ROSTER_SORT_STORAGE_KEY = 'roster-sort-v1'

export const $rosterSortMode = atom<RosterSortMode>('recent')

export function hydrateRosterSortMode(): void {
  try {
    // TODO(bot-mode-types): PluginStorage.get(key, fallback) requires the fallback;
    // Bot Mode reads omit it — same TODO as the other hydrated prefs.
    // @ts-expect-error typed as written rather than changing the call.
    Promise.resolve(getPluginCtx()?.storage?.get?.(ROSTER_SORT_STORAGE_KEY))
      .then(value => {
        if (value === 'alpha' || value === 'attention' || value === 'recent') {
          $rosterSortMode.set(value)
        }
      })
      .catch(() => undefined)
  } catch {
    /* no storage — 'recent' stays */
  }
}

export function setRosterSortMode(mode: RosterSortMode): void {
  $rosterSortMode.set(mode)

  try {
    void getPluginCtx()?.storage?.set?.(ROSTER_SORT_STORAGE_KEY, mode)
  } catch {
    /* persistence is best-effort — the choice applies either way */
  }
}
