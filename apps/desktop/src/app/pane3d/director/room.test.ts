// Register the cast: each body module calls `registerAvatar`, so the live room
// can resolve display names when it logs an exchange to the feed.
import '../avatars/claude'
import '../avatars/grok'
import '../avatars/hermes'
import '../avatars/muse'
import '../avatars/opencode'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AVATAR_IDS, type AvatarId } from '../protocol'
import { avatarFrames } from '../scene/projection'

import {
  BOW_MS,
  BOW_PITCH,
  bowPitch,
  BUBBLE_MS,
  chatFeedEntry,
  type ConversationLine,
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
  setConversationSource,
  TURN_YAW
} from './room'
import { getFacingTarget, greetingPartner, startRoom } from './room-live'
import { $avatars, $bubbles, $cards, $feed, type AvatarRuntime, type AvatarState } from './store'

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

  it('faces a live greeting pair at each other when it is not the nearest pair', () => {
    // Muse+Grok are nearest; the newcomer Claude greets Grok, which sits 500 px
    // away from it and only 100 px from Muse.
    const entries = [pos('muse', 100), pos('grok', 200), pos('claude', 700)]
    const targets = facingTargets(entries, ['claude', 'grok'])

    expect(targets.muse).toBe(0)
    expect(targets.grok).toBeGreaterThan(0)
    expect(targets.claude).toBeLessThan(0)
    expect(targets.grok).toBeCloseTo(-targets.claude, 5)
  })

  it('falls back to the nearest pair once the greeting pair is no longer on stage', () => {
    const entries = [pos('muse', 100), pos('grok', 200)]
    const targets = facingTargets(entries, ['claude', 'grok'])

    expect(targets.muse).toBeGreaterThan(0)
    expect(targets.grok).toBeLessThan(0)
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

describe('AvatarRoom lifecycle — quiet mode and dismissed participants (§8.6, VAL-ROOM-004)', () => {
  let stop: (() => void) | null = null

  function runtime(id: AvatarId, state: AvatarState): AvatarRuntime {
    return { changedAt: 0, id, pendingNotify: 0, state, visible: state !== 'hidden' }
  }

  function setStates(states: Partial<Record<AvatarId, AvatarState>>): void {
    const next = {} as Record<AvatarId, AvatarRuntime>

    AVATAR_IDS.forEach(id => {
      next[id] = runtime(id, states[id] ?? 'hidden')
    })

    $avatars.set(next)
  }

  function place(id: AvatarId, x: number): void {
    avatarFrames[id].screenRect = { height: 130, width: 90, x: x - 45, y: 0 }
  }

  const scripted = {
    isDevHarness: true,
    label: 'test',
    next: (speaker: AvatarId, listener: AvatarId): ConversationLine => ({
      listener,
      speaker,
      text: `${speaker} to ${listener}`
    })
  }

  /** Muse is already out; Grok's completed emergence triggers the greeting. */
  function emergeGrok(): void {
    setStates({ grok: 'emerging', muse: 'idle' })
    setStates({ grok: 'idle', muse: 'idle' })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    place('muse', 100)
    place('grok', 200)
    place('claude', 700)
    place('hermes', 1100)
    place('opencode', 1400)
    $feed.set([])
    $bubbles.set([])
    $cards.set({})
    setConversationSource(scripted)
    setStates({ muse: 'idle' })
    stop = startRoom()
  })

  afterEach(() => {
    stop?.()
    stop = null
    setConversationSource(null)
    $cards.set({})
    $bubbles.set([])
    $feed.set([])
    vi.useRealTimers()
  })

  it('clears the live bubble the moment a composer opens and logs no further line', () => {
    emergeGrok()
    vi.advanceTimersByTime(BOW_MS)
    expect($bubbles.get()).toHaveLength(1)
    expect($feed.get()).toHaveLength(1)

    // The composer opens on Muse mid-exchange → quiet mode.
    setStates({ grok: 'idle', muse: 'listening' })

    expect($bubbles.get()).toEqual([])
    expect($feed.get()).toHaveLength(1)

    vi.advanceTimersByTime(BUBBLE_MS)

    expect($feed.get()).toHaveLength(1)
    expect($bubbles.get()).toEqual([])
  })

  it('clears the live bubble the moment a notification card opens', () => {
    emergeGrok()
    vi.advanceTimersByTime(BOW_MS)
    expect($bubbles.get()).toHaveLength(1)

    $cards.set({ c1: { avatar: 'muse', id: 'c1', request: { avatar: 'muse', body: 'b', title: 't' }, shownAt: 0 } })

    expect($bubbles.get()).toEqual([])

    vi.advanceTimersByTime(BUBBLE_MS)

    expect($feed.get()).toHaveLength(1)
  })

  it('cancels the exchange when a participant is dismissed — no hidden-speaker line', () => {
    emergeGrok()
    vi.advanceTimersByTime(BOW_MS)
    expect($bubbles.get()).toHaveLength(1)

    // Muse, the listener, leaves the stage mid-exchange.
    setStates({ grok: 'idle' })

    expect($bubbles.get()).toEqual([])

    vi.advanceTimersByTime(BUBBLE_MS)

    expect($feed.get()).toHaveLength(1)
    expect($feed.get().some(entry => entry.text.startsWith('Muse →'))).toBe(false)
    expect($bubbles.get().some(bubble => bubble.avatar === 'muse')).toBe(false)
  })

  it('faces the greeting pair at each other for the exchange, then reverts to the nearest pair', () => {
    // Three idle avatars: Muse(100)+Grok(200) are nearest, but the newcomer
    // Claude(700) greets Grok — the pair that actually speaks.
    setStates({ claude: 'emerging', grok: 'idle', muse: 'idle' })
    setStates({ claude: 'idle', grok: 'idle', muse: 'idle' })

    expect(getFacingTarget('claude')).toBeLessThan(0)
    expect(getFacingTarget('grok')).toBeGreaterThan(0)
    expect(getFacingTarget('muse')).toBe(0)

    vi.advanceTimersByTime(exchangeDurationMs())

    expect(getFacingTarget('muse')).toBeGreaterThan(0)
    expect(getFacingTarget('grok')).toBeLessThan(0)
    expect(getFacingTarget('claude')).toBe(0)
  })
})
