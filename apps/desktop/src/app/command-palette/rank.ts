import type { HUD_NOTE_VARIANT } from '@/app/floating-hud'
import type { IconComponent } from '@/lib/icons'
import { normalize } from '@/lib/text'
import { frecencyBoost, frecencyScore, type PaletteFrecencyTable } from '@/store/command-palette-frecency'

export interface PaletteItem {
  /** Keybind action id — its live combo renders as a hotkey hint. */
  action?: string
  /** Renders a trailing check: this row IS the current setting (theme, mode). */
  active?: boolean
  /** Static trailing combo hint for a modifier-variant select (e.g. `mod+enter`). */
  comboHint?: string
  /** Short note beside the label — state the row acts on (a version, a count). */
  detail?: string
  /** `state` when the row will change what `detail` says (a toggle's on/off). */
  detailVariant?: keyof typeof HUD_NOTE_VARIANT
  /** Shared history key when the same target shows under several row ids (a
   *  session across its pinned/recent/archived rows, a mode row on two pages).
   *  Defaults to `id`. */
  frecencyKey?: string
  icon: IconComponent
  id: string
  /** Keep the palette open after running (live-preview pickers like theme/mode). */
  keepOpen?: boolean
  keywords?: string[]
  label: string
  /** Label shown while ⌘/⌃ is held — previews the modifier-variant action. */
  modLabel?: string
  /**
   * Runs when the row becomes the cmdk highlight (arrow keys or hover). When
   * a row has no onHighlight, a highlight on it clears the live preview.
   */
  onHighlight?: () => void
  /**
   * When set, ⌘/⌃-select (or ⌘-Enter) opens a new tab and ⇧⌘-select pops a
   * window — matching sidebar session rows. Plain select stays in-place.
   * Receives the last selector event so the modifiers can be read.
   */
  runWithEvent?: (event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void
  /** Action to run when selected. Mutually exclusive with `to`. */
  run?: () => void
  /** Open a nested palette page (VS Code-style "choose X → options"). */
  to?: string
}

export interface PaletteGroup {
  /** Optional: a headingless group renders as a bare action row (e.g. the
   *  "Install theme…" entry pinned atop the theme picker). */
  heading?: string
  items: PaletteItem[]
}

const frecencyKeyOf = (item: PaletteItem): string => item.frecencyKey ?? item.id

// Ranking happens in React, not cmdk. We score, sort, and prune the groups
// ourselves and hand cmdk an already-ordered list with `shouldFilter={false}`,
// leaving it as pure keyboard/selection machinery. (cmdk's own group
// re-sorting silently no-ops: its sort() queries groups by an internal id that
// never matches the heading text it writes into `data-value`, so groups always
// keep source order — which put a generic keyword match like "Capabilities" on
// top and the auto-highlight on it while an exact "Tools" row sat below.)
//
// cmdk still auto-selects the first DOM item whenever the search changes, so
// rendering best-match-first is what puts the highlight on the best match.
//
// AND semantics: every typed word must appear in the label or keywords. The
// grade rewards matches on the visible label — exact > prefix > whole word >
// word prefix > substring > scattered terms > keyword-only — so typing "tools"
// selects the row that says Tools, not a row that hides it in keywords.
export const scoreItem = (item: PaletteItem, needle: string): number => {
  const label = item.label.toLowerCase()
  const keys = (item.keywords ?? []).join(' ').toLowerCase()
  const terms = needle.split(/\s+/).filter(Boolean)

  if (terms.some(term => !label.includes(term) && !keys.includes(term))) {
    return 0
  }

  if (label === needle) {
    return 1
  }

  if (label.startsWith(needle)) {
    return 0.9
  }

  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

  if (words.includes(needle)) {
    return 0.85
  }

  if (words.some(word => word.startsWith(needle))) {
    return 0.8
  }

  if (label.includes(needle)) {
    return 0.7
  }

  if (terms.every(term => label.includes(term))) {
    return 0.6
  }

  // Matched only via keywords — the weakest, generic-row signal.
  return 0.4
}

// Order items within each group by score, order groups by their best item, and
// drop everything that doesn't match. Ties keep their original order (stable
// sort), so curated group/item ordering still breaks even scores.
//
// Frecency is a nudge, not a takeover: it adds at most ~2 grade bands to a
// match (and orders an EMPTY search within each group), so usage reshuffles
// peers but a stale habit can't outrank a clearly better text match.
export const rankGroups = (
  groups: PaletteGroup[],
  search: string,
  frecency: PaletteFrecencyTable = {},
  now: number = Date.now()
): PaletteGroup[] => {
  const needle = normalize(search)

  if (!needle) {
    // No query: groups keep their curated order, but each group's rows drift
    // into the user's habit order — most-used first, untouched rows untouched
    // (stable sort, and a group with no history keeps its reference so memoized
    // rows don't re-render for nothing).
    return groups.map(group =>
      group.items.some(item => frecencyKeyOf(item) in frecency)
        ? {
            ...group,
            items: [...group.items].sort(
              (a, b) =>
                frecencyScore(frecency[frecencyKeyOf(b)], now) - frecencyScore(frecency[frecencyKeyOf(a)], now)
            )
          }
        : group
    )
  }

  return groups
    .map(group => {
      const scored = group.items
        .map(item => ({ item, score: scoreItem(item, needle) }))
        // The boost only applies to real matches — adding it to a zero-score
        // row would surface items that never matched the needle at all.
        .filter(entry => entry.score > 0)
        .map(entry => ({
          ...entry,
          score: entry.score + frecencyBoost(frecency[frecencyKeyOf(entry.item)], now)
        }))
        .sort((a, b) => b.score - a.score)

      return { group: { ...group, items: scored.map(entry => entry.item) }, max: scored[0]?.score ?? 0 }
    })
    .filter(entry => entry.max > 0)
    .sort((a, b) => b.max - a.max)
    .map(entry => entry.group)
}
