import type { AvatarId, NotifyRequest, PaneControl } from '../protocol'

import { notificationFeedEntry } from './feed'
import { type AvatarEvent, transition } from './machine'
import { canNotifyNow, NotificationQueue, type QueuedNotification } from './notify'
import { SettleTimer } from './settle-timer'
import {
  $avatars,
  $cards,
  type AvatarRuntime,
  type AvatarState,
  type PaneCard,
  pushFeed,
  recordTransition
} from './store'

/**
 * The AvatarDirector's transition entry point and notification lifecycle
 * (architecture §8.1, §8.5).
 *
 * `dispatch` is the only writer of an avatar's state: it runs the pure machine,
 * ignores no-ops by identity (so unlisted events record nothing), mirrors the
 * new state into `$avatars` and appends to the transition log. `summon` /
 * `dismiss` are the two commands the dock and chips use.
 *
 * Notifications are queued per avatar (FIFO, one card at a time). A request
 * that arrives while the machine cannot accept NOTIFY waits in `queue` until
 * its avatar is hidden or idle again — it is never dropped.
 */
export type NotificationSettleReason = 'action' | 'close' | 'timeout' | 'dismissed'

const queue = new NotificationQueue()
/** Requests already dispatched to their avatar, waiting for `notifying`. */
const awaiting = new Map<AvatarId, QueuedNotification>()
/** The open card id per avatar — the "one card per avatar" invariant. */
const activeCards = new Map<AvatarId, string>()
const settle = new SettleTimer(id => collapseNotification(id, 'timeout'))

let sequence = 0

function nextNotificationId(): string {
  sequence += 1

  return `pane-notify-${sequence}`
}

function control(message: PaneControl): void {
  if (typeof window === 'undefined') {
    return
  }

  window.hermesDesktop?.pane3d?.control(message)
}

export function dispatch(id: AvatarId, event: AvatarEvent): void {
  const avatars = $avatars.get()
  const row = avatars[id]

  if (!row) {
    return
  }

  const current = { pendingNotify: row.pendingNotify, state: row.state }
  const next = transition(current, event)

  // Unlisted events and self-transitions return the same object: nothing to do.
  if (next === current) {
    return
  }

  const at = Date.now()

  const updated: AvatarRuntime = {
    ...row,
    changedAt: performance.now(),
    pendingNotify: next.pendingNotify,
    state: next.state,
    visible: next.state !== 'hidden'
  }

  $avatars.set({ ...avatars, [id]: updated })
  recordTransition({ at, avatar: id, event, from: row.state, to: next.state })
  afterTransition(id, row.state, next.state)
}

function afterTransition(id: AvatarId, from: AvatarState, to: AvatarState): void {
  if (to === 'notifying') {
    openCardFor(id)
  } else if (from === 'notifying') {
    const openId = activeCards.get(id)

    // A card must never outlive the avatar's notifying state (e.g. the Hide
    // chip mid-notification): settle it, else it would stay on screen forever.
    if (openId) {
      collapseNotification(openId, 'dismissed')
    }
  }

  if (canNotifyNow(to)) {
    pump(id)
  }
}

function openCardFor(id: AvatarId): void {
  const item = awaiting.get(id)

  // A bare NOTIFY dispatch (no director request behind it) opens nothing.
  if (!item) {
    return
  }

  awaiting.delete(id)
  activeCards.set(id, item.id)

  const card: PaneCard = { avatar: id, id: item.id, request: item.request, shownAt: Date.now() }

  $cards.set({ ...$cards.get(), [item.id]: card })
  settle.start(item.id)
}

function pump(id: AvatarId): void {
  if (activeCards.has(id)) {
    return
  }

  const row = $avatars.get()[id]

  if (!row || !canNotifyNow(row.state)) {
    return
  }

  const item = queue.shift(id)

  if (!item) {
    return
  }

  awaiting.set(id, item)
  // hidden → emerging (the card opens after EMERGED); idle → notifying (now).
  dispatch(id, 'NOTIFY')
}

/** Entry point for `{type:'notify'}` from main: the host owns the id (§4). */
export function deliverNotification(id: string, request: NotifyRequest): void {
  queue.enqueue(request.avatar, { id, request })
  pump(request.avatar)
}

/** Pane-internal entry point (the dev harness); returns the new id. */
export function notify(request: NotifyRequest): string {
  const id = nextNotificationId()

  deliverNotification(id, request)

  return id
}

/** Pointer entered the card: hold it open (§8.5). */
export function hoverNotification(id: string): void {
  settle.pause(id)
}

/** Pointer left the card: resume with the remaining time. */
export function unhoverNotification(id: string): void {
  settle.resume(id)
}

/** The card's action button: round-trips to the host, then settles. */
export function activateNotificationAction(id: string, actionId: string): void {
  if (!$cards.get()[id]) {
    return
  }

  control({ actionId, id, type: 'notify.action' })
  collapseNotification(id, 'action')
}

/** The card's close ×: settles and tells the host it was dismissed. */
export function dismissNotification(id: string): void {
  collapseNotification(id, 'close')
}

function collapseNotification(id: string, reason: NotificationSettleReason): void {
  const card = $cards.get()[id]

  if (!card) {
    return
  }

  settle.cancel(id)
  activeCards.delete(card.avatar)

  const cards = { ...$cards.get() }

  delete cards[id]
  $cards.set(cards)
  pushFeed(notificationFeedEntry(card, Date.now()))

  if (reason !== 'action') {
    control({ id, type: 'notify.dismissed' })
  }

  // notifying → idle; the pump that follows shows the next queued request.
  dispatch(card.avatar, 'NOTIFY_SETTLED')
}

export function summon(id: AvatarId): void {
  dispatch(id, 'SUMMON')
}

export function dismiss(id: AvatarId): void {
  dispatch(id, 'DISMISS')
}

/** The director surface other modules (and the pane) use. */
export const avatarDirector = {
  activateNotificationAction,
  deliverNotification,
  dismiss,
  dismissNotification,
  dispatch,
  hoverNotification,
  notify,
  summon,
  unhoverNotification
}

/** Clears every notification. The pane never calls this; tests do. */
export function resetNotifications(): void {
  queue.clear()
  awaiting.clear()
  activeCards.clear()
  settle.clear()
  sequence = 0
  $cards.set({})
}
