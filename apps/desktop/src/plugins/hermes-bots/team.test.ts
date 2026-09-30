/**
 * Team Bots display rules — the relationships between a team document and what the page
 * derives from it. Behavior contracts over a fixture team, not snapshots of copy.
 */

import { describe, expect, it } from 'vitest'

import {
  budgetState,
  goalOutline,
  orgDepth,
  pendingApprovals,
  progressLabel,
  seatName,
  type TeamApproval,
  type TeamGoal,
  type TeamLearning,
  type TeamMember,
  type TeamOrgNode,
  topLearnings
} from './team'

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  budget: { hard_stop: true, monthly_usd: null, spent_usd: 0 },
  credentials: [],
  lead: false,
  plugins: [],
  profile: 'writer',
  reports_to: null,
  role: 'Content',
  skills: [],
  slot: 's1',
  status: 'active',
  title: '',
  ...over
})

const goal = (id: string, parent_id: null | string = null, over: Partial<TeamGoal> = {}): TeamGoal => ({
  detail: '',
  id,
  owner: null,
  parent_id,
  status: 'open',
  task_ids: [],
  title: id,
  ...over
})

describe('budgetState', () => {
  const budget = (limit: null | number, spent: number) => ({ hard_stop: true, monthly_usd: limit, spent_usd: spent })

  it('is ok with no cap, whatever was spent', () => {
    expect(budgetState(member({ budget: budget(null, 999) }))).toEqual({ percent: null, tone: 'ok' })
  })

  it('escalates ok → warn → exhausted as spend approaches and passes the cap', () => {
    const tone = (spent: number) => budgetState(member({ budget: budget(10, spent) })).tone
    expect([tone(2), tone(8), tone(10), tone(25)]).toEqual(['ok', 'warn', 'exhausted', 'exhausted'])
  })

  it('never reports more than 100% and lets pause win over any spend state', () => {
    expect(budgetState(member({ budget: budget(10, 40) })).percent).toBe(100)
    expect(budgetState(member({ budget: budget(10, 40), status: 'paused' })).tone).toBe('paused')
  })
})

describe('goalOutline', () => {
  it('nests children under parents, depth-first, keeping sibling order', () => {
    const out = goalOutline([goal('a'), goal('a1', 'a'), goal('b'), goal('a2', 'a'), goal('a1x', 'a1')])
    expect(out.map(o => `${o.depth}:${o.goal.id}`)).toEqual(['0:a', '1:a1', '2:a1x', '1:a2', '0:b'])
  })

  it('floats a goal whose parent vanished to the top level instead of hiding it', () => {
    expect(goalOutline([goal('x', 'gone')]).map(o => o.depth)).toEqual([0])
  })

  it('terminates on a corrupt cycle and shows every goal at most once', () => {
    const out = goalOutline([goal('a', 'b'), goal('b', 'a'), goal('c')])
    expect(new Set(out.map(o => o.goal.id)).size).toBe(out.length)
  })
})

describe('approvals, learnings, labels', () => {
  it('lists only pending approvals, oldest first', () => {
    const a = (id: string, status: string, created_at: number) => ({ created_at, id, status }) as TeamApproval
    expect(pendingApprovals({ approvals: [a('2', 'pending', 20), a('x', 'approved', 1), a('1', 'pending', 10)] }).map(x => x.id)).toEqual(['1', '2'])
  })

  it('ranks learnings by confirmation count, then recency, capped', () => {
    const l = (id: string, count: number, at: number) => ({ at, by: '', count, id, text: id }) as TeamLearning
    expect(topLearnings([l('a', 1, 5), l('b', 3, 1), l('c', 1, 9)], 2).map(x => x.id)).toEqual(['b', 'c'])
  })

  it('names a seat by profile, then title, then role, then the open-seat label', () => {
    expect(seatName({ profile: 'p', role: 'r', title: 't' }, 'Open')).toBe('p')
    expect(seatName({ profile: null, role: 'r', title: 't' }, 'Open')).toBe('t')
    expect(seatName({ profile: null, role: 'r', title: '' }, 'Open')).toBe('r')
    expect(seatName({ profile: null, role: '', title: '' }, 'Open')).toBe('Open')
  })

  it('labels progress only when tasks exist', () => {
    expect(progressLabel({ blocked: false, done: 3, percent: 37, status: 'open', total: 8 }, 'none')).toBe('3/8 · 37%')
    expect(progressLabel(undefined, 'none')).toBe('none')
  })

  it('measures org depth', () => {
    const node = (reports: TeamOrgNode[] = []): TeamOrgNode => ({ ...member(), reports })
    expect(orgDepth([node([node([node()]), node()])])).toBe(3)
    expect(orgDepth([])).toBe(0)
  })
})
