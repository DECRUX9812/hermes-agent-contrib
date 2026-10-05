import type { AvatarId, NotifyRequest } from '../protocol'

import type { AvatarState } from './store'

/**
 * The per-avatar notification queue (architecture §8.5).
 *
 * The machine only accepts NOTIFY while an avatar is `hidden` or `idle`, so a
 * request that arrives while it is listening/thinking/responding/celebrating/
 * emerging/notifying is HELD here and dispatched later — a notification is
 * never dropped. One card per avatar at a time; different avatars advance
 * independently, so two of them may show a card simultaneously.
 */
export interface QueuedNotification {
  id: string
  request: NotifyRequest
}

/** The only two machine states that accept a NOTIFY event (§8.1). */
export function canNotifyNow(state: AvatarState): boolean {
  return state === 'hidden' || state === 'idle'
}

/** Host notifications are live; only the scripted harness is badged (§11). */
export function isHarnessRequest(request: NotifyRequest): boolean {
  return request.source === 'dev-harness'
}

export class NotificationQueue {
  private readonly queues = new Map<AvatarId, QueuedNotification[]>()

  enqueue(avatar: AvatarId, item: QueuedNotification): void {
    const queue = this.queues.get(avatar)

    if (queue) {
      queue.push(item)
    } else {
      this.queues.set(avatar, [item])
    }
  }

  size(avatar: AvatarId): number {
    return this.queues.get(avatar)?.length ?? 0
  }

  /** Oldest first: the FIFO order is the delivery order. */
  shift(avatar: AvatarId): QueuedNotification | undefined {
    const queue = this.queues.get(avatar)

    if (!queue) {
      return undefined
    }

    const item = queue.shift()

    if (queue.length === 0) {
      this.queues.delete(avatar)
    }

    return item
  }

  clear(): void {
    this.queues.clear()
  }
}
