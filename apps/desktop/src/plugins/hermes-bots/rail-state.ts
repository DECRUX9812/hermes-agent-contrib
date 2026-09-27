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
