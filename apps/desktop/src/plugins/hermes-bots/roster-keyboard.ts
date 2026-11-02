/**
 * Arrow-key traversal for the bot roster.
 *
 * Every row is a real `<button>`, so Tab reaches them — but a roster of 20 bots
 * meant 20 tab stops before the composer, and the Up/Down keys a list invites
 * did nothing. This gives the list the movement it advertises: arrows step one
 * row, Home/End jump the ends, and the ring stays on the row you are on.
 *
 * Deliberately narrow: it only moves focus, it never opens a bot. Enter/Space
 * on a focused row already does that, so the keys keep their native meaning.
 */

const ROW_SELECTOR = '[data-roster-row]:not([disabled])'

/** The row index a key should land on, or null when the key is not navigation.
 *  Pure so the ends-of-list behaviour is provable without a DOM. */
export function nextRowIndex(current: number, total: number, key: string): null | number {
  if (total <= 0 || current < 0) {
    return null
  }

  switch (key) {
    case 'ArrowDown':
      return Math.min(total - 1, current + 1)

    case 'ArrowUp':
      return Math.max(0, current - 1)

    case 'End':
      return total - 1

    case 'Home':
      return 0

    default:
      return null
  }
}

/** Container-level handler: move focus among the rows inside `currentTarget`.
 *  Bails when focus sits on anything that is not itself a row (a nested action
 *  button, the search field) so arrow keys keep their own meaning there. */
export function handleRosterArrowKey(event: { currentTarget: HTMLElement; key: string; preventDefault: () => void }): void {
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR))
  const active = document.activeElement as HTMLElement | null
  const current = active ? rows.indexOf(active) : -1
  const next = nextRowIndex(current, rows.length, event.key)

  if (next === null) {
    return
  }

  event.preventDefault()
  rows[next]?.focus()
}
