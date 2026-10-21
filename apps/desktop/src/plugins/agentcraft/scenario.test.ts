/**
 * Scenario contract: the scripted goal run completes every beat and each merge
 * lands the task's changed files — and only those — on shared main, so later
 * worktrees spawn from merged content (regression: merges once clobbered
 * earlier merges with files the task never touched, killing the q1 decision,
 * the T-4 review, the T-5 fix and the T-6 docs beats on stale anchors).
 */

import { describe, expect, it, vi } from 'vitest'

import castJson from './assets/cast.json'
import { startSim } from './driver'
import type { CastMember } from './model'

const cast = (castJson as { agents: CastMember[] }).agents

describe('scenario', () => {
  it('runs every beat and lands merged work on main', async () => {
    const errs: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => errs.push(a.join(' ')))
    const sim = startSim(cast, { speed: 500, autoAnswer: 1 })
    await sim.promise

    expect(errs.filter(e => e.includes('beat') && e.includes('failed'))).toEqual([])
    expect(sim.store.goal?.status).toBe('done')

    const state = Object.fromEntries([...sim.store.tasks.values()].map(t => [t.id, t.state]))

    for (const id of ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-8']) {expect(state[id]).toBe('done')}

    const decisions = [...sim.store.decisions.values()]

    for (const key of ['p1', 'q1', 'q2', 'merge:t2:1', 'merge:t3:1', 'merge:t4:1', 'merge:t5:1', 'merge:t6:1']) {
      expect(decisions.find(d => d.key === key)?.status).toBe('answered')
    }

    // a fresh worktree after the run sees merged content, not pristine main
    const cli = sim.director.wt('post-run').files['src/cli.ts'] ?? ''
    expect(cli).toContain('{ all, tag }')
  }, 60000)
})
