/**
 * D4 — the stuck-work strip: a banner at the top of the roster naming the
 * bots that need a look right now. Derived purely from stores the roster
 * already subscribes to (see triage.ts); clicking an item opens the bot.
 */

import { cn, Codicon, host, queryClient, useValue } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { ROUTINES_QUERY_KEY } from './cron'
import { $botAttention, $botMeta } from './data'
import { useBots } from './i18n'
import type { BotsText } from './i18n'
import { displayName } from './labels'
import { $relayInflight } from './relay'
import { botRosterMeta } from './routing'
import { deriveTriageItems } from './triage'
import type { TriageItem, TriageSignals } from './triage'
import type { RosterRow, RoutineJob } from './types'

function triageLabel(b: BotsText, item: TriageItem, name: string): string {
  switch (item.kind) {
    case 'unreachable':
      return b.triage.unreachable(name)

    case 'delivery':
      return b.triage.deliveryFailed(name)

    case 'attention':
      return b.triage.attention(name, item.detail || '')

    case 'needs-input':
      return b.triage.needsInput(name)

    case 'turn-failed':
      return b.triage.turnFailed(name)

    case 'overdue':
      return b.triage.routineOverdue(name)

    default:
      return name
  }
}

const TRIAGE_GLYPHS: Record<TriageItem['kind'], string> = {
  attention: 'warning',
  delivery: 'mail',
  'needs-input': 'comment-discussion',
  overdue: 'watch',
  'turn-failed': 'error',
  unreachable: 'plug'
}

/** What the row's button says: what you are about to do, by what the bot needs. */
const TRIAGE_ACTION: Record<TriageItem['kind'], (b: BotsText) => string> = {
  attention: b => b.triage.actionReview,
  delivery: b => b.triage.actionOpen,
  'needs-input': b => b.triage.actionAnswer,
  overdue: b => b.triage.actionOpen,
  'turn-failed': b => b.triage.actionReview,
  unreachable: b => b.triage.actionOpen
}

export function TriageStrip({
  bots,
  jobs,
  onOpen
}: {
  bots: readonly RosterRow[]
  jobs?: ReadonlyMap<string, readonly RoutineJob[]>
  onOpen: (bot: RosterRow) => void
}) {
  const b = useBots()
  const allMeta = useValue($botMeta)
  const attention = useValue($botAttention)
  const dotById = useValue(host.state.dotStateBySession)
  const statusItems = useValue(host.state.statusItemsBySession)
  const storedByRuntime = useValue(host.state.storedSessionByRuntimeId)
  const relayInflight = useValue($relayInflight)
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  // Routine jobs ride the routines dialog's cache — the strip never issues
  //  cron RPCs of its own, it reads whatever the view already fetched.
  const cachedJobs = useMemo(() => {
    const map = new Map<string, readonly RoutineJob[]>()

    for (const [key, data] of queryClient.getQueriesData<{ jobs?: RoutineJob[] }>({
      queryKey: ROUTINES_QUERY_KEY
    })) {
      const ownerKey = Array.isArray(key) ? String(key[2] || '') : ''

      if (ownerKey && Array.isArray(data?.jobs)) {
        map.set(ownerKey, data.jobs)
      }
    }

    return map
    // Re-read whenever any watched store moves; the cache itself isn't a store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attention, dotById, statusItems])

  const items = useMemo(() => {
    const signals: TriageSignals = {
      attention: attention || {},
      activeConnectionId,
      dotById,
      jobs: jobs || cachedJobs,
      relayInflight: relayInflight || new Set(),
      statusItems,
      storedByRuntime
    }

    return deriveTriageItems(bots, signals)
  }, [activeConnectionId, attention, bots, cachedJobs, dotById, jobs, relayInflight, statusItems, storedByRuntime])

  if (!items.length) {
    return null
  }

  // Revamp "Needs you": a quiet section, not an alarm banner — the amber
  // count carries the urgency, each row names the bot and the one thing it
  // needs, and its button says what you are about to do.
  return (
    <section className="mb-1 px-2" data-testid="bot-triage-strip">
      <div className="flex items-center justify-between px-1 pt-1 pb-1.5">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-(--ui-text-quaternary)">
          {b.triage.title}
        </span>
        <span className="rounded-full bg-amber-500/15 px-1.5 text-[0.625rem] font-semibold tabular-nums text-amber-700 dark:text-amber-300">
          {items.length}
        </span>
      </div>
      <div className="grid gap-0.5 rounded-lg bg-amber-500/[0.06] p-1">
        {items.map(item => {
          const meta = botRosterMeta(item.bot, allMeta)
          const { shape, color, image } = botAppearance(item.bot.name, meta)
          const name = displayName(item.bot, meta)

          return (
            <button
              aria-label={b.triage.openItem(name)}
              className={cn(
                'group/triage flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left',
                'hover:bg-(--chrome-action-hover)'
              )}
              data-testid={`bot-triage:${item.key}`}
              key={item.key}
              onClick={() => onOpen(item.bot)}
              type="button"
            >
              <span className="shrink-0 rounded-md ring-1 ring-amber-500/50">
                <BotFace
                  color={avatarColor(color, item.bot.name)}
                  image={image}
                  name={item.bot.name}
                  shape={shape}
                  size={26}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-foreground">
                  <Codicon
                    className="shrink-0 text-amber-600 dark:text-amber-300"
                    name={TRIAGE_GLYPHS[item.kind]}
                    size="0.7rem"
                  />
                  <span className="truncate">{triageLabel(b, item, name)}</span>
                </span>
                <span className="block truncate text-[0.6875rem] text-(--ui-text-tertiary)">{name}</span>
              </span>
              <span className="shrink-0 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-chat-bubble-background) px-1.5 py-0.5 text-[0.6875rem] font-medium text-(--ui-text-secondary) group-hover/triage:border-(--ui-stroke-primary) group-hover/triage:text-foreground">
                {TRIAGE_ACTION[item.kind](b)}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
