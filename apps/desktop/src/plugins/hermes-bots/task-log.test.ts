/**
 * G8 — the dated task log's bucketing contract:
 *   1. runs land under their LOCAL calendar day, newest day first;
 *   2. 'today'/'yesterday' resolve against the supplied "now", older days
 *      degrade to a date label;
 *   3. order inside a bucket preserves the feed's newest-first arrival;
 *   4. a run with no usable timestamp never invents a day.
 */

import { describe, expect, it } from 'vitest'

import type { BotRun } from './bot-runs'
import { taskLogGroups, taskLogLine } from './task-log'

function run(over: Partial<BotRun>): BotRun {
  return {
    at: 0,
    id: 'r-1',
    kind: 'chat',
    status: 'ok',
    summary: 'did a thing',
    title: '',
    ...over
  }
}

// Noon local time — day boundaries can't straddle a UTC offset quirk at noon.
const now = new Date(2026, 8, 22, 12, 0, 0).getTime()
const at = (dayOffset: number, hours: number) => new Date(2026, 8, 22 + dayOffset, hours).getTime()

describe('taskLogGroups', () => {
  it('buckets runs into today / yesterday / dated days, newest day first', () => {
    const groups = taskLogGroups(
      [
        run({ at: at(0, 10), id: 'today-1' }),
        run({ at: at(0, 9), id: 'today-2' }),
        run({ at: at(-1, 14), id: 'yesterday-1' }),
        run({ at: at(-3, 8), id: 'older-1' })
      ],
      now
    )

    expect(groups.map(g => g.label)).toEqual(['today', 'yesterday', 'date'])
    expect(groups[0].runs.map(r => r.id)).toEqual(['today-1', 'today-2'])
    expect(groups[1].runs.map(r => r.id)).toEqual(['yesterday-1'])
    expect(groups[2].runs.map(r => r.id)).toEqual(['older-1'])
    // The dated bucket's key is its local midnight — the renderer formats it.
    expect(new Date(groups[2].at).getDate()).toBe(19)
  })

  it('skips runs with no usable timestamp', () => {
    const groups = taskLogGroups([run({ at: 0, id: 'unborn' }), run({ at: at(0, 10), id: 'real' })], now)

    expect(groups).toHaveLength(1)
    expect(groups[0].runs.map(r => r.id)).toEqual(['real'])
  })
})

describe('taskLogLine', () => {
  it('prefers the run title, falls back to its summary', () => {
    expect(taskLogLine(run({ title: 'Morning report' }))).toBe('Morning report')
    expect(taskLogLine(run({ summary: 'Delivered a note', title: '' }))).toBe('Delivered a note')
    expect(taskLogLine(run({ summary: '  ', title: ' ' }))).toBe('')
  })
})
