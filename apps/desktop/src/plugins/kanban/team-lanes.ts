/**
 * Team-lane view helpers for the board (pure — the component layer wires them
 * to the roster query and the delegate mutation). A lane per profile plus the
 * unassigned lane; dropping a card on one delegates it (POST
 * /tasks/:id/reassign), while status moves stay on the card's context menu.
 */

import type { KanbanBoard, KanbanColumn, KanbanTask } from './types'

/** The lane holding cards with no assignee — always rendered last. */
export const UNASSIGNED_LANE = 'unassigned'

/**
 * Lane order: the roster's profiles first (in roster order — that IS the
 * team), then any other names the board still references (a renamed profile
 * whose cards survived, an assignee no longer in the roster), then
 * `UNASSIGNED_LANE`. Empty lanes are kept: in this view they're the drop
 * targets, not dead space.
 */
export function teamLaneNames(
  roster: readonly string[],
  boardAssignees: readonly string[],
  columns: readonly KanbanColumn[]
): string[] {
  const names: string[] = []
  const seen = new Set<string>([UNASSIGNED_LANE])

  const push = (name: string) => {
    if (name && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }

  for (const name of roster) {
    push(name)
  }

  for (const name of [...boardAssignees].sort((a, b) => a.localeCompare(b))) {
    push(name)
  }

  for (const col of columns) {
    for (const task of col.tasks) {
      push(task.assignee ?? '')
    }
  }

  names.push(UNASSIGNED_LANE)

  return names
}

/**
 * Cards in `lane` (`UNASSIGNED_LANE` = cards with no assignee), kept in
 * pipeline order — flat-mapped over the status columns rather than re-sorted,
 * so the lane still reads triage→done top-down.
 */
export function laneTasks(columns: readonly KanbanColumn[], lane: string): KanbanTask[] {
  const owner = lane === UNASSIGNED_LANE ? '' : lane

  return columns.flatMap(col => col.tasks.filter(task => (task.assignee ?? '') === owner))
}

/** Optimistic assignee write, same shape as moveCard/removeCard — the
 *  settled refetch reconciles. */
export function assignCard(board: KanbanBoard, id: string, assignee: null | string): KanbanBoard {
  return {
    ...board,
    columns: board.columns.map(col => ({
      ...col,
      tasks: col.tasks.map(task => (task.id === id ? { ...task, assignee } : task))
    }))
  }
}
