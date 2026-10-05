/**
 * AvatarRoom — the PURE half (architecture §8.6).
 *
 * Rate limits, quiet mode, who faces whom, the greeting bow envelope, the
 * exchange timeline and the conversation-source interface. No timers, no store,
 * no three: `room-live.ts` owns the live orchestration and drives these
 * decisions, which keeps every rule here provable without a running pane.
 *
 * Only two things cycle states on their own in the whole pane, and this is one
 * of them (§8.1): a rate-limited greeting, always triggered by a REAL event —
 * an avatar finishing its emergence while another one is out and idle.
 */

import type { AvatarId } from '../protocol'

import type { AvatarState, FeedEntry } from './store'

/** One exchange per pair per 45 s (§8.6). */
export const PAIR_COOLDOWN_MS = 45_000
/** One exchange overall per 20 s (§8.6). */
export const GLOBAL_COOLDOWN_MS = 20_000
/** Every bubble stays up this long; two lines per exchange (§8.6). */
export const BUBBLE_MS = 3_200
export const EXCHANGE_LINES = 2
/** The greeting bow: pitch 10°, 400 ms, driven by the shared Rig (§8.6). */
export const BOW_MS = 400
export const BOW_PITCH = (10 * Math.PI) / 180
/** Facing: the nearest pair turns toward each other, at most ±35° (§8.6). */
export const TURN_YAW = (35 * Math.PI) / 180
/**
 * The turn is a PURE function of elapsed ms, clamped at the end — never a
 * damped step — so a lone avatar is back at yaw 0 well inside the 2 s bound
 * (§8.6, VAL-ROOM-005) however sparsely the software-GL pane draws.
 */
export const FACING_MS = 600
/** Screen distance at which the full ±35° is reached. */
export const TURN_FULL_PX = 140

export interface ConversationContext {
  /** 0-based line index inside the exchange. */
  turn: number
  reason: 'greeting' | 'chatter'
}

export interface ConversationLine {
  speaker: AvatarId
  listener: AvatarId
  text: string
}

/**
 * Where an exchange's text comes from (architecture §8.6). Real interface; the
 * v1 implementation is the labelled harness in
 * `dev-harness/conversation-script.ts`, installed at the composition point.
 */
export interface ConversationSource {
  readonly label: string
  readonly isDevHarness: boolean
  next(speaker: AvatarId, listener: AvatarId, ctx: ConversationContext): ConversationLine | null
}

let source: ConversationSource | null = null

export function setConversationSource(next: ConversationSource | null): void {
  source = next
}

export function getConversationSource(): ConversationSource | null {
  return source
}

export interface QuietReport {
  composerOpen: boolean
  taskRunning: boolean
  cardOpen: boolean
  quiet: boolean
}

/**
 * The room stays quiet while any composer is open, a task is running, or a
 * notification card is open (§8.6). Pure over the avatar states and the number
 * of open cards, so all three clauses are unit-testable.
 */
export function deriveQuiet(states: readonly AvatarState[], openCards: number): QuietReport {
  const composerOpen = states.some(state => state === 'listening')
  const taskRunning = states.some(state => state === 'thinking' || state === 'responding')
  const cardOpen = openCards > 0

  return { cardOpen, composerOpen, quiet: composerOpen || taskRunning || cardOpen, taskRunning }
}

export type ExchangeBlockReason = 'quiet' | 'pair-cooldown' | 'global-cooldown'

export interface ExchangeDecision {
  allowed: boolean
  reason?: ExchangeBlockReason
  /** When the block lifts, for the (optional) chatter retry and for tests. */
  retryAt?: number
}

/** Order-independent key for a pair, so Grok↔Muse and Muse↔Grok share a limit. */
export function pairKey(a: AvatarId, b: AvatarId): string {
  return [a, b].sort().join('+')
}

/**
 * The greeting rate limiter (§8.6): one exchange per pair per 45 s and one
 * exchange overall per 20 s. `decide` never mutates; `commit` is called only
 * when an exchange really starts, so a suppressed attempt never burns a slot.
 */
export class RoomScheduler {
  private readonly lastPairAt = new Map<string, number>()
  private lastGlobalAt = Number.NEGATIVE_INFINITY

  decide(now: number, pair: string, quiet: boolean): ExchangeDecision {
    if (quiet) {
      return { allowed: false, reason: 'quiet' }
    }

    const globalWait = GLOBAL_COOLDOWN_MS - (now - this.lastGlobalAt)

    if (globalWait > 0) {
      return { allowed: false, reason: 'global-cooldown', retryAt: now + globalWait }
    }

    const pairWait = PAIR_COOLDOWN_MS - (now - (this.lastPairAt.get(pair) ?? Number.NEGATIVE_INFINITY))

    if (pairWait > 0) {
      return { allowed: false, reason: 'pair-cooldown', retryAt: now + pairWait }
    }

    return { allowed: true }
  }

  commit(now: number, pair: string): void {
    this.lastPairAt.set(pair, now)
    this.lastGlobalAt = now
  }

  lastPair(pair: string): number | undefined {
    return this.lastPairAt.get(pair)
  }

  lastGlobal(): number {
    return this.lastGlobalAt
  }

  clear(): void {
    this.lastPairAt.clear()
    this.lastGlobalAt = Number.NEGATIVE_INFINITY
  }
}

export interface RoomPosition {
  id: AvatarId
  /** Projected screen-centre x in pane CSS px. */
  x: number
}

/** The two avatars closest to each other; null with fewer than two. */
export function nearestPair(entries: readonly RoomPosition[]): [AvatarId, AvatarId] | null {
  let best: [AvatarId, AvatarId] | null = null
  let bestDistance = Infinity

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const distance = Math.abs(entries[i].x - entries[j].x)

      if (distance < bestDistance) {
        bestDistance = distance
        best = [entries[i].id, entries[j].id]
      }
    }
  }

  return best
}

/** Turn magnitude for a screen-space separation: saturates at ±`maxYaw`. */
export function facingYaw(dx: number, maxYaw: number = TURN_YAW, fullPx: number = TURN_FULL_PX): number {
  if (fullPx <= 0) {
    return 0
  }

  return maxYaw * Math.max(-1, Math.min(1, dx / fullPx))
}

/**
 * Facing targets for the visible+idle avatars (§8.6): the nearest pair turns
 * toward each other, everyone else faces the user (yaw 0). Positive yaw is
 * toward screen-right (§12), so a partner to the left yields a negative yaw and
 * the two members of a pair always carry opposite signs.
 */
export function facingTargets(entries: readonly RoomPosition[]): Record<AvatarId, number> {
  const out = {} as Record<AvatarId, number>

  entries.forEach(entry => {
    out[entry.id] = 0
  })

  const pair = nearestPair(entries)

  if (!pair) {
    return out
  }

  const first = entries.find(entry => entry.id === pair[0])
  const second = entries.find(entry => entry.id === pair[1])

  if (!first || !second) {
    return out
  }

  out[first.id] = facingYaw(second.x - first.x)
  out[second.id] = facingYaw(first.x - second.x)

  return out
}

/**
 * Ease-out cubic between two yaws over `FACING_MS`, clamped at both ends: a
 * pure function of elapsed ms, so the 2 s "back to the user" bound holds at any
 * frame rate (VAL-ROOM-005).
 */
export function facingPose(from: number, to: number, elapsedMs: number, durationMs: number = FACING_MS): number {
  if (elapsedMs <= 0) {
    return from
  }

  if (elapsedMs >= durationMs) {
    return to
  }

  const t = elapsedMs / durationMs

  return from + (to - from) * (1 - (1 - t) ** 3)
}

/**
 * The greeting bow, one pitch over `BOW_MS` (§8.6). Reduced motion skips the
 * gesture entirely (0 at every instant).
 */
export function bowPitch(elapsedMs: number, reducedMotion = false, durationMs: number = BOW_MS): number {
  if (reducedMotion) {
    return 0
  }

  const p = Math.max(0, Math.min(1, elapsedMs / durationMs))

  return BOW_PITCH * Math.sin(Math.PI * p)
}

export interface ExchangeStep {
  turn: number
  speaker: AvatarId
  listener: AvatarId
  /** ms after the exchange starts. */
  atMs: number
  /** ms after the exchange starts at which this bubble comes down. */
  endsMs: number
}

/**
 * The greeting timeline: the bow first, then the bubbles alternate, one line
 * each, `BUBBLE_MS` apart (§8.6). The avatar that just emerged speaks first.
 */
export function exchangePlan(speaker: AvatarId, listener: AvatarId, lines: number = EXCHANGE_LINES): ExchangeStep[] {
  const steps: ExchangeStep[] = []

  for (let turn = 0; turn < lines; turn += 1) {
    const speaks = turn % 2 === 0

    steps.push({
      atMs: BOW_MS + turn * BUBBLE_MS,
      endsMs: BOW_MS + (turn + 1) * BUBBLE_MS,
      listener: speaks ? listener : speaker,
      speaker: speaks ? speaker : listener,
      turn
    })
  }

  return steps
}

export function exchangeDurationMs(lines: number = EXCHANGE_LINES): number {
  return BOW_MS + lines * BUBBLE_MS
}

export interface ChatFeedInput {
  id: string
  speaker: AvatarId
  listenerName: string
  speakerName: string
  text: string
  at: number
  source?: 'live' | 'dev-harness'
}

/** The feed record for one spoken line: `"Grok → Muse: …"`, kind `chat` (§8.6). */
export function chatFeedEntry(input: ChatFeedInput): FeedEntry {
  return {
    at: input.at,
    avatar: input.speaker,
    id: input.id,
    kind: 'chat',
    source: input.source,
    text: `${input.speakerName} → ${input.listenerName}: ${input.text}`
  }
}
