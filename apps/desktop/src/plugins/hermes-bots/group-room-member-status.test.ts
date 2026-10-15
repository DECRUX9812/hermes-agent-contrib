import { describe, expect, it } from 'vitest'

import { formatElapsed, roomMemberGroups, type RoomMemberSignals } from './group-room-member-status'
import type { GroupMember, GroupPrompt } from './types'

const member = (name: string) => ({ name }) as GroupMember

const ask = (who: string, at: number) =>
  ({
    at,
    group: 'Room',
    kind: 'clarify',
    member: who,
    memberKey: who,
    questions: [],
    requestId: `${who}-${at}`,
    thread: 't'
  }) as GroupPrompt

function signals(overrides: Partial<RoomMemberSignals> = {}): RoomMemberSignals {
  return {
    available: () => true,
    leadMember: null,
    members: [],
    prompts: [],
    working: new Set(),
    workingSince: new Map(),
    ...overrides
  }
}

describe('roomMemberGroups', () => {
  it('puts each member in exactly one group, with waiting beating working beating idle', () => {
    const groups = roomMemberGroups(
      signals({
        members: [member('ada'), member('bo'), member('cy'), member('di')],
        prompts: [ask('ada', 100)],
        working: new Set(['ada', 'bo'])
      })
    )

    expect(groups.waiting.map(e => e.key)).toEqual(['ada'])
    expect(groups.working.map(e => e.key)).toEqual(['bo'])
    expect(groups.idle.map(e => e.key)).toEqual(['cy', 'di'])
    expect(groups.lead).toBeNull()
  })

  it('takes the lead out of its group and reports the lead alone', () => {
    const groups = roomMemberGroups(
      signals({
        leadMember: member('ada'),
        members: [member('ada'), member('bo')],
        working: new Set(['ada'])
      })
    )

    expect(groups.lead?.key).toBe('ada')
    expect(groups.lead?.status).toBe('working')
    expect(groups.working).toHaveLength(0)
    expect(groups.idle.map(e => e.key)).toEqual(['bo'])
  })

  it('keeps an unreachable member in idle, marked offline', () => {
    const groups = roomMemberGroups(
      signals({
        available: m => m.name !== 'bo',
        members: [member('ada'), member('bo')]
      })
    )

    expect(groups.idle.map(e => [e.key, e.status])).toEqual([
      ['ada', 'idle'],
      ['bo', 'offline']
    ])
  })

  it('stamps waiting entries with the prompt time and working entries with the working stamp', () => {
    const groups = roomMemberGroups(
      signals({
        members: [member('ada'), member('bo')],
        prompts: [ask('ada', 500)],
        working: new Set(['bo']),
        workingSince: new Map([['bo', 200]])
      })
    )

    expect(groups.waiting[0]?.since).toBe(500)
    expect(groups.working[0]?.since).toBe(200)
  })

  it('leaves the idle group empty when every member is working', () => {
    const groups = roomMemberGroups(
      signals({
        members: [member('ada'), member('bo')],
        working: new Set(['ada', 'bo'])
      })
    )

    expect(groups.idle).toEqual([])
    expect(groups.working).toHaveLength(2)
  })

  it('keeps the longest-running member first and idle members in name order, offline last', () => {
    const groups = roomMemberGroups(
      signals({
        available: m => m.name !== 'ash',
        members: [member('zed'), member('ash'), member('kai'), member('cy'), member('bo')],
        working: new Set(['kai', 'cy']),
        workingSince: new Map([
          ['kai', 900],
          ['cy', 100]
        ])
      })
    )

    expect(groups.working.map(e => e.member.name)).toEqual(['cy', 'kai'])
    expect(groups.idle.map(e => e.member.name)).toEqual(['bo', 'zed', 'ash'])
  })
})

describe('formatElapsed', () => {
  it('reads minutes and zero-padded seconds, and never goes negative', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(75 * 60_000)).toBe('75:00')
    expect(formatElapsed(-4_000)).toBe('0:00')
  })
})
