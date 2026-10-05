/**
 * The live AvatarRoom (architecture §8.6): watches the director for a completed
 * emergence, consults the pure `RoomScheduler`, and runs the greeting — the bow,
 * then alternating speech bubbles, each line logged to the feed. It also keeps
 * the per-frame facing targets the rig tweens toward.
 *
 * Nothing here cycles on its own: an exchange starts only on a REAL transition
 * (`emerging → idle`, i.e. an avatar finishing its entrance while another is out
 * and idle), and the limits in `room.ts` keep it rare. Everything it renders is
 * driven by the scripted `ConversationSource`, so bubbles carry the Dev-harness
 * marker.
 */

import { getAvatar } from '../avatars/registry'
import type { AvatarId } from '../protocol'
import { AVATAR_IDS } from '../protocol'
import { avatarFrames } from '../scene/projection'

import {
  BOW_MS,
  chatFeedEntry,
  deriveQuiet,
  exchangePlan,
  facingTargets,
  getConversationSource,
  nearestPair,
  pairKey,
  type RoomPosition,
  RoomScheduler
} from './room'
import { $avatars, $bubbles, $cards, type AvatarRuntime, pushFeed, type SpeechBubble } from './store'

/**
 * How often facing is re-derived. The rig tweens between targets, so this only
 * has to notice a slot/anchor change — well inside the ≤4 Hz budget (§7).
 */
export const FACING_POLL_MS = 250

const scheduler = new RoomScheduler()
/** Target yaw (radians) per avatar; the rig's pure tween consumes it. */
const facingYawTargets = new Map<AvatarId, number>()
/** `performance.now()` of each avatar's greeting bow; the rig reads the pitch. */
const bows = new Map<AvatarId, number>()

let sequence = 0
let timers: ReturnType<typeof setTimeout>[] = []
let stopActive: (() => void) | null = null

export function getFacingTarget(id: AvatarId): number {
  return facingYawTargets.get(id) ?? 0
}

export function getBowStart(id: AvatarId): number | null {
  return bows.get(id) ?? null
}

function centerX(id: AvatarId): number | null {
  const rect = avatarFrames[id].screenRect

  return rect ? rect.x + rect.width / 2 : null
}

/** Visible AND idle avatars with a projected centre — the facing/chatter set. */
function idlePositions(avatars: Record<AvatarId, AvatarRuntime>): RoomPosition[] {
  const out: RoomPosition[] = []

  AVATAR_IDS.forEach(id => {
    if (!avatars[id].visible || avatars[id].state !== 'idle') {
      return
    }

    const x = centerX(id)

    if (x !== null) {
      out.push({ id, x })
    }
  })

  return out
}

function syncFacing(avatars: Record<AvatarId, AvatarRuntime>): void {
  const targets = facingTargets(idlePositions(avatars))

  AVATAR_IDS.forEach(id => {
    const next = targets[id] ?? 0

    if (facingYawTargets.get(id) !== next) {
      facingYawTargets.set(id, next)
    }
  })
}

/** The room's quiet clauses, live: composer open, task running, card open. */
export function isRoomQuiet(): boolean {
  const avatars = $avatars.get()

  return deriveQuiet(
    AVATAR_IDS.map(id => avatars[id].state),
    Object.keys($cards.get()).length
  ).quiet
}

/**
 * The avatar the newcomer greets: its partner in the nearest pair when the
 * newcomer is part of one, else the idle avatar closest to it.
 */
export function greetingPartner(speaker: AvatarId, positions: readonly RoomPosition[]): AvatarId | null {
  const pair = nearestPair(positions)

  if (pair && (pair[0] === speaker || pair[1] === speaker)) {
    return pair[0] === speaker ? pair[1] : pair[0]
  }

  const others = positions.filter(entry => entry.id !== speaker)

  if (others.length === 0) {
    return null
  }

  const me = positions.find(entry => entry.id === speaker)

  if (!me) {
    return others[0].id
  }

  return others.reduce((best, entry) => (Math.abs(entry.x - me.x) < Math.abs(best.x - me.x) ? entry : best), others[0])
    .id
}

function maybeGreet(speaker: AvatarId, avatars: Record<AvatarId, AvatarRuntime>): void {
  const source = getConversationSource()

  if (!source) {
    return
  }

  const listener = greetingPartner(speaker, idlePositions(avatars))

  if (!listener) {
    return
  }

  const pair = pairKey(speaker, listener)
  const now = Date.now()
  const decision = scheduler.decide(now, pair, isRoomQuiet())

  if (!decision.allowed) {
    return
  }

  // Record only a real exchange: a suppressed attempt never burns the pair or
  // the global slot.
  scheduler.commit(now, pair)
  runExchange(speaker, listener)
}

function runExchange(speaker: AvatarId, listener: AvatarId): void {
  const source = getConversationSource()

  if (!source) {
    return
  }

  const exchangeId = `room-exchange-${(sequence += 1)}`
  const bowAt = performance.now()

  bows.set(speaker, bowAt)
  bows.set(listener, bowAt)
  timers.push(
    setTimeout(() => {
      bows.delete(speaker)
      bows.delete(listener)
    }, BOW_MS)
  )

  // A composer or a card can appear mid-exchange; the room goes quiet at the
  // next line rather than talking over it.
  let aborted = false

  exchangePlan(speaker, listener).forEach(step => {
    timers.push(
      setTimeout(() => {
        if (aborted) {
          return
        }

        if (isRoomQuiet()) {
          aborted = true
          $bubbles.set([])

          return
        }

        const line = source.next(step.speaker, step.listener, { reason: 'greeting', turn: step.turn })

        if (!line) {
          return
        }

        const bubble: SpeechBubble = {
          at: Date.now(),
          avatar: step.speaker,
          id: `${exchangeId}-${step.turn}`,
          listener: step.listener,
          source: source.isDevHarness ? 'dev-harness' : 'live',
          text: line.text
        }

        // One line at a time; exchanges are globally serialized by the limit.
        $bubbles.set([bubble])
        pushFeed(
          chatFeedEntry({
            at: bubble.at,
            id: bubble.id,
            listenerName: getAvatar(step.listener).displayName,
            source: bubble.source,
            speaker: step.speaker,
            speakerName: getAvatar(step.speaker).displayName,
            text: line.text
          })
        )
        timers.push(
          setTimeout(() => {
            if ($bubbles.get().some(current => current.id === bubble.id)) {
              $bubbles.set([])
            }
          }, step.endsMs - step.atMs)
        )
      }, step.atMs)
    )
  })
}

/**
 * Start the room: derive facing whenever the avatars change (and on a slow
 * poll for anchor moves), and greet when an avatar finishes emerging next to an
 * idle neighbour. Returns its own teardown; idempotent so a replayed mount
 * cannot leave two subscribers running.
 */
export function startRoom(): () => void {
  stopActive?.()

  let previous = $avatars.get()

  const unsubscribe = $avatars.subscribe(next => {
    const before = previous

    previous = next
    syncFacing(next)

    AVATAR_IDS.forEach(id => {
      if (before[id].state === 'emerging' && next[id].state === 'idle') {
        maybeGreet(id, next)
      }
    })
  })

  const interval = setInterval(() => syncFacing($avatars.get()), FACING_POLL_MS)

  const stop = () => {
    unsubscribe()
    clearInterval(interval)
    timers.forEach(clearTimeout)
    timers = []
    bows.clear()
    facingYawTargets.clear()
    scheduler.clear()
    $bubbles.set([])

    if (stopActive === stop) {
      stopActive = null
    }
  }

  stopActive = stop

  return stop
}
