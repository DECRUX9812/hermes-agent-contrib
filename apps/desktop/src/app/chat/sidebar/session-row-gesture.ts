// Which action a left-click on a sidebar session row triggers, given the
// modifier keys held. Kept as a pure resolver (separate from the row
// component) so the precedence — the part that's easy to get subtly wrong —
// is unit-testable without rendering the whole sidebar.

export type SessionRowClickAction = 'archive' | 'resume' | 'selectRange' | 'selectRangeAdditive' | 'selectToggle'

export interface SessionRowClickModifiers {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Resolve the click action from its modifiers.
 *
 * Multi-select owns the two Finder chords: ⌘/⌃-click toggles the row in and
 * out of the selection set, ⇧-click extends a range from the last clicked
 * anchor, and ⌘/⌃+⇧-click adds that range to whatever is already selected.
 * The rail's own ⌥+⇧ archive gesture is checked FIRST — it sets shiftKey
 * too, so a naive `shiftKey` test would swallow it into a range select.
 *
 * (New-tab / new-window live on middle-click and the row's menus now; the
 * modifier chords belong to selection.)
 */
export function resolveSessionRowClick({
  altKey,
  ctrlKey,
  metaKey,
  shiftKey
}: SessionRowClickModifiers): SessionRowClickAction {
  const primaryModifier = metaKey || ctrlKey

  if (altKey && shiftKey) {
    return 'archive'
  }

  if (primaryModifier && shiftKey) {
    return 'selectRangeAdditive'
  }

  if (primaryModifier) {
    return 'selectToggle'
  }

  if (shiftKey) {
    return 'selectRange'
  }

  return 'resume'
}
