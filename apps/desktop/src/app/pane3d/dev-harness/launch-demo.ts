/**
 * The launch demo (architecture §11): a choreography of REAL director calls,
 * not a mock — Muse emerges, the Instagram update card settles, Grok emerges and
 * the room greets, then Grok's composer opens with captured page context and a
 * pre-filled line. The user (or a validator) submits; the result carries the
 * demo chart and the live presenter shows it (§8.9).
 *
 * LABELLED scaffolding: everything here is the dev harness. The notification
 * carries `source:'dev-harness'` (its card and feed entry are badged) and the
 * pre-filled composer is marked the same way. The interfaces it drives
 * (`AvatarDirector`, `TaskExecutor`, `ConversationSource`) live in `director/`
 * and are unaware of this module.
 *
 * `launchStep` is the whole choreography as a pure table, so the ordering and
 * both fallback paths are provable without a running pane; the runtime half
 * below turns each stage's effects into calls and watches the REAL signals
 * (a transition out of `notifying`, a logged greeting, the bubble clearing).
 */

import { openComposer } from '../director/composer'
import { avatarDirector } from '../director/director'
import { $avatars, $bubbles, $feed, $transitions, type FeedEntry, type SpeechBubble } from '../director/store'
import type { AvatarId } from '../protocol'

import { INSTAGRAM_UPDATE } from './demo-feed'

/** Grok's composer opens with this line; the user presses Enter (§11). */
export const LAUNCH_DEMO_DRAFT = 'this looks cool — can you build this for me?'

/**
 * The Muse card is the demo's clock: it settles on close or the 9 s timeout.
 * The deadline only covers a path where the card can never open (its avatar
 * stuck in a task), so the demo always advances.
 */
export const CARD_DEADLINE_MS = 15_000
/** The greeting exchange runs ~6.8 s; a suppressed greeting must not stall the demo. */
export const GREETING_DEADLINE_MS = 10_000
/** How long an avatar may take to reach hidden/idle before the demo gives up on it. */
export const READY_DEADLINE_MS = 4_000

export type LaunchStage = 'off' | 'waiting-card' | 'waiting-greeting' | 'composer'
export type LaunchSignal = 'start' | 'card-settled' | 'card-timeout' | 'greeted' | 'greeting-timeout' | 'cancel'
export type LaunchEffect = 'reset-cast' | 'summon-muse' | 'notify-muse' | 'summon-grok' | 'open-composer'

export interface LaunchStep {
  stage: LaunchStage
  effects: LaunchEffect[]
  /** ms to wait for the greeting before opening the composer anyway; 0 = none. */
  greetingDeadlineMs: number
}

const STEPS: Partial<Record<`${LaunchStage}:${LaunchSignal}`, LaunchStep>> = {
  'off:start': {
    effects: ['reset-cast', 'summon-muse', 'notify-muse'],
    greetingDeadlineMs: 0,
    stage: 'waiting-card'
  },
  'waiting-card:card-settled': {
    effects: ['summon-grok'],
    greetingDeadlineMs: GREETING_DEADLINE_MS,
    stage: 'waiting-greeting'
  },
  'waiting-card:card-timeout': {
    effects: ['summon-grok'],
    greetingDeadlineMs: GREETING_DEADLINE_MS,
    stage: 'waiting-greeting'
  },
  'waiting-greeting:greeted': { effects: ['open-composer'], greetingDeadlineMs: 0, stage: 'composer' },
  'waiting-greeting:greeting-timeout': { effects: ['open-composer'], greetingDeadlineMs: 0, stage: 'composer' }
}

/** The pure choreography. Unlisted pairs (and every repeated signal) are no-ops. */
export function launchStep(stage: LaunchStage, signal: LaunchSignal): LaunchStep {
  if (signal === 'cancel') {
    return { effects: [], greetingDeadlineMs: 0, stage: 'off' }
  }

  return STEPS[`${stage}:${signal}`] ?? { effects: [], greetingDeadlineMs: 0, stage }
}

/**
 * The greeting is over when Grok has actually spoken (the room logs every line
 * to the feed) and the last bubble has come down. Both are real signals from the
 * room; `since` scopes them to this run so a stale exchange cannot count.
 */
export function greetingSettled(
  entries: readonly FeedEntry[],
  bubbles: readonly SpeechBubble[],
  since: number
): boolean {
  const spoke = entries.some(entry => entry.kind === 'chat' && entry.avatar === 'grok' && entry.at >= since)

  return spoke && bubbles.length === 0
}

interface LaunchSession {
  cancelled: boolean
  stage: LaunchStage
  startedAt: number
  disposers: (() => void)[]
}

let active: LaunchSession | null = null

const onPageHide = () => cancelLaunchDemo()

/** Whether a launch demo is still mid-choreography. */
export function isLaunchDemoRunning(): boolean {
  return active !== null
}

/** Start (or restart) the launch demo. A second call cancels the first run. */
export function playLaunchDemo(): void {
  cancelLaunchDemo()

  const session: LaunchSession = { cancelled: false, disposers: [], stage: 'off', startedAt: Date.now() }

  active = session

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
  }

  advance(session, 'start')
}

/**
 * Cancel cleanly — the pane closed, a reload, or a second play. Pending waits
 * resolve, every timer and subscription goes, and no effect runs after this.
 */
export function cancelLaunchDemo(): void {
  const session = active

  active = null

  if (!session) {
    return
  }

  session.cancelled = true
  session.disposers.forEach(dispose => dispose())
  session.disposers = []

  if (typeof window !== 'undefined') {
    window.removeEventListener('pagehide', onPageHide)
  }
}

function track(session: LaunchSession, dispose: () => void): void {
  session.disposers.push(dispose)
}

function advance(session: LaunchSession, signal: LaunchSignal): void {
  if (session.cancelled) {
    return
  }

  const step = launchStep(session.stage, signal)

  if (step.stage === session.stage && step.effects.length === 0) {
    return
  }

  session.stage = step.stage

  if (step.stage === 'waiting-card') {
    watchCardSettled(session)
  } else if (step.stage === 'waiting-greeting') {
    watchGreeting(session, step.greetingDeadlineMs)
  }

  void applyEffects(session, step.effects)
}

async function applyEffects(session: LaunchSession, effects: readonly LaunchEffect[]): Promise<void> {
  for (const effect of effects) {
    if (session.cancelled) {
      return
    }

    await EFFECTS[effect](session)
  }

  // The composer is the last step: the demo is done and the user takes over.
  if (!session.cancelled && session.stage === 'composer') {
    cancelLaunchDemo()
  }
}

const EFFECTS: Record<LaunchEffect, (session: LaunchSession) => Promise<void> | void> = {
  // A replay may leave avatars out or listening; dismissing is a no-op when
  // they are hidden, so a fresh run pays nothing and a replay starts clean.
  'reset-cast': () => {
    avatarDirector.dismiss('muse')
    avatarDirector.dismiss('grok')
  },
  'summon-muse': session => summonWhenReady(session, 'muse'),
  'notify-muse': () => {
    // Muse is emerging here; the director's FIFO holds the request until the
    // machine accepts NOTIFY (hidden/idle), so it is never dropped (§8.5).
    avatarDirector.notify(INSTAGRAM_UPDATE)
  },
  'summon-grok': session => summonWhenReady(session, 'grok'),
  'open-composer': async () => {
    await openComposer('grok', { draft: LAUNCH_DEMO_DRAFT, source: 'dev-harness' })
  }
}

function isReady(id: AvatarId): boolean {
  const state = $avatars.get()[id]?.state

  return state === 'hidden' || state === 'idle'
}

function summonWhenReady(session: LaunchSession, id: AvatarId): Promise<void> {
  return whenReady(session, id).then(() => {
    if (!session.cancelled) {
      avatarDirector.summon(id)
    }
  })
}

function whenReady(session: LaunchSession, id: AvatarId): Promise<void> {
  if (isReady(id)) {
    return Promise.resolve()
  }

  return new Promise<void>(resolve => {
    let settled = false

    const finish = () => {
      if (settled) {
        return
      }

      settled = true
      unsubscribe()
      clearTimeout(timer)
      resolve()
    }

    const unsubscribe = $avatars.subscribe(() => {
      if (session.cancelled || isReady(id)) {
        finish()
      }
    })

    const timer = setTimeout(finish, READY_DEADLINE_MS)

    track(session, finish)
  })
}

function watchCardSettled(session: LaunchSession): void {
  const unsubscribe = $transitions.subscribe(records => {
    if (session.stage !== 'waiting-card') {
      return
    }

    // The card settles on close, timeout or a dismissal: every path leaves
    // `notifying` (§8.1), which is exactly the demo's "card is gone" signal.
    const settled = records.some(
      record => record.avatar === 'muse' && record.from === 'notifying' && record.at >= session.startedAt
    )

    if (settled) {
      advance(session, 'card-settled')
    }
  })

  const timer = setTimeout(() => advance(session, 'card-timeout'), CARD_DEADLINE_MS)

  track(session, unsubscribe)
  track(session, () => clearTimeout(timer))
}

function watchGreeting(session: LaunchSession, deadlineMs: number): void {
  const check = () => {
    if (session.stage === 'waiting-greeting' && greetingSettled($feed.get(), $bubbles.get(), session.startedAt)) {
      advance(session, 'greeted')
    }
  }

  const unsubscribeFeed = $feed.subscribe(check)
  const unsubscribeBubbles = $bubbles.subscribe(check)
  const timer = setTimeout(() => advance(session, 'greeting-timeout'), deadlineMs)

  track(session, unsubscribeFeed)
  track(session, unsubscribeBubbles)
  track(session, () => clearTimeout(timer))
}
