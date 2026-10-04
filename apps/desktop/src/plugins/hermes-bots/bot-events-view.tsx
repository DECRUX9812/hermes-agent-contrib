/**
 * Inbound event cards (bot-mode G5): a compact strip inside a bot's canonical
 * chat listing the external events bound to that bot — mailbox notes
 * addressed to it (tasks, webhook/git-style kinds), relay deliveries, and
 * routine completions. Each card carries a provenance icon, a one-line
 * summary, and an optional link that opens the thing it came from.
 *
 * Everything here is a read-only projection of signals the renderer already
 * holds: `useMailbox` rides the existing `bots_mailbox.*` RPC door, the relay
 * lane + attention flag are atoms the roster already subscribes, and routine
 * jobs come from `cron.manage` via `useRoutineJobsForBot`. No new RPC, no
 * stored session ids — the bot is resolved by canonical_session match, the
 * same seam the empty-state hero and the composer gate use.
 */

import { cn, Codicon, host, Tip, useSessionView, useValue } from '@hermes/plugin-sdk'
import { useMemo } from 'react'

import { type BotInboundEvent, deriveInboundEvents } from './bot-events'
import { botForStoredId } from './chat-empty'
import { useRoutineJobsForBot } from './cron'
import {
  $botAttention,
  $lastRoster,
  botAttentionHint,
  botHandle,
  botRosterKey,
  botSelectionKey,
  cachedUnionRoster
} from './data'
import { openGroupChat } from './group-chat-view'
import { useBots } from './i18n'
import { useMailbox } from './mailbox'
import { $relayInflight, relayLaneKey } from './relay'
import { ID } from './shared'

function eventGlyphClass(status: BotInboundEvent['status']): string {
  switch (status) {
    case 'attention':
      return 'text-amber-600 dark:text-amber-300'

    case 'failed':
      return 'text-destructive'

    case 'running':
      return 'text-(--ui-accent)'

    default:
      return 'text-(--ui-text-tertiary)'
  }
}

/** The strip. Mounted by the `composer.top` area inside the chat surface;
 *  answers for itself — null unless the focused chat is a canonical Bot
 *  Chat with inbound events to show. */
export function BotInboundCards() {
  const b = useBots()
  const view = useSessionView()
  const storedId = String(useValue(view.$storedId) || '')
  const roster = useValue($lastRoster)
  const notesQuery = useMailbox()
  const attentionMap = useValue($botAttention)
  const inflight = useValue($relayInflight)
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  // The composer gate's resolution: the canonical pair only — a side-chat
  // never binds a bot here (botForStoredId matches canonical_session ids).
  const bot = useMemo(
    () => botForStoredId([...(cachedUnionRoster()?.profiles || []), ...(roster || [])], storedId),
    [roster, storedId]
  )

  const jobs = useRoutineJobsForBot(bot)

  if (!bot) {
    return null
  }

  const attention =
    attentionMap?.[botSelectionKey(bot) || ''] ||
    attentionMap?.[botRosterKey(bot)] ||
    attentionMap?.[`${bot.connectionId || activeConnectionId}::${bot.name || 'default'}`] ||
    null

  const events = deriveInboundEvents({
    attention,
    jobs,
    member: {
      connectionId: String(bot.connectionId || activeConnectionId),
      handle: botHandle(String(bot.name || ''), bot),
      name: String(bot.name || '')
    },
    notes: Array.isArray(notesQuery.data) ? notesQuery.data : [],
    now: Date.now(),
    relayInflight: Boolean(
      inflight?.has?.(relayLaneKey(String(bot.connectionId || activeConnectionId), String(bot.name || 'default')))
    )
  })

  if (!events.length) {
    return null
  }

  const open = (event: BotInboundEvent) => {
    if (event.action === 'group' && event.room) {
      openGroupChat(event.room)
    } else if (event.action === 'routines') {
      void host.revealPane(`${ID}:routines`)
    }
  }

  const summaryFor = (event: BotInboundEvent): string => {
    if (event.id === 'relay:inflight') {
      return b.events.inflight
    }

    return event.summary || (event.reason ? botAttentionHint(event.reason) : '')
  }

  return (
    <div className="flex flex-col gap-1 px-1" data-slot="bot_inbound_cards">
      {events.map(event => {
        const summary = summaryFor(event)

        return (
          <div
            className="flex w-full min-w-0 items-center gap-2 rounded-md border border-(--dt-composer-ring)/20 bg-accent/10 px-2.5 py-1.5"
            data-bot-event={event.id}
            key={event.id}
          >
            <Codicon
              aria-label={event.kind}
              className={cn('shrink-0 text-[0.7rem]', eventGlyphClass(event.status))}
              name={event.icon}
              spinning={event.status === 'running'}
            />
            <span className="min-w-0 flex-1 truncate text-[0.72rem] text-muted-foreground/90">
              {event.label ? <span className="font-medium">{event.label} — </span> : null}
              {summary}
            </span>
            {event.action ? (
              <Tip label={b.events.open}>
                <span
                  aria-label={b.events.open}
                  className="flex shrink-0 cursor-pointer items-center text-[0.7rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
                  onClick={e => {
                    e.stopPropagation()
                    open(event)
                  }}
                  role="button"
                >
                  <Codicon name="arrow-right" />
                </span>
              </Tip>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
