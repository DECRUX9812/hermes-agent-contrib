import { translateNow } from '@/i18n/runtime'
import { $broadcastAvailable, $broadcastOn } from '@/store/broadcast'
import { enqueueQueuedPrompt } from '@/store/composer-queue'
import { notify } from '@/store/notifications'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { TILE_PANE_PREFIX } from '@/store/session-focus'
import { type SessionLiveGroup, sessionLiveSummary } from '@/store/session-live'
import { $sessionTiles, sessionTileDelegate } from '@/store/session-states'

import { $visibleChatZones } from './split-session'

export interface BroadcastTarget {
  storedSessionId: string
  runtimeId: null | string
  group: SessionLiveGroup
}

export interface BroadcastPorts {
  enqueue: (storedSessionId: string, text: string) => void
  submit: (runtimeId: string, text: string) => Promise<unknown>
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
    await ports.submit(target.runtimeId, text)

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

    return [{ storedSessionId, runtimeId, group: sessionLiveSummary(storedSessionId).get().group }]
  })
}

const ports: BroadcastPorts = {
  enqueue: (storedSessionId, text) => {
    enqueueQueuedPrompt(storedSessionId, { attachments: [], text })
  },
  submit: async (runtimeId, text) => {
    const delegate = sessionTileDelegate()

    if (!delegate) {
      throw new Error('session delegate not ready')
    }

    await delegate.submitToSession(runtimeId, text)
  }
}

export function withBroadcast<A extends [text: string, ...rest: unknown[]], R>(
  originPaneId: string,
  send: (...args: A) => R
): (...args: A) => R {
  return (...args) => {
    const result = send(...args)

    broadcastSent(originPaneId, args[0])

    return result
  }
}

/** Called after the origin pane's own send. Slash commands stay local to the pane. */
export function broadcastSent(originPaneId: string, text: string): void {
  if (!$broadcastOn.get() || !$broadcastAvailable.get() || text.trimStart().startsWith('/')) {
    return
  }

  void fanOutBroadcast(text, visibleTargets(), storedIdOf(originPaneId), ports).then(outcome => {
    notify({
      kind: outcome.failed > 0 ? 'warning' : 'success',
      message: translateNow('composer.broadcastSummary', outcome.sent, outcome.queued, outcome.skipped, outcome.failed)
    })
  })
}
