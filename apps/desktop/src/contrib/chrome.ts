/**
 * CHROME BUDGETS — the rule that stops extensions from eating the user's
 * screen.
 *
 * The contribution registry is deliberately unopinionated: any area accepts
 * any number of entries, sorted by one integer. That is right for content
 * areas (panes, transcript directives, tool renderers) and wrong for the
 * chrome, where every contribution competes for a fixed strip of pixels with
 * the product's own controls. Without a budget the outcome is always the same:
 * plugin row #6 squeezes the session list, plugin chip #5 clips mid-word, and
 * the user reads the resulting mess as "Hermes layout is broken".
 *
 * This module owns the policy. Hosts (sidebar nav, status bar) ask it to split
 * a cluster into what fits inline and what must move behind an overflow
 * affordance:
 *
 *   - CORE rows are never counted and never moved. They are the product.
 *   - PLUGIN rows get `CHROME_PLUGIN_ROWS` inline slots between them.
 *   - Everything past the budget stays REACHABLE (an overflow menu), never
 *     silently clipped — the failure mode this module exists to end.
 */

/** Provenance tag for a plugin contribution: `plugin:kanban` -> `kanban`. */
export function pluginIdFromSource(source?: string | null): string | null {
  if (!source || !source.startsWith('plugin:')) {
    return null
  }

  const id = source.slice('plugin:'.length).trim()

  return id || null
}

/** Inline slots available to plugin rows per chrome cluster. Three is the
 *  number that keeps the primary nav at a glance-able height: core rows stay
 *  fixed, a fourth extension row is already the point where the session list
 *  starts to feel pushed off the screen. */
export const CHROME_PLUGIN_ROWS = 3

export interface ChromeSplit<T> {
  /** Core rows plus the plugin rows that fit — render these inline. */
  inline: T[]
  /** Plugin rows over budget — render behind the overflow affordance. */
  overflow: T[]
}

/**
 * Split one chrome cluster against the plugin budget, preserving the caller's
 * order. Rows whose `pluginOf` returns null are treated as core: they always
 * stay inline and never consume a plugin slot.
 */
export function splitChrome<T>(
  rows: readonly T[],
  pluginOf: (row: T) => string | null,
  max: number = CHROME_PLUGIN_ROWS
): ChromeSplit<T> {
  const inline: T[] = []
  const overflow: T[] = []
  let used = 0

  for (const row of rows) {
    if (pluginOf(row)) {
      if (used >= max) {
        overflow.push(row)

        continue
      }

      used += 1
    }

    inline.push(row)
  }

  return { inline, overflow }
}

/**
 * The user-facing name for a plugin id: the loaded plugin's own display name
 * when the inventory knows it, else the id humanized so "hermes-teams" reads
 * as "Hermes Teams" in a menu rather than as a package name.
 */
export function pluginDisplayName(id: string, knownName?: string): string {
  if (knownName?.trim()) {
    return knownName.trim()
  }

  return id
    .replace(/^plugin:/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, char => char.toUpperCase())
}
