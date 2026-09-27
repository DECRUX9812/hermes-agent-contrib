import { beforeEach, describe, expect, it, vi } from 'vitest'

// Runs feed derivation (revamp A3): the roll-up may only read signals that
// already exist — canonical_session for chat turns, RoutineJob.last_* for
// routines, attention entries for relay failures, room logs + activity for
// group rounds. Invariants under test:
//   1. Chat identity is canonical_session ONLY — a stale or fresher
//      last_session must never produce a card (src/AGENTS.md: recency loses).
//   2. Rooms the bot is not seated in never leak into its feed, and a
//      member-seated room surfaces the bot's own authored replies.

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')

  return pluginSdkMock(host)
})

import { deriveBotRuns } from './bot-runs'
import type { GroupChat, RosterRow } from './types'

function room(log: GroupChat['log'], members: { name: string }[] = []): GroupChat {
  return {
    epoch: 0,
    heldMessages: {},
    holds: {},
    log,
    members: members as GroupChat['members'],
    pinned: false,
    roomId: '',
    running: false,
    watermarks: {}
  }
}

const BOT: RosterRow = {
  canonical_session: {
    last_active: 1_000,
    preview: 'Here is the report you asked for.',
    resolved_id: 's-canonical'
  },
  name: 'research'
}

beforeEach(() => {
  for (const key of Object.keys(host)) {
    delete host[key]
  }
})

describe('deriveBotRuns', () => {
  it('reads canonical_session for the chat card and never last_session', () => {
    const runs = deriveBotRuns({
      bot: {
        ...BOT,
        // A side chat that looks fresher than canonical must not win.
        last_session: { last_active: 9_999, preview: 'side chat draft' }
      },
      now: 2_000_000
    })

    const chat = runs.find(run => run.kind === 'chat')

    expect(chat).toBeDefined()
    expect(chat?.at).toBe(1_000_000)
    expect(chat?.summary).toContain('report you asked for')
    expect(runs.some(run => run.summary.includes('side chat'))).toBe(false)
  })

  it('keeps non-member rooms out of the feed and surfaces authored replies', () => {
    const outsiderRoom = room([
      { at: 50_000, from: { kind: 'member', name: 'research' }, text: 'not its room' }
    ])

    const memberRoom = room(
      [
        { at: 40_000, from: { kind: 'user', name: 'you' }, text: 'kick this off' },
        { at: 45_000, from: { kind: 'member', name: 'research' }, text: 'round done — answer is 42' }
      ],
      [{ name: 'research' }, { name: 'builder' }]
    )

    const runs = deriveBotRuns({
      bot: BOT,
      now: 100_000,
      rooms: {
        Council: memberRoom,
        Stranger: outsiderRoom
      }
    })

    const groupCards = runs.filter(run => run.kind === 'group')

    expect(groupCards).toHaveLength(1)
    expect(groupCards[0].group).toBe('Council')
    expect(groupCards[0].summary).toContain('answer is 42')
    expect(groupCards[0].status).toBe('ok')
  })
})
