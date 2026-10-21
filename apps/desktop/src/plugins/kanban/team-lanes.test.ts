import { describe, expect, it } from 'vitest'

import { assignCard, laneTasks, teamLaneNames, UNASSIGNED_LANE } from './team-lanes'
import type { KanbanBoard, KanbanTask } from './types'

const task = (id: string, status: string, assignee?: null | string): KanbanTask => ({
  id,
  status,
  title: `task ${id}`,
  ...(assignee !== undefined ? { assignee } : {})
})

const columns = [
  { name: 'ready', tasks: [task('r1', 'ready', 'writer'), task('r2', 'ready')] },
  { name: 'running', tasks: [task('w1', 'running', 'coder'), task('w2', 'running', 'writer')] },
  { name: 'done', tasks: [task('d1', 'done', 'coder')] }
]

describe('team lanes', () => {
  it('orders lanes roster-first, strays sorted, unassigned last', () => {
    const lanes = teamLaneNames(['coder', 'writer'], ['zzz-stale', 'coder'], columns)

    // Roster order, then the board's stray assignee, then unassigned —
    // 'writer' already covered by the roster isn't duplicated.
    expect(lanes).toEqual(['coder', 'writer', 'zzz-stale', UNASSIGNED_LANE])
  })

  it('keeps an assignee alive on the board even with no roster match', () => {
    // No roster → assignees surface in pipeline-appearance order.
    expect(teamLaneNames([], [], columns)).toEqual(['writer', 'coder', UNASSIGNED_LANE])
  })

  it('still renders every roster lane on an empty board', () => {
    expect(teamLaneNames(['coder', 'writer'], [], [])).toEqual(['coder', 'writer', UNASSIGNED_LANE])
  })

  it('groups a lane in pipeline order, unassigned = no assignee', () => {
    expect(laneTasks(columns, 'coder').map(t => t.id)).toEqual(['w1', 'd1'])
    expect(laneTasks(columns, 'writer').map(t => t.id)).toEqual(['r1', 'w2'])
    expect(laneTasks(columns, UNASSIGNED_LANE).map(t => t.id)).toEqual(['r2'])
    expect(laneTasks(columns, 'nobody')).toEqual([])
  })

  it('optimistically rewrites the assignee without touching status or order', () => {
    const board: KanbanBoard = {
      assignees: ['coder'],
      columns,
      latest_event_id: 1,
      now: 0,
      tenants: []
    }

    const next = assignCard(board, 'r2', 'coder')

    expect(next.columns[0].tasks[1]).toMatchObject({ id: 'r2', assignee: 'coder', status: 'ready' })
    // Untouched siblings keep identity order; the source board is unmutated.
    expect(board.columns[0].tasks[1].assignee).toBeUndefined()
    expect(assignCard(board, 'w1', null).columns[1].tasks[0].assignee).toBeNull()
  })
})
