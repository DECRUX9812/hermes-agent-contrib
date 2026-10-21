import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AvatarId, NotifyRequest } from '../protocol'
import { AVATAR_IDS } from '../protocol'

import {
  dismissNotification,
  dispatch,
  hoverNotification,
  notify,
  resetNotifications,
  unhoverNotification
} from './director'
import { appendFeed, FEED_CAP, notificationFeedEntry, relativeTime } from './feed'
import { canNotifyNow, isHarnessRequest, NotificationQueue } from './notify'
import { NOTIFY_SETTLE_MS, SettleTimer } from './settle-timer'
import { $avatars, $cards, $feed, type AvatarRuntime, type FeedEntry, type PaneCard } from './store'

function request(avatar: AvatarId, overrides: Partial<NotifyRequest> = {}): NotifyRequest {
  return { avatar, body: 'body', title: 'title', ...overrides }
}

function resetAvatars(): void {
  const out = {} as Record<AvatarId, AvatarRuntime>

  AVATAR_IDS.forEach(id => {
    out[id] = { changedAt: 0, id, pendingNotify: 0, state: 'hidden', visible: false }
  })

  $avatars.set(out)
}

function setState(id: AvatarId, state: AvatarRuntime['state']): void {
  const avatars = $avatars.get()

  $avatars.set({ ...avatars, [id]: { ...avatars[id], state, visible: state !== 'hidden' } })
}

describe('NotificationQueue — per-avatar FIFO (§8.5)', () => {
  it('keeps FIFO order per avatar and never mixes avatars', () => {
    const queue = new NotificationQueue()

    queue.enqueue('muse', { id: 'm1', request: request('muse') })
    queue.enqueue('muse', { id: 'm2', request: request('muse') })
    queue.enqueue('grok', { id: 'g1', request: request('grok') })

    expect(queue.size('muse')).toBe(2)
    expect(queue.size('grok')).toBe(1)
    expect(queue.shift('muse')?.id).toBe('m1')
    expect(queue.shift('grok')?.id).toBe('g1')
    expect(queue.shift('muse')?.id).toBe('m2')
    expect(queue.shift('muse')).toBeUndefined()
    expect(queue.size('muse')).toBe(0)
  })

  it('accepts a NOTIFY only in hidden or idle', () => {
    expect(canNotifyNow('hidden')).toBe(true)
    expect(canNotifyNow('idle')).toBe(true)

    for (const state of [
      'emerging',
      'listening',
      'thinking',
      'responding',
      'celebrating',
      'notifying',
      'hiding'
    ] as const) {
      expect(canNotifyNow(state), state).toBe(false)
    }
  })

  it('treats only the scripted harness as badged content', () => {
    expect(isHarnessRequest(request('muse', { source: 'dev-harness' }))).toBe(true)
    expect(isHarnessRequest(request('muse', { source: 'live' }))).toBe(false)
    expect(isHarnessRequest(request('muse'))).toBe(false)
  })
})

describe('SettleTimer — 9 s read timeout with a hover pause (§8.5)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires the settle callback exactly at the duration', () => {
    const settled: string[] = []
    const timer = new SettleTimer(id => settled.push(id))

    timer.start('a')
    vi.advanceTimersByTime(NOTIFY_SETTLE_MS - 1)
    expect(settled).toEqual([])
    vi.advanceTimersByTime(1)
    expect(settled).toEqual(['a'])
  })

  it('pauses while hovered and resumes with the remaining time', () => {
    const settled: string[] = []
    const timer = new SettleTimer(id => settled.push(id))

    timer.start('a')
    vi.advanceTimersByTime(3_000)
    timer.pause('a')

    expect(timer.isPaused('a')).toBe(true)
    expect(timer.remaining('a')).toBe(NOTIFY_SETTLE_MS - 3_000)

    // Any amount of hovering must not settle the card.
    vi.advanceTimersByTime(60_000)
    expect(settled).toEqual([])

    timer.resume('a')
    vi.advanceTimersByTime(NOTIFY_SETTLE_MS - 3_000 - 1)
    expect(settled).toEqual([])
    vi.advanceTimersByTime(1)
    expect(settled).toEqual(['a'])
  })

  it('cancel drops the timer without settling', () => {
    const settled: string[] = []
    const timer = new SettleTimer(id => settled.push(id))

    timer.start('a')
    timer.cancel('a')
    vi.advanceTimersByTime(NOTIFY_SETTLE_MS * 2)

    expect(settled).toEqual([])
    expect(timer.remaining('a')).toBeNull()
  })
})

describe('activity feed — cap and source labelling (§8.5)', () => {
  it('keeps the newest 50 entries, newest first', () => {
    let entries: FeedEntry[] = []

    for (let index = 0; index < FEED_CAP + 10; index += 1) {
      entries = appendFeed(entries, {
        at: index,
        avatar: 'muse',
        id: `e${index}`,
        kind: 'notify',
        text: `t${index}`
      })
    }

    expect(entries).toHaveLength(FEED_CAP)
    expect(entries[0].id).toBe(`e${FEED_CAP + 9}`)
    expect(entries[FEED_CAP - 1].id).toBe('e10')
  })

  it('labels a harness notification and defaults a live one', () => {
    const harness: PaneCard = {
      avatar: 'muse',
      id: 'n1',
      request: request('muse', { source: 'dev-harness', title: 'scripted' }),
      shownAt: 0
    }

    const live: PaneCard = { avatar: 'grok', id: 'n2', request: request('grok', { title: 'live' }), shownAt: 0 }

    expect(notificationFeedEntry(harness, 5)).toMatchObject({ kind: 'notify', source: 'dev-harness', text: 'scripted' })
    expect(notificationFeedEntry(live, 5).source).toBe('live')
  })

  it('formats short relative times', () => {
    const now = 100_000

    expect(relativeTime(now, now)).toBe('just now')
    expect(relativeTime(now - 30_000, now)).toBe('30s ago')
    expect(relativeTime(now - 120_000, now)).toBe('2m ago')
    expect(relativeTime(now - 7_200_000, now)).toBe('2h ago')
  })
})

describe('avatarDirector.notify — queueing and settle lifecycle (§8.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAvatars()
    $feed.set([])
    resetNotifications()
  })

  afterEach(() => vi.useRealTimers())

  it('shows one card per avatar at a time and holds the next request', () => {
    setState('muse', 'idle')

    const first = notify(request('muse', { title: 'first' }))
    const second = notify(request('muse', { title: 'second' }))

    expect(Object.keys($cards.get())).toEqual([first])

    dismissNotification(first)

    expect(Object.keys($cards.get())).toEqual([second])
  })

  it('lets two different avatars show a card simultaneously', () => {
    setState('muse', 'idle')
    setState('grok', 'idle')

    const muse = notify(request('muse'))
    const grok = notify(request('grok'))

    expect(Object.keys($cards.get()).sort()).toEqual([muse, grok].sort())
  })

  it('makes a hidden avatar emerge first and opens the card only in notifying', () => {
    const id = notify(request('muse'))

    expect($avatars.get().muse.state).toBe('emerging')
    expect($cards.get()[id]).toBeUndefined()

    dispatch('muse', 'EMERGED')

    expect($avatars.get().muse.state).toBe('notifying')
    expect($cards.get()[id]).toBeDefined()
  })

  it('holds a request while the avatar is busy and delivers on the next idle', () => {
    setState('muse', 'listening')

    const id = notify(request('muse'))

    expect($cards.get()[id]).toBeUndefined()
    expect($avatars.get().muse.state).toBe('listening')

    dispatch('muse', 'COMPOSER_CLOSE')

    // The request is delivered the moment the avatar reaches idle, which is the
    // same tick: the machine goes straight on to notifying.
    expect($avatars.get().muse.state).toBe('notifying')
    expect($cards.get()[id]).toBeDefined()
  })

  it('settles on timeout into the feed and returns the avatar to idle', () => {
    setState('muse', 'idle')

    const id = notify(request('muse', { title: 'An update' }))

    vi.advanceTimersByTime(NOTIFY_SETTLE_MS)

    expect($cards.get()[id]).toBeUndefined()
    expect($avatars.get().muse.state).toBe('idle')
    expect($feed.get()[0]).toMatchObject({ kind: 'notify', text: 'An update', avatar: 'muse' })
  })

  it('pauses the settle timer while the card is hovered', () => {
    setState('muse', 'idle')

    const id = notify(request('muse'))

    vi.advanceTimersByTime(3_000)
    hoverNotification(id)
    vi.advanceTimersByTime(30_000)

    expect($cards.get()[id]).toBeDefined()

    unhoverNotification(id)
    vi.advanceTimersByTime(NOTIFY_SETTLE_MS - 3_000)

    expect($cards.get()[id]).toBeUndefined()
  })

  it('collapses a card when its avatar hides mid-notification', () => {
    setState('muse', 'idle')

    const id = notify(request('muse'))

    dispatch('muse', 'DISMISS')

    expect($cards.get()[id]).toBeUndefined()
    expect($feed.get()[0]).toMatchObject({ kind: 'notify' })
  })
})
