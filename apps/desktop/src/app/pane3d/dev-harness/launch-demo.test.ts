/**
 * Contract tests for the launch demo (architecture §11, VAL-DEMO-001).
 *
 * The choreography is a pure table (`launchStep`) plus a runtime that watches
 * the REAL director signals: a transition out of `notifying` for the card, a
 * logged greeting line for the room. These tests pin the ordering, both
 * fallback paths and the cancellation, and drive the runtime through the real
 * store with no rig and no bridge (the same seam the pane uses).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dismissNotification, dispatch, hoverNotification, resetNotifications } from '../director/director'
import {
  $avatars,
  $bubbles,
  $cards,
  $composer,
  $feed,
  $transitions,
  type AvatarRuntime,
  type FeedEntry
} from '../director/store'
import type { AvatarId } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import { INSTAGRAM_UPDATE } from './demo-feed'
import {
  cancelLaunchDemo,
  CARD_DEADLINE_MS,
  GREETING_DEADLINE_MS,
  greetingSettled,
  isLaunchDemoRunning,
  LAUNCH_DEMO_DRAFT,
  launchStep,
  playLaunchDemo
} from './launch-demo'

function resetStore(): void {
  const out = {} as Record<AvatarId, AvatarRuntime>

  AVATAR_IDS.forEach(id => {
    out[id] = { changedAt: 0, id, pendingNotify: 0, state: 'hidden', visible: false }
  })

  $avatars.set(out)
  $transitions.set([])
  $composer.set(null)
  $feed.set([])
  $bubbles.set([])
  $cards.set({})
}

beforeEach(() => {
  resetStore()
  resetNotifications()
})

afterEach(() => {
  cancelLaunchDemo()
  vi.useRealTimers()
})

describe('launch demo choreography (pure)', () => {
  it('opens with a clean cast, then summons and notifies Muse', () => {
    expect(launchStep('off', 'start')).toEqual({
      effects: ['reset-cast', 'summon-muse', 'notify-muse'],
      greetingDeadlineMs: 0,
      stage: 'waiting-card'
    })
  })

  it('summons Grok once the card settles — closed, timed out or dismissed', () => {
    const closed = launchStep('waiting-card', 'card-settled')

    expect(closed.stage).toBe('waiting-greeting')
    expect(closed.effects).toEqual(['summon-grok'])
    expect(closed.greetingDeadlineMs).toBe(GREETING_DEADLINE_MS)
    // The card can only time out if it never opened; the demo still advances.
    expect(launchStep('waiting-card', 'card-timeout')).toEqual(closed)
  })

  it('opens the composer after the greeting, or when the greeting is suppressed', () => {
    expect(launchStep('waiting-greeting', 'greeted')).toEqual({
      effects: ['open-composer'],
      greetingDeadlineMs: 0,
      stage: 'composer'
    })
    expect(launchStep('waiting-greeting', 'greeting-timeout')).toEqual(launchStep('waiting-greeting', 'greeted'))
  })

  it('cancels to off from every stage with no effects', () => {
    const stages = ['off', 'waiting-card', 'waiting-greeting', 'composer'] as const

    stages.forEach(stage => {
      expect(launchStep(stage, 'cancel')).toEqual({ effects: [], greetingDeadlineMs: 0, stage: 'off' })
    })
  })

  it('ignores signals that do not belong to the current stage', () => {
    expect(launchStep('off', 'card-settled').effects).toEqual([])
    expect(launchStep('waiting-card', 'greeted').stage).toBe('waiting-card')
    expect(launchStep('composer', 'greeted').effects).toEqual([])
  })

  it('carries the scripted card and the pre-filled line the contract names', () => {
    expect(INSTAGRAM_UPDATE).toMatchObject({
      avatar: 'muse',
      body: 'I posted that reel to your Instagram.',
      source: 'dev-harness',
      title: "Hey — there's an update for you"
    })
    expect(LAUNCH_DEMO_DRAFT).toBe('this looks cool — can you build this for me?')
  })
})

describe('greetingSettled', () => {
  const entry: FeedEntry = { at: 1_000, avatar: 'grok', id: 'x', kind: 'chat', text: 'Grok → Muse: hi' }

  it('is false until Grok has actually spoken', () => {
    expect(greetingSettled([], [], 0)).toBe(false)
    expect(greetingSettled([{ ...entry, kind: 'notify' }], [], 0)).toBe(false)
    expect(greetingSettled([{ ...entry, avatar: 'muse' }], [], 0)).toBe(false)
  })

  it('waits for the last bubble to come down', () => {
    const bubble = { at: 1_000, avatar: 'grok' as const, id: 'x-0', listener: 'muse' as const, text: 'hi' }

    expect(greetingSettled([entry], [bubble], 0)).toBe(false)
    expect(greetingSettled([entry], [], 0)).toBe(true)
  })

  it('ignores an exchange logged before this run started', () => {
    expect(greetingSettled([entry], [], 2_000)).toBe(false)
    expect(greetingSettled([entry], [], 1_000)).toBe(true)
  })
})

describe('launch demo runtime', () => {
  it('plays the story: Muse card → Grok greeting → pre-filled composer', async () => {
    playLaunchDemo()
    expect(isLaunchDemoRunning()).toBe(true)

    await vi.waitFor(() => expect($avatars.get().muse.state).toBe('emerging'))

    // The rig reports the entrance; the queued card then opens, badged.
    dispatch('muse', 'EMERGED')
    expect($avatars.get().muse.state).toBe('notifying')

    const cardId = Object.keys($cards.get())[0]

    expect($cards.get()[cardId]?.request).toEqual(INSTAGRAM_UPDATE)

    // The card settles — the close control, a dismissal or the 9 s timeout.
    dismissNotification(cardId)

    await vi.waitFor(() => expect($avatars.get().grok.state).toBe('emerging'))

    dispatch('grok', 'EMERGED')

    // The room logs the greeting line, then the last bubble comes down.
    $feed.set([
      { at: Date.now(), avatar: 'grok', id: 'chat-1', kind: 'chat', source: 'dev-harness', text: 'Grok → Muse: hi' }
    ])

    await vi.waitFor(() => expect($composer.get()?.draft).toBe(LAUNCH_DEMO_DRAFT))

    expect($composer.get()?.source).toBe('dev-harness')
    expect($avatars.get().grok.state).toBe('listening')
    // The demo hands over once the composer is up; nothing else is pending.
    expect(isLaunchDemoRunning()).toBe(false)
  })

  it('a replay waits for this run\u2019s card, not the older one\u2019s dismissal', async () => {
    playLaunchDemo()

    await vi.waitFor(() => expect($avatars.get().muse.state).toBe('emerging'))
    dispatch('muse', 'EMERGED')

    const firstCard = Object.keys($cards.get())[0]

    expect(firstCard).toBeTruthy()

    // The user restarts while the Instagram card is still on screen.
    playLaunchDemo()
    expect($cards.get()[firstCard]).toBeUndefined()
    expect($avatars.get().muse.state).toBe('hiding')

    // Muse is re-summoned; the new request opens a fresh card of its own.
    dispatch('muse', 'HIDDEN')

    await vi.waitFor(() => expect($avatars.get().muse.state).toBe('emerging'))
    dispatch('muse', 'EMERGED')

    const nextCard = Object.keys($cards.get())[0]

    expect(nextCard).toBeTruthy()
    expect(nextCard).not.toBe(firstCard)
    // The old card\u2019s dismissal must not have summoned Grok.
    expect($avatars.get().grok.state).toBe('hidden')

    dismissNotification(nextCard)

    await vi.waitFor(() => expect($avatars.get().grok.state).toBe('emerging'))
  })

  it('keeps waiting on this run\u2019s card well past the fallback deadline', async () => {
    vi.useFakeTimers()
    playLaunchDemo()

    await vi.advanceTimersByTimeAsync(0)
    expect($avatars.get().muse.state).toBe('emerging')

    dispatch('muse', 'EMERGED')

    const card = Object.keys($cards.get())[0]

    expect(card).toBeTruthy()

    // The presenter holds the card open: hovering pauses the 9 s read timer,
    // so settlement lands well past the demo\u2019s 15 s fallback.
    hoverNotification(card)
    await vi.advanceTimersByTimeAsync(CARD_DEADLINE_MS * 2)

    expect($avatars.get().grok.state).toBe('hidden')
    expect(isLaunchDemoRunning()).toBe(true)

    dismissNotification(card)
    await vi.advanceTimersByTimeAsync(0)

    expect($avatars.get().grok.state).toBe('emerging')
  })

  it('advances on the fallback deadlines when the real signals never come', async () => {
    vi.useFakeTimers()
    playLaunchDemo()

    // Muse never finishes emerging, so the card never opens.
    await vi.advanceTimersByTimeAsync(CARD_DEADLINE_MS)
    expect($avatars.get().grok.state).toBe('emerging')

    // Grok never finishes emerging and no greeting is logged.
    await vi.advanceTimersByTimeAsync(GREETING_DEADLINE_MS)

    // The composer cannot open for an avatar that is not idle, but the demo
    // still ends instead of hanging.
    expect($composer.get()).toBeNull()
    expect(isLaunchDemoRunning()).toBe(false)
  })

  it('cancels cleanly: a close mid-flight runs no later effect', async () => {
    playLaunchDemo()

    await vi.waitFor(() => expect($avatars.get().muse.state).toBe('emerging'))
    cancelLaunchDemo()
    expect(isLaunchDemoRunning()).toBe(false)

    // The card settling after the cancel must not summon Grok.
    dispatch('muse', 'EMERGED')
    dispatch('muse', 'NOTIFY_SETTLED')

    await Promise.resolve()

    expect($avatars.get().grok.state).toBe('hidden')
  })
})
