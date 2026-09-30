/**
 * Long-context nudge card (bot-mode topics): above the composer of a bot's
 * canonical forever-chat, one line — "this chat is carrying a lot of context;
 * a topic starts fresh and keeps my powers" — with a New topic button that
 * opens a side chat through the same path the deck's + uses (newBotChat).
 *
 * The card claims only canonical Bot Chats: `isCanonicalChatOnScreen` rejects
 * every other session, so it never appears on topics, group chats, or plain
 * sessions. The size read is the indexed title lookup (session.list by title),
 * cached per chat for a minute — an advisory card must never foreground-spawn
 * a cold backend, and failure simply means no card.
 */

import { Codicon, host, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import { isCanonicalChatOnScreen } from './canonical-chat'
import { botForChat } from './chat-empty'
import {
  $dismissedNudgeCounts,
  type CanonicalChatSize,
  canonicalChatSize,
  contextNudgeEligible,
  contextNudgeSuppressed,
  dismissContextNudge
} from './context-nudge'
import { $lastRoster, botSelectionKey, newBotChat } from './data'
import { useBots } from './i18n'

/** size read cache: `${botKey}:${storedId}` → {at, size}. A nudge tolerates a
 *  stale reading; a foreground-spawned backend for a suggestion does not. */
const sizeCache = new Map<string, { at: number; size: CanonicalChatSize | null }>()
const SIZE_TTL_MS = 60_000

export function BotContextNudge() {
  const t = useBots()
  const roster = useValue($lastRoster)
  const dismissed = useValue($dismissedNudgeCounts)
  const storedId = String(host.state.focusedStoredSessionId?.get?.() ?? '')
  useValue(host.state.focusedStoredSessionId)

  const bot = botForChat(roster, storedId)
  const canonical = isCanonicalChatOnScreen(bot, storedId)
  const botKey = bot ? botSelectionKey(bot) : ''
  const cacheKey = `${botKey}:${storedId}`

  // The read is keyed to the chat it was taken from — switching sessions must
  // never flash a nudge measured on the previous chat.
  const [reading, setReading] = useState<{ key: string; size: CanonicalChatSize | null }>(() => {
    const hit = sizeCache.get(cacheKey)

    return { key: cacheKey, size: hit && Date.now() - hit.at < SIZE_TTL_MS ? hit.size : null }
  })

  const size = reading.key === cacheKey ? reading.size : null

  useEffect(() => {
    if (!bot || !canonical) {
      return
    }

    const hit = sizeCache.get(cacheKey)

    if (hit && Date.now() - hit.at < SIZE_TTL_MS) {
      setReading({ key: cacheKey, size: hit.size })

      return
    }

    let alive = true
    void canonicalChatSize(bot).then(next => {
      sizeCache.set(cacheKey, { at: Date.now(), size: next })

      if (alive) {
        setReading({ key: cacheKey, size: next })
      }
    })

    return () => {
      alive = false
    }
  }, [bot, canonical, cacheKey])

  if (!bot || !canonical || !contextNudgeEligible(size)) {
    return null
  }

  const dismissedAt = dismissed[botKey]

  if (contextNudgeSuppressed(dismissedAt ?? null, size)) {
    return null
  }

  const messages = typeof size?.message_count === 'number' && Number.isFinite(size.message_count) ? size.message_count : 0

  return (
    <div
      className="pointer-events-auto mx-3 mb-1.5 flex items-center gap-2.5 rounded-lg border border-(--dt-composer-ring)/25 bg-accent/12 px-3 py-2 text-left"
      data-slot="bot_context_nudge"
    >
      <Codicon className="shrink-0 text-[0.8rem] text-(--ui-text-tertiary)" name="comment-discussion" />
      <p className="m-0 min-w-0 flex-1 text-[0.72rem] leading-snug text-muted-foreground/90">{t.nudge.text}</p>
      <button
        className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[0.7rem] font-medium text-(--ui-accent-primary, var(--primary)) transition-colors hover:bg-accent/40"
        onClick={() => void newBotChat(bot)}
        type="button"
      >
        {t.nudge.action}
      </button>
      <button
        aria-label={t.nudge.dismiss}
        className="flex shrink-0 cursor-pointer items-center text-[0.7rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
        onClick={() => dismissContextNudge(botKey, messages)}
        type="button"
      >
        <Codicon name="close" />
      </button>
    </div>
  )
}
