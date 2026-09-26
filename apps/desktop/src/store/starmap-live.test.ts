import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { createClientSessionState } from '@/lib/chat-runtime'
import { makeSessionInfo } from '@/test/session-info'
import type { StarmapGraph, StarmapNode } from '@/types/hermes'

import { $starmapGraph } from './starmap'
import {
  $starmapLive,
  $starmapSettles,
  detectSettles,
  diffStarmapGraphs,
  resolveLiveSkillSessions,
  sameStarmapGraph,
  skillBusyMap,
  startStarmapLive,
  stopStarmapLive
} from './starmap-live'

vi.mock('@/hermes', async importOriginal => {
  const mod = await importOriginal<Record<string, unknown>>()

  return { ...mod, getStarmapGraph: vi.fn() }
})

const { getStarmapGraph } = await import('@/hermes')

const node = (id: string, over: Partial<StarmapNode> = {}): StarmapNode => ({
  category: 'test',
  createdBy: 'agent',
  id,
  kind: 'skill',
  label: id,
  pinned: false,
  state: 'active',
  timestamp: 1_800_000_000,
  useCount: 1,
  ...over
})

const graph = (nodes: StarmapNode[], edges: StarmapGraph['edges'] = []): StarmapGraph => ({
  clusters: [],
  edges,
  memory: [],
  nodes,
  stats: {}
})

const state = (storedId: string, over: Partial<ClientSessionState> = {}): ClientSessionState => ({
  ...createClientSessionState(storedId),
  ...over
})

describe('diffStarmapGraphs', () => {
  const before = graph([node('a'), node('b')], [{ source: 'a', target: 'b' }])

  it('marks a null previous graph as a full structural build', () => {
    expect(diffStarmapGraphs(null, before).structural).toBe(true)
  })

  it('reports only added nodes + new links as a non-structural delta', () => {
    const next = graph([node('a'), node('b'), node('c')], [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' }
    ])

    const delta = diffStarmapGraphs(before, next)

    expect(delta.structural).toBe(false)
    expect([...delta.nodeIds]).toEqual(['c'])
    expect([...delta.linkKeys]).toEqual(['b->c'])
  })

  it('treats a removed node or a moved timestamp as structural', () => {
    expect(diffStarmapGraphs(before, graph([node('a')])).structural).toBe(true)
    expect(diffStarmapGraphs(before, graph([node('a'), node('b', { timestamp: 1 })])).structural).toBe(true)
  })

  it('ignores cosmetic field churn', () => {
    const next = graph([node('a', { useCount: 9 }), node('b')], [{ source: 'a', target: 'b' }])

    expect(diffStarmapGraphs(before, next)).toMatchObject({ structural: false })
  })
})

describe('sameStarmapGraph', () => {
  it('is true for the same payload and false on any rendered difference', () => {
    const a = graph([node('a'), node('b')], [{ source: 'a', target: 'b' }])
    const identical = graph([node('a'), node('b')], [{ source: 'a', target: 'b' }])

    expect(sameStarmapGraph(a, identical)).toBe(true)
    expect(sameStarmapGraph(a, graph([node('a'), node('b', { useCount: 5 })]))).toBe(false)
    expect(sameStarmapGraph(a, graph([node('a'), node('b'), node('c')]))).toBe(false)
    expect(sameStarmapGraph(a, graph([node('a'), node('b')], []))).toBe(false)
  })
})

describe('resolveLiveSkillSessions', () => {
  const sessions = [makeSessionInfo({ id: 's-old', last_active: 10 }), makeSessionInfo({ id: 's-new', last_active: 99 })]

  it('binds a skill to its busiest session, then the most recent', () => {
    const live = resolveLiveSkillSessions(
      {
        'rt-a': state('s-old', { skills: { tools: ['coding'] } }),
        'rt-b': state('s-new', { skills: { tools: ['coding'] } }),
        'rt-c': state('s-other', { busy: true, skills: { tools: ['coding'] } })
      },
      sessions
    )

    // Busy beats recency.
    expect(live.get('coding')).toMatchObject({ busy: true, sessionKey: 'rt-c', storedId: 's-other' })
  })

  it('picks needsInput over idle and newer over older', () => {
    const live = resolveLiveSkillSessions(
      {
        'rt-a': state('s-new', { skills: { tools: ['git'] } }),
        'rt-b': state('s-old', { needsInput: true, skills: { tools: ['git'] } })
      },
      sessions
    )

    expect(live.get('git')?.storedId).toBe('s-old')
  })

  it('resolves a compression tip to its lineage row for recency', () => {
    const rows = [
      makeSessionInfo({ _lineage_ids: ['s-root', 's-tip'], _lineage_root_id: 's-root', id: 's-tip', last_active: 42 })
    ]

    const live = resolveLiveSkillSessions({ 'rt-a': state('s-root', { skills: { '': ['web'] } }) }, rows)

    expect(live.get('web')).toMatchObject({ lastActive: 42, storedId: 's-root' })
  })
})

describe('settle detection', () => {
  it('fires only on a busy → idle edge for a skill', () => {
    const busy = new Map([['coding', true], ['git', true]])
    const next = new Map([['coding', false], ['git', true]])

    expect(detectSettles(busy, next)).toEqual(['coding'])
    // A skill dropping off the map entirely also settles.
    expect(detectSettles(busy, new Map())).toEqual(['coding', 'git'])
    // Never-busy and still-busy don't fire.
    expect(detectSettles(new Map([['x', false]]), new Map())).toEqual([])
  })

  it('skillBusyMap is an OR over bound sessions', () => {
    const busy = skillBusyMap({
      a: state('s1', { busy: true, skills: { t: ['coding'] } }),
      b: state('s2', { skills: { t: ['coding', 'docs'] } })
    })

    expect(busy.get('coding')).toBe(true)
    expect(busy.get('docs')).toBe(false)
  })
})

describe('live lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stopStarmapLive()
    $starmapGraph.set(null)
    $starmapSettles.set({})
  })

  it('start refreshes the graph and arms the poll; stop clears it', async () => {
    vi.mocked(getStarmapGraph).mockResolvedValue(graph([node('a')]))

    vi.useFakeTimers()

    try {
      startStarmapLive()
      expect($starmapLive.get()).toBe(true)

      // Let the immediate refresh resolve.
      await vi.advanceTimersByTimeAsync(0)
      expect($starmapGraph.get()?.nodes.map(n => n.id)).toEqual(['a'])

      // Poll interval refetches — and an unchanged payload does NOT rewrite
      // the graph atom (no sim rebuild / re-jiggle on an idle poll).
      const settled = $starmapGraph.get()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(vi.mocked(getStarmapGraph).mock.calls.length).toBeGreaterThanOrEqual(2)
      expect($starmapGraph.get()).toBe(settled)

      stopStarmapLive()
      const calls = vi.mocked(getStarmapGraph).mock.calls.length
      await vi.advanceTimersByTimeAsync(40_000)
      expect(vi.mocked(getStarmapGraph).mock.calls.length).toBe(calls)
      expect($starmapLive.get()).toBe(false)
    } finally {
      vi.useRealTimers()
      stopStarmapLive()
    }
  })

  it('marks a skill settled when the busy session using it goes idle', async () => {
    vi.mocked(getStarmapGraph).mockResolvedValue(graph([]))
    const { $sessionStates } = await import('./session-states')

    startStarmapLive()
    $sessionStates.set({ rt: state('s1', { busy: true, skills: { tools: ['coding'] } }) })
    expect($starmapSettles.get().coding).toBeUndefined()

    $sessionStates.set({ rt: state('s1', { skills: { tools: ['coding'] } }) })
    expect($starmapSettles.get().coding).toBeTypeOf('number')

    $sessionStates.set({})
    stopStarmapLive()
  })
})
