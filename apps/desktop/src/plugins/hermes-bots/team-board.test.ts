/**
 * The board's derived-display rules: column grouping, the Needs-you filter and the
 * mono number formats, against fixtures shaped like `fork.team.board` results.
 */

import { describe, expect, it } from 'vitest'

import {
  columnState,
  countNeedsYou,
  filterNeedsYou,
  formatElapsed,
  formatMoney,
  formatTokens,
  groupColumns,
  isWorkingColumn,
  type TeamBoardCard,
  toolState
} from './team-board'

const card = (over: Partial<TeamBoardCard> = {}): TeamBoardCard => {
  const { status = 'ready', ...rest } = over

  return {
    column: 'queued',
    cost_usd: null,
    elapsed_s: null,
    needs_you: null,
    stoppable: false,
    takeable: true,
    task_id: 't1',
    title: 'Card',
    tokens: null,
    ...rest,
    status
  }
}

describe('board grouping', () => {
  it('buckets cards into the four columns in board order and drops unknown columns', () => {
    const grouped = groupColumns([
      card({ column: 'done', task_id: 'a' }),
      card({ column: 'queued', task_id: 'b' }),
      card({ column: 'in_progress', task_id: 'c' }),
      card({ column: 'needs_approval', needs_you: 'approval', task_id: 'd' }),
      card({ column: 'archived', task_id: 'e' })
    ])

    expect(Object.keys(grouped)).toEqual(['queued', 'in_progress', 'needs_approval', 'done'])
    expect(grouped.queued.map(c => c.task_id)).toEqual(['b'])
    expect(grouped.in_progress.map(c => c.task_id)).toEqual(['c'])
    expect(grouped.needs_approval.map(c => c.task_id)).toEqual(['d'])
    expect(grouped.done.map(c => c.task_id)).toEqual(['a'])
  })

  it('arms the fast poll only while work is queued or in progress', () => {
    expect(isWorkingColumn('queued')).toBe(true)
    expect(isWorkingColumn('in_progress')).toBe(true)
    expect(isWorkingColumn('done')).toBe(false)
    expect(isWorkingColumn(null)).toBe(false)
  })
})

describe('the Needs-you filter', () => {
  const cards = [
    card({ needs_you: 'approval', task_id: 'a' }),
    card({ needs_you: null, task_id: 'b' }),
    card({ needs_you: 'question', task_id: 'c' })
  ]

  it('keeps only cards a human is wanted on when on, and reorders nothing when off', () => {
    expect(filterNeedsYou(cards, true).map(c => c.task_id)).toEqual(['a', 'c'])
    expect(filterNeedsYou(cards, false).map(c => c.task_id)).toEqual(['a', 'b', 'c'])
    expect(countNeedsYou(cards)).toBe(2)
    expect(countNeedsYou([])).toBe(0)
  })
})

describe('mono formats', () => {
  it('renders missing totals as an em dash', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(undefined)).toBe('—')
    expect(formatTokens(null)).toBe('—')
    expect(formatTokens(undefined)).toBe('—')
    expect(formatElapsed(null)).toBe('—')
    expect(formatElapsed(undefined)).toBe('—')
  })

  it('renders present totals compactly', () => {
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(1.5)).toBe('$1.50')
    expect(formatMoney(120)).toBe('$120')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(15300)).toBe('15.3k')
    expect(formatElapsed(42)).toBe('42s')
    expect(formatElapsed(185)).toBe('3m 05s')
    expect(formatElapsed(4500)).toBe('1h 15m')
  })
})

describe('status vocabulary', () => {
  it('draws every column and tool status from the shared five states', () => {
    expect(columnState('queued')).toBe('queued')
    expect(columnState('in_progress')).toBe('running')
    expect(columnState('needs_approval')).toBe('needs-approval')
    expect(columnState('done')).toBe('done')
    expect(toolState('running')).toBe('running')
    expect(toolState('ok')).toBe('done')
    expect(toolState('error')).toBe('error')
    expect(toolState('failed')).toBe('error')
    expect(toolState('')).toBe('done')
    expect(toolState(undefined)).toBe('done')
  })
})
