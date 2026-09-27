/**
 * D4 — stuck-work triage: the pure derivation behind the roster's top strip.
 *
 * One item per bot, first-wins in severity order: unreachable gateway,
 * recorded failure flag (relay delivery or other classified attention),
 * needs-input dot on the canonical chat, failed status item on the canonical
 * runtime, overdue routine. Every input is a store the roster already
 * subscribes to — the strip adds no polling of its own.
 */

import { nextRunOverdueMs } from '@hermes/plugin-sdk'
import type { SessionDotState } from '@hermes/plugin-sdk'

import { botRosterKey, botSelectionKey, botSourceStatus } from './data'
import { botCanonicalRuntimeId, botCanonicalSessionId } from './row-helpers'
import type { RosterRow, RoutineJob } from './types'

export type TriageKind = 'attention' | 'delivery' | 'needs-input' | 'overdue' | 'turn-failed' | 'unreachable'

export interface TriageItem {
  bot: RosterRow
  /** Free-text detail (the classified flag reason) for 'attention' items. */
  detail?: string
  key: string
  kind: TriageKind
}

export interface TriageSignals {
  /** `conn::<id>::<profile>` / selection-key → recorded failure flag. */
  attention: Record<string, { reason?: string } | null | undefined>
  /** `conn::<id>::<profile>` lanes with a relay delivery currently in flight. */
  relayInflight?: ReadonlySet<string>
  /** Dot state keyed by STORED session id. */
  dotById?: Record<string, SessionDotState | undefined>
  /** Composer status items keyed by session id (runtime or stored). */
  statusItems?: Record<string, readonly { state?: string }[] | undefined>
  /** Runtime→stored id bridge for canonical chats (see row-helpers). */
  storedByRuntime?: Readonly<Record<string, string>>
  /** Routine jobs already known per bot — keyed by roster key or bare name
   *  (the two shapes `useRoutines`' cache key takes). */
  jobs?: ReadonlyMap<string, readonly RoutineJob[]>
  activeConnectionId?: string
}

/** The attention-flag key ladder — same lookup order the row badge uses. */
function attentionFlag(bot: RosterRow, signals: TriageSignals) {
  const active = signals.activeConnectionId || 'local'

  return (
    signals.attention?.[botSelectionKey(bot) || ''] ||
    signals.attention?.[botRosterKey(bot)] ||
    signals.attention?.[`${bot?.connectionId || active}::${bot?.name || 'default'}`] ||
    null
  )
}

export function deriveTriageItems(bots: readonly RosterRow[], signals: TriageSignals): TriageItem[] {
  const items: TriageItem[] = []

  for (const bot of bots) {
    if (!bot || bot.ghost) {
      continue
    }

    const key = botRosterKey(bot)
    const add = (kind: TriageKind, detail?: string) => items.push({ bot, detail, key, kind })

    // 1. Gateway the bot lives on is unreachable — nothing else can run.
    if (botSourceStatus(bot).available === false) {
      add('unreachable')

      continue
    }

    // 2. A recorded failure flag — a relay delivery that just bounced gets
    //    the delivery label (lane still in flight or flag keyed as a lane);
    //    anything else keeps its classified reason.
    const flag = attentionFlag(bot, signals)

    if (flag) {
      const lane = `${bot?.connectionId || signals.activeConnectionId || 'local'}::${bot?.name || 'default'}`

      add(signals.relayInflight?.has(lane) ? 'delivery' : 'attention', String(flag?.reason || '').trim() || undefined)

      continue
    }

    // 3. Needs-input dot on the canonical stored session.
    const storedId = botCanonicalSessionId(bot)

    if (storedId && signals.dotById?.[storedId] === 'needs-input') {
      add('needs-input')

      continue
    }

    // 4. Failed status item on the canonical chat (runtime or stored id).
    const runtimeId = botCanonicalRuntimeId(bot, signals.storedByRuntime || {})

    const rows =
      (runtimeId ? signals.statusItems?.[runtimeId] : undefined) || (storedId ? signals.statusItems?.[storedId] : undefined)

    if (rows?.some(item => item?.state === 'failed')) {
      add('turn-failed')

      continue
    }

    // 5. A routine whose window has passed.
    const jobs = signals.jobs?.get(botRosterKey(bot)) || signals.jobs?.get(bot?.name || '') || []

    if (jobs.some(job => job?.enabled !== false && job?.state !== 'paused' && nextRunOverdueMs(job) !== null)) {
      add('overdue')
    }
  }

  return items
}
