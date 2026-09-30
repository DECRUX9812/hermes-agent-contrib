/**
 * Long-context nudge (bot-mode topics): the canonical Bot Chat is a forever
 * chat, so its prompt prefix grows with every turn. Once the transcript is
 * large enough that new turns pay the full reload cost, a one-line card above
 * the composer suggests starting a topic — a fresh chat that keeps the bot's
 * powers. Suggestion only: dismissible per bot, and it re-appears only after
 * the transcript has grown well past where it was dismissed, so the card is a
 * reminder, not a nag.
 *
 * Pure state + the size read live here; the card component lives in
 * context-nudge-view.tsx so the dismiss/re-show contract is testable without
 * a renderer.
 */

import { atom } from '@hermes/plugin-sdk'

import { CANONICAL_CHAT_TITLE, isCanonicalBotChatHistory, PROFILE_SESSION_LIST_LIMIT } from './canonical-chat'
import { backendTargetProfile, botConnectionRoute, requestForBot } from './routing'
import { getPluginCtx } from './shared'
import type { RosterRow } from './types'

const NUDGE_STORAGE_KEY = 'bot-context-nudge-dismissed-v1'

/** A forever chat starts costing real context once the transcript is long
 *  enough to matter more than the reply itself. Message count is the signal
 *  the row always carries; input_tokens is read when the backend reports it. */
export const NUDGE_MIN_MESSAGES = 60
export const NUDGE_MIN_INPUT_TOKENS = 150_000

/** Re-show the card once the transcript is this much larger than when it was
 *  dismissed — dismissed-at-200 reappears at 300 messages, not at 201. */
export const NUDGE_REGROWTH_FACTOR = 1.5

/** Bot selection key → transcript size (message_count) when the card was
 *  dismissed on this device. */
export const $dismissedNudgeCounts = atom<Record<string, number>>({})

export function hydrateDismissedNudges(): void {
  try {
    // TODO(bot-mode-types): PluginStorage.get requires a fallback argument —
    // same TODO as the other hydrated prefs.
    // @ts-expect-error typed as written rather than changing the call.
    Promise.resolve(getPluginCtx()?.storage?.get?.(NUDGE_STORAGE_KEY))
      .then(value => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          $dismissedNudgeCounts.set(
            Object.fromEntries(
              Object.entries(value as Record<string, unknown>)
                .filter(([, count]) => typeof count === 'number' && Number.isFinite(count) && count >= 0)
                .map(([key, count]) => [key, count as number])
            )
          )
        }
      })
      .catch(() => undefined)
  } catch {
    /* no storage — the card can show this window */
  }
}

export function dismissContextNudge(botKey: string, messageCount: number): void {
  const next = { ...$dismissedNudgeCounts.get(), [botKey]: messageCount }

  $dismissedNudgeCounts.set(next)

  try {
    void getPluginCtx()?.storage?.set?.(NUDGE_STORAGE_KEY, next)
  } catch {
    /* persistence is best-effort — the card is gone for this window either way */
  }
}

export interface CanonicalChatSize {
  input_tokens?: number
  message_count?: number
}

/** Is this forever-chat big enough that a fresh topic would help? Either
 *  signal alone is enough — a token-heavy chat costs tokens every turn, and a
 *  long message list costs scroll and hydrate time. */
export function contextNudgeEligible(size: CanonicalChatSize | null | undefined): boolean {
  if (!size) {
    return false
  }

  const tokens = typeof size.input_tokens === 'number' && Number.isFinite(size.input_tokens) ? size.input_tokens : 0
  const messages = typeof size.message_count === 'number' && Number.isFinite(size.message_count) ? size.message_count : 0

  return tokens >= NUDGE_MIN_INPUT_TOKENS || messages >= NUDGE_MIN_MESSAGES
}

/** Should the card render for this bot right now? Not when it was dismissed
 *  at a size the transcript has not yet grown meaningfully past. */
export function contextNudgeSuppressed(dismissedAt: number | null | undefined, size: CanonicalChatSize | null | undefined): boolean {
  if (dismissedAt == null) {
    return false
  }

  const messages =
    size && typeof size.message_count === 'number' && Number.isFinite(size.message_count) ? size.message_count : 0

  return messages < dismissedAt * NUDGE_REGROWTH_FACTOR
}

/** The canonical Bot Chat's transcript size, off the indexed title lookup.
 *  Returns null on any failure — a nudge that can't read the size simply
 *  doesn't show (it is advisory, never load-bearing, so unlike the registry
 *  lookup itself it must fail open). Runs at default spawn priority: a
 *  suggestion card must never foreground-spawn a cold backend. */
export async function canonicalChatSize(bot: RosterRow): Promise<CanonicalChatSize | null> {
  const route = botConnectionRoute(bot)

  if (!route || !bot?.name) {
    return null
  }

  try {
    const res = await requestForBot<{ sessions?: CanonicalChatSize[] }>(bot, 'session.list', {
      profile: backendTargetProfile(route, bot.name),
      title: CANONICAL_CHAT_TITLE,
      limit: PROFILE_SESSION_LIST_LIMIT,
      include_hidden: true
    })

    const match = (res?.sessions ?? []).find(row => isCanonicalBotChatHistory(row))

    return match ?? null
  } catch {
    return null
  }
}
