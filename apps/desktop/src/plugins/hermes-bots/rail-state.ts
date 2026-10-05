/**
 * Mission rail (G1) — the context rail's per-section collapse state.
 *
 * Which rail sections are folded away is a per-window presentation choice
 * (like the roster sort beside it), so it persists under plugin storage as
 * one namespaced record — `mission-rail-v1` — and a restarted window keeps
 * the user's layout. Unknown ids in a stored map are dropped on hydrate: a
 * removed section must never wedge the pref.
 */

import { atom } from '@hermes/plugin-sdk'

import { getPluginCtx } from './shared'

/** The rail's collapsible sections, top to bottom. Adding a section (the F1
 *  sessions deck, a later tools panel) is one entry here plus one RailSection
 *  in mission-rail.tsx. */
export const RAIL_SECTION_IDS = ['tasks', 'computer', 'routines'] as const

export type RailSectionId = (typeof RAIL_SECTION_IDS)[number]

const RAIL_SECTIONS_STORAGE_KEY = 'mission-rail-v1'

export const $railCollapsed = atom<Record<string, boolean>>({})

export function hydrateRailSections(): void {
  try {
    // TODO(bot-mode-types): PluginStorage.get(key, fallback) requires the fallback;
    // Bot Mode reads omit it — same TODO as the other hydrated prefs.
    // @ts-expect-error typed as written rather than changing the call.
    Promise.resolve(getPluginCtx()?.storage?.get?.(RAIL_SECTIONS_STORAGE_KEY))
      .then(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return
        }

        const known = new Set<string>(RAIL_SECTION_IDS)
        const next: Record<string, boolean> = {}

        for (const [id, collapsed] of Object.entries(value as Record<string, unknown>)) {
          if (known.has(id) && collapsed === true) {
            next[id] = true
          }
        }

        $railCollapsed.set(next)
      })
      .catch(() => undefined)
  } catch {
    /* no storage — everything expanded stays */
  }
}

export function setRailSectionCollapsed(id: RailSectionId, collapsed: boolean): void {
  const next = { ...$railCollapsed.get() }

  if (collapsed) {
    next[id] = true
  } else {
    delete next[id]
  }

  $railCollapsed.set(next)

  try {
    void getPluginCtx()?.storage?.set?.(RAIL_SECTIONS_STORAGE_KEY, next)
  } catch {
    /* persistence is best-effort — the choice applies either way */
  }
}

/** The rail's tabs (Muse-style): what the bot is doing, what it needs from
 *  you, what runs on its own, and the bot itself. */
export const RAIL_TAB_IDS = ['activity', 'approvals', 'scheduled', 'bot'] as const

export type RailTabId = (typeof RAIL_TAB_IDS)[number]

const RAIL_TAB_STORAGE_KEY = 'mission-rail-tab-v1'

export const $railTab = atom<RailTabId>('activity')

export function hydrateRailTab(): void {
  try {
    // @ts-expect-error same omitted fallback as hydrateRailSections above.
    Promise.resolve(getPluginCtx()?.storage?.get?.(RAIL_TAB_STORAGE_KEY))
      .then(value => {
        if ((RAIL_TAB_IDS as readonly unknown[]).includes(value)) {
          $railTab.set(value as RailTabId)
        }
      })
      .catch(() => undefined)
  } catch {
    /* no storage — Activity stays */
  }
}

export function setRailTab(id: RailTabId): void {
  $railTab.set(id)

  try {
    void getPluginCtx()?.storage?.set?.(RAIL_TAB_STORAGE_KEY, id)
  } catch {
    /* persistence is best-effort — the tab switches either way */
  }
}
