/**
 * Keyboard movement for kanban cards.
 *
 * Drag-and-drop is pointer-only; a board you can only reorder with a mouse is
 * unusable without one. The card's own key handler (Alt+Arrow) calls this to
 * decide the destination status, and it lives here as a pure function so the
 * rule — clamp at the ends, ignore an unknown status — is provable without
 * mounting the board.
 */
export function adjacentStatus(
  columns: readonly string[],
  status: string,
  delta: -1 | 1
): undefined | string {
  const index = columns.indexOf(status)

  if (index === -1) {
    return undefined
  }

  return columns[index + delta]
}
