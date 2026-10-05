import { beforeEach, describe, expect, it } from 'vitest'

import type { AvatarId } from '../protocol'

import {
  BOW_MS,
  BOW_PITCH,
  bowPitch,
  BUBBLE_MS,
  chatFeedEntry,
  deriveQuiet,
  EXCHANGE_LINES,
  exchangeDurationMs,
  exchangePlan,
  facingPose,
  facingTargets,
  facingYaw,
  GLOBAL_COOLDOWN_MS,
  nearestPair,
  PAIR_COOLDOWN_MS,
  pairKey,
  RoomScheduler,
  TURN_YAW
} from './room'
import { greetingPartner } from './room-live'
import type { AvatarState } from './store'

function pos(id: AvatarId, x: number) {
  return { id, x }
}

describe('RoomScheduler — the greeting rate limits (§8.6)', () => {
  let scheduler: RoomScheduler

  beforeEach(() => {
    scheduler = new RoomScheduler()
  })

  it('allows the first exchange and blocks the same pair for 45 s', () => {
    const pair = pairKey('grok', 'muse')

    expect(scheduler.decide(1_000, pair, false).allowed).toBe(true)
    scheduler.commit(1_000, pair)

    const blocked = scheduler.decide(1_000 + PAIR_COOLDOWN_MS - 1, pair, false)

    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toBe('pair-cooldown')
    // Exactly at the limit the pair is free again.
    expect(scheduler.decide(1_000 + PAIR_COOLDOWN_MS, pair, false).allowed).toBe(true)
  })

  it('treats both directions of a pair as the same limit', () => {
    scheduler.commit(0, pairKey('grok', 'muse'))

    // Past the global window, so only the pair limit can still be holding.
    expect(scheduler.decide(GLOBAL_COOLDOWN_MS + 1, pairKey('muse', 'grok'), false).reason).toBe('pair-cooldown')
  })

  it('blocks a different pair for 20 s overall', () => {
    scheduler.commit(0, pairKey('grok', 'muse'))

    const blocked = scheduler.decide(500, pairKey('hermes', 'claude'), false)

    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toBe('global-cooldown')
    expect(blocked.retryAt).toBe(GLOBAL_COOLDOWN_MS)
    expect(scheduler.decide(GLOBAL_COOLDOWN_MS, pairKey('hermes', 'claude'), false).allowed).toBe(true)
  })

  it('reports quiet before any cooldown', () => {
    scheduler.commit(0, pairKey('grok', 'muse'))

    expect(scheduler.decide(1, pairKey('grok', 'muse'), true).reason).toBe('quiet')
  })

  it('a suppressed attempt never burns a slot', () => {
    const pair = pairKey('grok', 'muse')

    expect(scheduler.decide(0, pair, true).allowed).toBe(false)
    expect(scheduler.decide(0, pair, false).allowed).toBe(true)
  })

  it('clear() forgets every limit', () => {
    scheduler.commit(0, pairKey('grok', 'muse'))
    scheduler.clear()

    expect(scheduler.decide(1, pairKey('grok', 'muse'), false).allowed).toBe(true)
    expect(scheduler.lastGlobal()).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('deriveQuiet — the three quiet clauses (§8.6)', () => {
  const states = (...values: AvatarState[]) => values

  it('is quiet while any composer is open', () => {
    const report = deriveQuiet(states('idle', 'listening'), 0)

    expect(report.composerOpen).toBe(true)
    expect(report.quiet).toBe(true)
  })

  it('is quiet while a task is running', () => {
    expect(deriveQuiet(states('idle', 'thinking'), 0).taskRunning).toBe(true)
    expect(deriveQuiet(states('idle', 'responding'), 0).quiet).toBe(true)
  })

  it('is quiet while a notification card is open', () => {
    const report = deriveQuiet(states('idle', 'idle'), 1)

    expect(report.cardOpen).toBe(true)
    expect(report.quiet).toBe(true)
  })

  it('stays talkative when two avatars are simply idle', () => {
    expect(deriveQuiet(states('idle', 'idle'), 0).quiet).toBe(false)
  })
})

describe('nearestPair / facingTargets — facing math (§8.6)', () => {
  it('picks the closest two of three', () => {
    expect(nearestPair([pos('muse', 100), pos('grok', 300), pos('hermes', 1100)])).toEqual(['muse', 'grok'])
  })

  it('has no pair with fewer than two avatars', () => {
    expect(nearestPair([])).toBeNull()
    expect(nearestPair([pos('muse', 100)])).toBeNull()
  })

  it('turns the pair toward each other with opposite yaw signs', () => {
    const targets = facingTargets([pos('muse', 900), pos('grok', 700)])

    // Muse sits to the right and turns left (negative); Grok turns right.
    expect(targets.muse).toBeLessThan(0)
    expect(targets.grok).toBeGreaterThan(0)
    expect(Math.abs(targets.muse)).toBeCloseTo(TURN_YAW, 5)
    expect(Math.abs(targets.grok)).toBeCloseTo(TURN_YAW, 5)
  })

  it('turns only the nearest pair when three are out; the third faces the user', () => {
    const targets = facingTargets([pos('muse', 900), pos('grok', 700), pos('hermes', 100)])

    expect(targets.muse).not.toBe(0)
    expect(targets.grok).not.toBe(0)
    expect(targets.hermes).toBe(0)
  })

  it('faces the user when only one avatar is left', () => {
    expect(facingTargets([pos('muse', 500)])).toEqual({ muse: 0 })
  })

  it('scales the turn down for a small separation and saturates beyond the full distance', () => {
    expect(facingYaw(35, TURN_YAW, 140)).toBeCloseTo(TURN_YAW / 4, 5)
    expect(facingYaw(400, TURN_YAW, 140)).toBeCloseTo(TURN_YAW, 5)
    expect(facingYaw(0)).toBe(0)
  })
})

describe('facingPose — the turn is a bounded pure function (§8.6, VAL-ROOM-005)', () => {
  it('is clamped at both ends', () => {
    expect(facingPose(0.6, 0, 0)).toBe(0.6)
    expect(facingPose(0.6, 0, 600)).toBe(0)
    expect(facingPose(0.6, 0, 5000)).toBe(0)
  })

  it('reaches the target inside the 2 s bound with a monotone ease', () => {
    let previous = 0.6

    for (let elapsed = 0; elapsed <= 600; elapsed += 60) {
      const value = facingPose(0.6, 0, elapsed)

      expect(value).toBeLessThanOrEqual(previous + 1e-9)
      previous = value
    }

    expect(facingPose(0.6, 0, 600)).toBe(0)
  })

  it('honours a reduced-motion snap by being called with duration 0', () => {
    expect(facingPose(0.6, 0, 1, 0)).toBe(0)
  })
})

describe('bowPitch — one small bow, 10° over 400 ms (§8.6)', () => {
  it('starts and ends at zero and peaks at the pitch', () => {
    expect(bowPitch(0)).toBe(0)
    expect(bowPitch(BOW_MS / 2)).toBeCloseTo(BOW_PITCH, 5)
    expect(bowPitch(BOW_MS)).toBeCloseTo(0, 10)
    expect(bowPitch(BOW_MS * 3)).toBeCloseTo(0, 10)
  })

  it('never plays under reduced motion', () => {
    expect(bowPitch(0, true)).toBe(0)
    expect(bowPitch(BOW_MS / 2, true)).toBe(0)
  })

  it('peaks at 10 degrees', () => {
    expect((BOW_PITCH * 180) / Math.PI).toBeCloseTo(10, 5)
  })
})

describe('exchangePlan — two alternating lines after the bow (§8.6)', () => {
  it('has the newcomer speak first, then the listener, one bubble apart', () => {
    const steps = exchangePlan('grok', 'muse')

    expect(steps).toHaveLength(EXCHANGE_LINES)
    expect(steps[0]).toMatchObject({ atMs: BOW_MS, listener: 'muse', speaker: 'grok', turn: 0 })
    expect(steps[1]).toMatchObject({ atMs: BOW_MS + BUBBLE_MS, listener: 'grok', speaker: 'muse', turn: 1 })
    expect(steps[1].atMs - steps[0].atMs).toBe(BUBBLE_MS)
    expect(steps[1].endsMs - steps[0].atMs).toBe(2 * BUBBLE_MS)
    expect(exchangeDurationMs()).toBe(BOW_MS + EXCHANGE_LINES * BUBBLE_MS)
  })
})

describe('chatFeedEntry — the exchange in the shared feed (§8.6, VAL-ROOM-002)', () => {
  it('formats a line as "Grok → Muse: …" with kind chat', () => {
    const entry = chatFeedEntry({
      at: 1_700_000_000_000,
      id: 'room-exchange-1-0',
      listenerName: 'Muse',
      source: 'dev-harness',
      speaker: 'grok',
      speakerName: 'Grok',
      text: 'Muse! Saw the reel go out — clean edit.'
    })

    expect(entry.kind).toBe('chat')
    expect(entry.avatar).toBe('grok')
    expect(entry.source).toBe('dev-harness')
    expect(entry.text).toBe('Grok → Muse: Muse! Saw the reel go out — clean edit.')
  })
})

describe('greetingPartner — who the newcomer greets (§8.6)', () => {
  it('greets its partner in the nearest pair', () => {
    expect(greetingPartner('grok', [pos('muse', 900), pos('grok', 700), pos('hermes', 100)])).toBe('muse')
  })

  it('falls back to the closest idle avatar when it is not in the nearest pair', () => {
    expect(greetingPartner('claude', [pos('muse', 100), pos('grok', 300), pos('claude', 900)])).toBe('grok')
  })

  it('has no partner when it is the only idle avatar', () => {
    expect(greetingPartner('muse', [pos('muse', 500)])).toBeNull()
  })
})
