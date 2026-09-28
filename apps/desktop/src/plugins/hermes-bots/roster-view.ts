/**
 * Roster view mode (bot-mode revamp G10): the list↔cards toggle's persisted
 * pref. Device-local plugin storage, hydrated at plugin register like the
 * sort-mode pref — one machine's card grid shouldn't rearrange another's.
 */

import { atom } from '@hermes/plugin-sdk'

import { getPluginCtx } from './shared'

export type RosterViewMode = 'cards' | 'list'

export const ROSTER_VIEW_STORAGE_KEY = 'roster-view-v1'

export const $rosterViewMode = atom<RosterViewMode>('list')

export function hydrateRosterViewMode(): void {
  try {
    // TODO(bot-mode-types): PluginStorage.get(key, fallback) requires the fallback;
    // Bot Mode reads omit it — same TODO as the other hydrated prefs.
    // @ts-expect-error typed as written rather than changing the call.
    Promise.resolve(getPluginCtx()?.storage?.get?.(ROSTER_VIEW_STORAGE_KEY))
      .then(value => {
        if (value === 'cards' || value === 'list') {
          $rosterViewMode.set(value)
        }
      })
      .catch(() => undefined)
  } catch {
    /* no storage — 'list' stays */
  }
}

export function setRosterViewMode(mode: RosterViewMode): void {
  $rosterViewMode.set(mode)

  try {
    void getPluginCtx()?.storage?.set?.(ROSTER_VIEW_STORAGE_KEY, mode)
  } catch {
    /* no storage — session-only */
  }
}
