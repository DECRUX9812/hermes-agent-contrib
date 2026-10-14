import { translateNow } from '@/i18n/runtime'
import { $broadcastAvailable, $broadcastOn } from '@/store/broadcast'
import { enqueueQueuedPrompt } from '@/store/composer-queue'
import { notify } from '@/store/notifications'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { TILE_PANE_PREFIX } from '@/store/session-focus'
import { type SessionLiveGroup, sessionLiveSummary } from '@/store/session-live'
import { $sessionTiles, sessionTileDelegate } from '@/store/session-states'

import { requestComposerSubmit } from './composer/focus'
import { $visibleChatZones } from './split-session'

export interface BroadcastTarget {
  storedSessionId: string
  runtimeId: null | string
  group: SessionLiveGroup
  /** The pane's composer routing key: `'main'` or `'tile:<storedSessionId>'`. */
  composerTarget: string
}

export interface BroadcastPorts {
  enqueue: (storedSessionId: string, text: string) => void
  submit: (target: BroadcastTarget & { runtimeId: string }, text: string) => Promise<unknown>
}

export interface BroadcastOutcome {
  sent: number
  queued: number
  skipped: number
  failed: number
}

type Delivery = keyof BroadcastOutcome

async function deliver(target: BroadcastTarget, text: string, ports: BroadcastPorts): Promise<Delivery> {
  if (target.group === 'needs-you') {
    return 'skipped'
  }

  if (target.group === 'working' || target.runtimeId === null) {
    ports.enqueue(target.storedSessionId, text)

    return 'queued'
  }

  try {
    await ports.submit({ ...target, runtimeId: target.runtimeId }, text)

    return 'sent'
  } catch {
    return 'failed'
  }
}

/** One outcome per pane. Panes that need the user are skipped, busy panes queue
 *  the text behind their current turn, idle panes get it sent now. The origin
 *  pane already sent its own copy, so it never receives a second one. */
export async function fanOutBroadcast(
  text: string,
  targets: readonly BroadcastTarget[],
  originStoredSessionId: null | string,
  ports: BroadcastPorts
): Promise<BroadcastOutcome> {
  const deliveries = await Promise.all(
    targets
      .filter(target => target.storedSessionId !== originStoredSessionId)
      .map(target => deliver(target, text, ports))
  )

  const outcome: BroadcastOutcome = { sent: 0, queued: 0, skipped: 0, failed: 0 }

  for (const delivery of deliveries) {
    outcome[delivery] += 1
  }

  return outcome
}

const storedIdOf = (paneId: string): null | string =>
  paneId === 'workspace' ? $selectedStoredSessionId.get() : paneId.slice(TILE_PANE_PREFIX.length)

function visibleTargets(): BroadcastTarget[] {
  return $visibleChatZones.get().flatMap(({ active }) => {
    const storedSessionId = storedIdOf(active)

    if (!storedSessionId) {
      return []
    }

    const runtimeId =
      active === 'workspace'
        ? $activeSessionId.get()
        : ($sessionTiles.get().find(tile => tile.storedSessionId === storedSessionId)?.runtimeId ?? null)

    return [
      {
        storedSessionId,
        runtimeId,
        group: sessionLiveSummary(storedSessionId).get().group,
        composerTarget: active === 'workspace' ? 'main' : `${TILE_COMPOSER_PREFIX}${storedSessionId}`
      }
    ]
  })
}

const ports: BroadcastPorts = {
  enqueue: (storedSessionId, text) => {
    enqueueQueuedPrompt(storedSessionId, { attachments: [], text })
  },
  submit: async ({ composerTarget, runtimeId }, text) => {
    // The pane's own composer paints the user bubble and routes the send like a
    // typed message; the bare runtime submit is the fallback for a composer
    // that is not on screen (a popped-out composer shows only one pane).
    if (requestComposerSubmit(text, { target: composerTarget })) {
      return
    }

    const delegate = sessionTileDelegate()

    if (!delegate) {
      throw new Error('session delegate not ready')
    }

    await delegate.submitToSession(runtimeId, text)
  }
}

const TILE_COMPOSER_PREFIX = 'tile:'

/** The chat pane a composer types into; null for composers outside the panes (the message editor). */
function paneOfComposer(target: string): null | string {
  if (target === 'main') {
    return 'workspace'
  }

  return target.startsWith(TILE_COMPOSER_PREFIX) ? `${TILE_PANE_PREFIX}${target.slice(TILE_COMPOSER_PREFIX.length)}` : null
}

/** Called once per message the user types, after the origin pane sent, steered
 *  or queued it. Hooking the composer's typed-send instead of the session's
 *  submit keeps queue drains out: a drain replays text a broadcast may have
 *  queued, and fanning it out again would echo it around the panes forever. */
export function broadcastTyped(composerTarget: string, text: string): void {
  const originPaneId = paneOfComposer(composerTarget)

  if (originPaneId) {
    broadcastSent(originPaneId, text)
  }
}

/** Slash commands stay local to the pane. */
export function broadcastSent(originPaneId: string, text: string): void {
  if (!$broadcastOn.get() || !$broadcastAvailable.get() || !text.trim() || text.trimStart().startsWith('/')) {
    return
  }

  void fanOutBroadcast(text, visibleTargets(), storedIdOf(originPaneId), ports).then(outcome => {
    notify({
      kind: outcome.failed > 0 ? 'warning' : 'success',
      message: translateNow('composer.broadcastSummary', outcome.sent, outcome.queued, outcome.skipped, outcome.failed)
    })
  })
}
