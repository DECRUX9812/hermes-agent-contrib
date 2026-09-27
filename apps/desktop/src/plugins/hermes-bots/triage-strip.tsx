/**
 * D4 — the stuck-work strip: a banner at the top of the roster naming the
 * bots that need a look right now. Derived purely from stores the roster
 * already subscribes to (see triage.ts); clicking an item opens the bot.
 */

import { cn, Codicon, host, queryClient, useValue } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { ROUTINES_QUERY_KEY } from './cron'
import { $botAttention, $botMeta, botRosterKey } from './data'
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

  return (
    <div
      className="mx-2 mb-1 flex flex-col gap-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5"
      data-testid="bot-triage-strip"
    >
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        <Codicon name="warning" />
        {b.triage.title}
      </div>
      {items.map(item => {
        const meta = botRosterMeta(item.bot, allMeta)
        const { shape, color, image } = botAppearance(item.bot, meta)
        const name = displayName(item.bot, meta)

        return (
          <button
            className={cn(
              'flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left',
              'text-[0.75rem] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'
            )}
            data-testid={`bot-triage:${item.key}`}
            key={item.key}
            onClick={() => onOpen(item.bot)}
            title={b.triage.openItem(name)}
            type="button"
          >
            <BotFace color={avatarColor(color, item.bot.name)} image={image} name={item.bot.name} shape={shape} size={14} />
            <Codicon name={TRIAGE_GLYPHS[item.kind]} />
            <span className="min-w-0 flex-1 truncate">{triageLabel(b, item, name)}</span>
          </button>
        )
      })}
    </div>
  )
}
