// The lazy page views' module loaders, shared by their `lazy()` definitions
// (contrib/wiring.tsx, contrib/surfaces.tsx) and the idle-time warmup below so
// both always fetch the exact same chunk.

export const loadSettingsView = () => import('./settings')
export const loadCronView = () => import('./cron')
export const loadArtifactsView = () => import('./artifacts')
export const loadCapabilitiesView = () => import('./capabilities')
export const loadMessagingView = () => import('./messaging')

/** The pages a rail click opens most, warmed in this order. */
export const WARM_ROUTE_LOADERS: ReadonlyArray<() => Promise<unknown>> = [
  loadSettingsView,
  loadCronView,
  loadArtifactsView,
  loadCapabilitiesView,
  loadMessagingView
]

type IdleScheduler = (run: () => void) => void

// Electron's Chromium always has requestIdleCallback; the fallback covers the
// browser-hosted renderer and jsdom. The timeout bounds the wait under a busy
// main thread (a streaming session can keep it from ever being idle).
const scheduleIdle: IdleScheduler = run => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => run(), { timeout: 4_000 })
  } else {
    window.setTimeout(run, 200)
  }
}

/**
 * Fetch and evaluate the main routes' chunks after first paint, one per idle
 * slot, so the first rail click mounts from cache instead of waiting on fetch
 * and parse. A failed fetch is ignored: the route's own `lazy()` retries it
 * on click and owns the error UI.
 */
export function warmRouteChunks(
  loaders: ReadonlyArray<() => Promise<unknown>> = WARM_ROUTE_LOADERS,
  schedule: IdleScheduler = scheduleIdle
): void {
  const queue = [...loaders]

  const next = () => {
    const load = queue.shift()

    if (!load) {
      return
    }

    void load()
      .catch(() => undefined)
      .then(() => schedule(next))
  }

  schedule(next)
}
