import { beforeEach, describe, expect, it } from 'vitest'

import {
  $sessionActivity,
  activityCounts,
  activityFor,
  activityFromHistory,
  activityFromToolEvent,
  activityKey,
  applyApprovalDecision,
  approvalFromPrompt,
  clearSessionActivity,
  decideInSession,
  groupByDay,
  mergeIntoSession,
  mergeSessionActivity,
  oneLine,
  settledApprovalActivity
} from './session-activity'

const atlas = { profile: 'atlas', sessionId: 'sess-a' }
const beta = { profile: 'beta', sessionId: 'sess-b' }

const tool = (id: string, at: number, status: 'running' | 'succeeded' = 'succeeded') => ({
  finishedAt: status === 'running' ? null : at + 10,
  id: `tool:${id}`,
  kind: 'tool' as const,
  profile: atlas.profile,
  sessionId: atlas.sessionId,
  startedAt: at,
  status,
  summary: '',
  title: `tool ${id}`
})

beforeEach(() => clearSessionActivity())

describe('session activity model', () => {
  it('keeps sessions isolated by profile and id', () => {
    mergeIntoSession(atlas, [{ ...tool('a1', 1), profile: atlas.profile, sessionId: atlas.sessionId }])
    mergeIntoSession(beta, [{ ...tool('b1', 2), profile: beta.profile, sessionId: beta.sessionId }])

    expect(activityFor($sessionActivity.get(), atlas).items.map(i => i.id)).toEqual(['tool:a1'])
    expect(activityFor($sessionActivity.get(), beta).items.map(i => i.id)).toEqual(['tool:b1'])
    expect(activityKey(atlas)).toBe('atlas::sess-a')
  })

  it('orders newest first, with a stable tiebreak', () => {
    const items = [tool('old', 10), tool('new', 30), tool('tie', 20)]
    const page = activityFor({ [activityKey(atlas)]: items }, atlas)

    expect(page.items.map(item => item.id)).toEqual(['tool:new', 'tool:tie', 'tool:old'])
  })

  it('is idempotent for duplicate updates and never regresses a settled task', () => {
    const finished = tool('x', 10)
    const merged = mergeSessionActivity([finished], [finished, finished])

    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('succeeded')

    const lateStart = { ...finished, finishedAt: null, status: 'running' as const }
    const afterLate = mergeSessionActivity(merged, [lateStart])
    expect(afterLate[0].status).toBe('succeeded')
    expect(afterLate[0].finishedAt).toBe(20)
  })

  it('groups history into user-meaningful tasks and hides housekeeping', () => {
    const items = activityFromHistory(atlas, [
      { role: 'user', text: 'Summarize the Anthropic post and apply its implications', timestamp: 1_700_000_000 },
      {
        context: 'docs/post.md',
        error: 'blocked by policy',
        name: 'read_file',
        role: 'tool',
        timestamp: 1_700_000_001,
        tool_call_id: 't1'
      },
      { context: 'docs/post.md', name: 'read_file', role: 'tool', timestamp: 1_700_000_002, tool_call_id: 't2' },
      { context: 'launch kit', name: 'todo_write', role: 'tool', timestamp: 1_700_000_003, tool_call_id: 't3' },
      { context: 'Hook 3', name: 'memory_search', role: 'tool', timestamp: 1_700_000_004, tool_call_id: 't4' },
      { context: 'docs/residency.md', name: 'read_file', role: 'tool', timestamp: 1_700_000_005, tool_call_id: 't5' },
      {
        role: 'assistant',
        text: 'Read the post and the residency page; the post was blocked, so the summary uses the residency page. More detail follows.',
        timestamp: 1_700_000_006
      }
    ])

    expect(items).toHaveLength(1)
    const task = items[0]
    expect(task.id).toBe('task:sess-a:0')
    expect(task.title).toBe('Summarize the Anthropic post and apply its implications')
    expect(task.summary).toBe(
      'Read the post and the residency page; the post was blocked, so the summary uses the residency page.'
    )
    expect(task.status).toBe('succeeded')
    expect(task.steps?.map(step => `${step.tool}|${step.target}`)).toEqual([
      'read_file|docs/post.md',
      'read_file|docs/residency.md'
    ])
    expect(task.steps?.every(step => step.status === 'succeeded')).toBe(true)
  })

  it('does not surface a task made only of housekeeping', () => {
    const items = activityFromHistory(atlas, [
      { role: 'user', text: 'Tidy up', timestamp: 1_700_000_000 },
      { context: 'launch kit', name: 'todo_write', role: 'tool', timestamp: 1_700_000_001 },
      { context: 'Hook 3', name: 'memory_search', role: 'tool', timestamp: 1_700_000_002 }
    ])

    expect(items).toHaveLength(0)
  })

  it('maps live tool events and preserves the start of a late completion', () => {
    const started = activityFromToolEvent(
      atlas,
      'tool.start',
      {
        input: 'ls',
        name: 'terminal',
        tool_id: 'live-1'
      },
      100
    )

    expect(started?.status).toBe('running')

    const finished = activityFromToolEvent(
      atlas,
      'tool.complete',
      {
        name: 'terminal',
        result: 'ok',
        tool_id: 'live-1'
      },
      200
    )

    expect(finished?.status).toBe('succeeded')

    const merged = mergeSessionActivity([started!], [finished!])
    expect(merged[0]).toMatchObject({ finishedAt: 200, startedAt: 100, status: 'succeeded' })
  })

  it('links an approval to its own activity row and settles it in place', () => {
    const prompt = approvalFromPrompt(
      atlas,
      {
        choices: ['once', 'deny'],
        command: 'rm -rf /tmp/x',
        kind: 'approval',
        question: 'delete files',
        requestId: 'req-1'
      },
      50
    )

    expect(prompt?.status).toBe('waiting')

    const decided = applyApprovalDecision(atlas, [prompt!], 'req-1', 'approved', 'once', 60)
    expect(decided).toHaveLength(1)
    expect(decided[0].approval).toMatchObject({ choice: 'once', status: 'approved' })
    expect(decided[0].status).toBe('succeeded')
  })

  it('keeps an approval decision even when its task already finished', () => {
    const task = tool('done', 10)

    const decided = applyApprovalDecision(atlas, [task], 'req-orphan', 'denied', 'deny', 99, {
      command: 'git push --force',
      kind: 'approval',
      question: 'force push'
    })

    expect(decided.map(item => item.id)).toEqual(['tool:done', 'approval:req-orphan'])
    expect(decided[1].approval?.status).toBe('denied')
    expect(decided[1].status).toBe('cancelled')
  })

  it('pages without crossing sessions', () => {
    mergeIntoSession(
      atlas,
      Array.from({ length: 25 }, (_, i) => tool(`t${i}`, i + 1))
    )

    const page = activityFor($sessionActivity.get(), atlas, 10)
    expect(page.items).toHaveLength(10)
    expect(page.total).toBe(25)
    expect(page.hasMore).toBe(true)
    expect(page.items[0].id).toBe('tool:t24')
    expect(activityFor($sessionActivity.get(), beta).items).toHaveLength(0)
  })

  it('counts attention states and groups by day', () => {
    const now = new Date('2026-11-02T12:00:00Z').getTime()

    const items = [
      tool('yesterday', now - 86_400_000),
      { ...tool('running', now), status: 'running' as const },
      settledApprovalActivity(atlas, 'wait', 'denied', 'deny', now)
    ]

    const counts = activityCounts(items)
    expect(counts.failed).toBe(0)
    expect(counts.running).toBe(1)
    expect(counts.waiting).toBe(0)
    expect(
      groupByDay(
        [...items].sort((a, b) => b.startedAt - a.startedAt),
        now
      )
    ).toHaveLength(2)
  })

  it('truncates a subject to one line', () => {
    expect(oneLine('\n first line \nsecond', 40)).toBe('first line')
    expect(oneLine('x'.repeat(60), 10)).toHaveLength(10)
  })

  it('clears only the requested session', () => {
    mergeIntoSession(atlas, [tool('a', 1)])
    mergeIntoSession(beta, [{ ...tool('b', 2), profile: beta.profile, sessionId: beta.sessionId }])
    decideInSession(atlas, 'req-1', 'approved', 'once')

    clearSessionActivity(atlas)
    expect(activityFor($sessionActivity.get(), atlas).total).toBe(0)
    expect(activityFor($sessionActivity.get(), beta).total).toBe(1)
  })
})
