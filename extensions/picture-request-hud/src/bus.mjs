/**
 * The dock and the popped-out HUD are separate documents, so they share state
 * as messages over a BroadcastChannel scoped to the extension origin. Text only
 * — a MediaStream cannot cross documents, which is why the stream lives in
 * whichever surface asked for it and the other one mirrors state, not pixels.
 */

import { MSG } from './hud-core.mjs'

const CHANNEL = 'pru.hud'

export function createBus() {
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null
  // Node's BroadcastChannel holds the event loop open, which would hang a test
  // run forever after the last assertion. Browsers have no unref — the optional
  // call is a no-op there and the channel lives as long as the document.
  channel?.unref?.()
  const handlers = new Set()

  if (channel) {
    channel.onmessage = event => {
      for (const handler of handlers) {handler(event.data)}
    }
  }

  return {
    close() {
      handlers.clear()
      channel?.close()
    },
    /** Fire-and-forget. A closed peer is normal, never an error. */
    post(type, payload = {}) {
      try {
        channel?.postMessage({ ...payload, type, at: Date.now() })
      } catch {
        /* structured clone refused something; nothing worth crashing over */
      }
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}

export const bus = createBus()
export { MSG }
