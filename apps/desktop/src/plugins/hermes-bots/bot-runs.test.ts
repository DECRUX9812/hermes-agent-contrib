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

import { deriveBotRuns, pickCronRunSessionId } from './bot-runs'
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

describe('replay targets (B4)', () => {
  it('chat and relay cards replay into the canonical session, never a side chat', () => {
    const runs = deriveBotRuns({
      attention: { at: 5_000, message: 'ping from @builder' },
      bot: {
        ...BOT,
        // A fresher side chat must never supply the replay target.
        last_session: { id: 's-side', last_active: 9_999, preview: 'side chat draft' }
      },
      now: 2_000_000
    })

    expect(runs.find(run => run.kind === 'chat')?.replay).toEqual({
      at: 1_000_000,
      sessionId: 's-canonical'
    })
    expect(runs.find(run => run.id === 'attention:5000')?.replay).toEqual({
      at: 5_000,
      sessionId: 's-canonical'
    })
  })

  it('routine cards carry the instant but resolve their session lazily; group cards carry none', () => {
    const at = Date.parse('2026-09-26T00:00:00Z')

    const runs = deriveBotRuns({
      bot: BOT,
      jobs: [
        {
          job_id: 'j1',
          last_run_at: '2026-09-26T00:00:00Z',
          last_status: 'ok',
          name: '[bot:research] Digest'
        }
      ],
      now: at + 60_000,
      rooms: {
        Council: room(
          [{ at: 1, from: { kind: 'member', name: 'research' }, text: 'round done' }],
          [{ name: 'research' }]
        )
      }
    })

    const routine = runs.find(run => run.kind === 'routine')
    // The run's transcript session is looked up on click — the feed must not
    // list cron runs per job just to arm the affordance.
    expect(routine?.replay?.at).toBe(at)
    expect(routine?.replay?.sessionId).toBeUndefined()

    // Room views are not transcript surfaces — no replay affordance.
    expect(runs.find(run => run.kind === 'group')?.replay).toBeUndefined()
  })
})

describe('pickCronRunSessionId', () => {
  it('picks the run session whose start is nearest the card instant', () => {
    expect(
      pickCronRunSessionId(
        [
          { id: 'old', started_at: 100 },
          { id: 'near', started_at: 205 },
          { id: 'later', started_at: 400 }
        ],
        200_000
      )
    ).toBe('near')
  })

  it('skips script-output docs and unstamped rows; empty input stays null', () => {
    expect(
      pickCronRunSessionId(
        [
          { id: 'doc', source: 'cron_output', started_at: 200 },
          { id: 'run', started_at: 300 },
          { id: 'nostamp' }
        ],
        200_000
      )
    ).toBe('run')
    expect(pickCronRunSessionId([{ id: 'doc', source: 'cron_output', started_at: 200 }], 1)).toBeNull()
    expect(pickCronRunSessionId([], 1)).toBeNull()
  })
})
