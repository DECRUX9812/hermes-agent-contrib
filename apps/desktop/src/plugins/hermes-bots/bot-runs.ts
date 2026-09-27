/**
 * The Runs feed (revamp A3): a read-only roll-up of the activity signals a
 * bot's pane already observes — canonical-chat turns, routine (cron) runs,
 * relay deliveries and group rounds.
 *
 * The derivation is pure: the section component subscribes the atoms once
 * and passes plain data in, so the feed contract is testable without a
 * renderer and adds no per-row subscriptions.
 */

import type { GroupActivityEntry } from './group-activity'
import { groupMemberKey } from './group-membership'
import { stripPreviewMarkdown } from './labels'
import { A2A_PREFIX_RE, previewKind } from './row-helpers'
import type { BotMeta, GroupChat, GroupMember, RosterRow, RoutineJob } from './types'

export type BotRunKind = 'chat' | 'group' | 'relay' | 'routine'

export type BotRunStatus = 'attention' | 'failed' | 'ok' | 'running'

export interface BotRun {
  /** ms epoch, the card's sort key. */
  at: number
  /** Turn span where a start/end pair exists in the signal (group rounds). */
  durationMs?: number
  /** Room name — group cards jump to the room. */
  group?: string
  id: string
  /** Routine job id — routine cards jump to the job's detail dialog. */
  jobId?: string
  kind: BotRunKind
  status: BotRunStatus
  /** One-line outcome: message preview, error first line, reply snippet. */
  summary: string
  /** Raw routine title (bot tag stripped); the component localizes the rest. */
  title: string
}

export interface BotRunSignals {
  /** The resolved `$botAttention` entry for this bot's keys, if any. */
  attention?: { at?: number; message?: string; reason?: null | string } | null
  bot: RosterRow | null | undefined
  /** Whether the focused chat turn belongs to this bot. */
  chatBusy?: boolean
  groupActivity?: null | Record<string, { events?: GroupActivityEntry[] }>
  /** Routine jobs already scoped to this bot by `selectRoutineJobs`. */
  jobs?: null | RoutineJob[]
  meta?: BotMeta | null
  now?: number
  rooms?: null | Record<string, GroupChat | undefined>
}

export const BOT_RUNS_LIMIT = 8

/** The tag the gateway prefixes onto bot-scoped cron jobs (`BOT_TAG_RE` in
 *  cron.tsx is the write side). */
const ROUTINE_BOT_TAG_RE = /^\[bot:([a-z0-9][a-z0-9_-]*)\]\s*/i

const GROUP_ROUND_FAILURES = new Set(['failed', 'timed-out'])

const GROUP_ROUND_LIVE = new Set(['queued', 'working'])

function firstLine(text: unknown): string {
  return String(text || '')
    .split('\n')[0]
    .trim()
}

export function routineRunTitle(job: RoutineJob | null | undefined): string {
  return String(job?.name || '')
    .replace(ROUTINE_BOT_TAG_RE, '')
    .trim()
}

/** The freshest signal per membered room: a live event while a round is in
 *  flight, a failure the log never captured, otherwise the member's last
 *  authored reply. One card per room keeps the feed cheap and honest. */
function groupRunCard(
  bot: RosterRow,
  memberKey: string,
  name: string,
  room: GroupChat,
  events: GroupActivityEntry[]
): BotRun | null {
  const memberEvents = events.filter(event => event.member === memberKey)
  const lastEvent = memberEvents[memberEvents.length - 1]

  if (lastEvent && GROUP_ROUND_LIVE.has(lastEvent.kind)) {
    return {
      id: `group:${name}:live:${lastEvent.at}`,
      kind: 'group',
      at: Number(lastEvent.at || 0),
      status: 'running',
      title: name,
      summary: lastEvent.preview || '',
      group: name
    }
  }

  const failure = [...memberEvents].reverse().find(event => GROUP_ROUND_FAILURES.has(event.kind))
  const log = Array.isArray(room.log) ? room.log : []
  const replies = log.filter(entry => entry?.from?.kind === 'member' && entry.from.name === bot.name)
  const lastReply = replies[replies.length - 1]

  if (failure && Number(failure.at || 0) >= Number(lastReply?.at || 0)) {
    // Working → terminal pairing is the only duration the feed can prove.
    const start = [...memberEvents]
      .reverse()
      .find(event => GROUP_ROUND_LIVE.has(event.kind) && Number(event.at || 0) <= Number(failure.at || 0))

    return {
      id: `group:${name}:fail:${failure.at}`,
      kind: 'group',
      at: Number(failure.at || 0),
      durationMs: start ? Math.max(0, Number(failure.at) - Number(start.at)) : undefined,
      status: 'failed',
      title: name,
      summary: failure.reason || failure.preview || '',
      group: name
    }
  }

  if (!lastReply) {
    return null
  }

  return {
    id: `group:${name}:reply:${lastReply.at}`,
    kind: 'group',
    at: Number(lastReply.at || 0),
    status: 'ok',
    title: name,
    summary: stripPreviewMarkdown(lastReply.text) || '',
    group: name
  }
}

export function deriveBotRuns(signals: BotRunSignals, limit = BOT_RUNS_LIMIT): BotRun[] {
  const bot = signals.bot
  const runs: BotRun[] = []

  if (!bot?.name) {
    return runs
  }

  const canonical = bot.canonical_session
  const lastActive = Number(canonical?.last_active || 0)

  // Canonical identity is the ONLY chat signal the feed may read — never
  // last_session recency (src/AGENTS.md). An A2A-prefixed preview means the
  // latest canonical activity was an inbound delivery, so it reads as a
  // relay card rather than a chat turn.
  if (lastActive > 0) {
    const preview = String(canonical?.preview || '')
    const { fromBot } = previewKind(preview)
    const summary = stripPreviewMarkdown(preview.replace(A2A_PREFIX_RE, '').trim()) || ''

    runs.push({
      id: `${fromBot ? 'relay' : 'chat'}:${lastActive}`,
      kind: fromBot ? 'relay' : 'chat',
      at: lastActive * 1000,
      status: signals.chatBusy ? 'running' : 'ok',
      title: '',
      summary: fromBot ? `@${fromBot}: ${summary}` : summary
    })
  }

  if (signals.attention && Number(signals.attention.at) > 0) {
    runs.push({
      id: `attention:${signals.attention.at}`,
      kind: 'relay',
      at: Number(signals.attention.at),
      status: 'attention',
      title: '',
      summary: firstLine(signals.attention.message) || signals.attention.reason || ''
    })
  }

  for (const job of Array.isArray(signals.jobs) ? signals.jobs : []) {
    const at = Date.parse(String(job?.last_run_at || ''))

    if (!Number.isFinite(at)) {
      continue
    }

    const status = job.last_status === 'ok' ? 'ok' : job.last_status ? 'failed' : 'ok'

    runs.push({
      id: `routine:${job.job_id}:${at}`,
      kind: 'routine',
      at,
      status,
      title: routineRunTitle(job),
      summary: status === 'ok' ? '' : firstLine(job.last_fire_error) || firstLine(job.last_delivery_error),
      jobId: job.job_id
    })
  }

  const memberKey = groupMemberKey(bot as GroupMember)
  const membered = new Set(Array.isArray(signals.meta?.groups) ? signals.meta.groups : [])

  for (const [name, room] of Object.entries(signals.rooms || {})) {
    if (!room || room.tombstone) {
      continue
    }

    const seated = (room.members || []).some(member => groupMemberKey(member) === memberKey)

    if (!seated && !membered.has(name)) {
      continue
    }

    const card = groupRunCard(bot, memberKey, name, room, signals.groupActivity?.[name]?.events || [])

    if (card) {
      runs.push(card)
    }
  }

  runs.sort((a, b) => b.at - a.at)

  return runs.slice(0, limit)
}
