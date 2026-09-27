/**
 * Dismissed-tip state (bot-mode G9): the set of capability tip ids a user has
 * cleared, per bot, persisted to this device's plugin storage. Pure state —
 * the card component lives in bot-tips-view.tsx; keeping the state here makes
 * the dismiss/hydrate contract testable without a renderer.
 */

import { atom } from '@hermes/plugin-sdk'

import { getPluginCtx } from './shared'

const TIPS_STORAGE_KEY = 'bot-tips-dismissed-v1'

/** Bot selection key → tip ids the user dismissed on this device. */
export const $dismissedBotTips = atom<Record<string, readonly string[]>>({})

export function hydrateDismissedBotTips(): void {
  try {
    // TODO(bot-mode-types): PluginStorage.get requires a fallback argument —
    // same TODO as the other hydrated prefs.
    // @ts-expect-error typed as written rather than changing the call.
    Promise.resolve(getPluginCtx()?.storage?.get?.(TIPS_STORAGE_KEY))
      .then(value => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          $dismissedBotTips.set(
            Object.fromEntries(
              Object.entries(value as Record<string, unknown>)
                .filter(([, ids]) => Array.isArray(ids))
                .map(([key, ids]) => [key, (ids as unknown[]).filter(id => typeof id === 'string')])
            )
          )
        }
      })
      .catch(() => undefined)
  } catch {
    /* no storage — every tip shows this window */
  }
}

export function dismissBotTip(botKey: string, tipId: string): void {
  const next = {
    ...$dismissedBotTips.get(),
    [botKey]: [...new Set([...($dismissedBotTips.get()[botKey] ?? []), tipId])]
  }

  $dismissedBotTips.set(next)

  try {
    void getPluginCtx()?.storage?.set?.(TIPS_STORAGE_KEY, next)
  } catch {
    /* persistence is best-effort — the card is gone for this window either way */
  }
}
