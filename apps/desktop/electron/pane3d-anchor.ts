/**
 * AnchorService — where the avatars sit (architecture §7).
 *
 * `pick()` order:
 *  1. **hermes-browser** — the in-app browser page the user is on. A host that
 *     is hidden (HUD mode) or minimized is not eligible: its kept-alive webview
 *     still reports a rect.
 *  2. **os-window** — the frontmost non-Hermes window (window-below.ts).
 *  3. **desktop** — no window; avatars float above the dock.
 *
 * Guest ids are NOT stable (re-docking creates new ones), so they are
 * re-enumerated on every pick and never cached. The host DOM probe is bounded
 * (`PROBE_TIMEOUT_MS`) so one hung renderer cannot stall the anchor.
 *
 * Session rules:
 *  - `start()` is re-entrant: a second `ready` (dev reload, stale-window
 *    replacement) recomputes and pushes a fresh `init` — including platform and
 *    reducedMotion — but never adds a second poll or another set of listeners.
 *  - Every `start()`/`stop()` bumps a generation token; an async step that
 *    resumes after a stop()/re-start() belongs to a dead session and does
 *    nothing (so an aborted start cannot leak an interval).
 *  - Poll ticks only run while the pane window is visible, and only when the
 *    live anchor actually changed.
 *  - `stop()` clears the poll and removes every window and guest listener.
 *
 * Selection and conversion are pure (pane3d-anchor-pick.ts); the injected
 * handles are declared in pane3d-anchor-types.ts and built for Electron in
 * pane3d-anchor-electron.ts. This file owns the session orchestration.
 */

import type { PaneAnchor, ScreenRect } from '../src/app/pane3d/protocol'

import {
  anchorEqual,
  type AnchorGuestCandidate,
  type AnchorHostCandidate,
  DESKTOP_ANCHOR,
  pickHermesGuest,
  PROBE_TIMEOUT_MS,
  toPaneLocal,
  withTimeout
} from './pane3d-anchor-pick'
import type { AnchorGuestHandle, AnchorPaneWindow, AnchorService, AnchorServiceDeps } from './pane3d-anchor-types'

interface Subscription {
  listeners: Array<[string, () => void]>
  target: { removeListener: (event: string, listener: () => void) => void }
}

interface ComputedAnchor {
  anchor: PaneAnchor
  /** Screen DIP, or null for the desktop anchor (nothing to re-home to). */
  screenRect: ScreenRect | null
}

const HOST_EVENTS = ['blur', 'closed', 'focus', 'move', 'resize'] as const
const GUEST_EVENTS = ['did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const

export function createAnchorService(deps: AnchorServiceDeps): AnchorService {
  const now = deps.now ?? (() => Date.now())
  const pollMs = Math.max(250, deps.pollMs ?? 250)
  const probeTimeoutMs = Math.max(1, deps.probeTimeoutMs ?? PROBE_TIMEOUT_MS)
  const setIntervalFn = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms))
  const clearIntervalFn = deps.clearIntervalFn ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>))

  let running = false
  // Bumped by start() and stop(); an async step resuming with an older token
  // belongs to a dead session and must not touch live state.
  let generation = 0
  let pollHandle: unknown = null
  let prevAnchor: PaneAnchor | null = null
  let lastScreenRect: ScreenRect | null = null
  let picking = false
  let pending = false

  const focusAt = new Map<number, number>()
  let lastFocusedId: number | null = null
  const hostSubs = new Map<number, Subscription>()
  const guestSubs = new Map<number, Subscription>()

  /** A pane that is gone or hidden has nothing to anchor; skip its probes. */
  const panePickable = (): boolean => {
    const pane = deps.getPane()

    return Boolean(pane && !pane.isDestroyed() && pane.isVisible())
  }

  const schedulePick = () => {
    if (!running || !panePickable()) {
      return
    }

    if (picking) {
      pending = true

      return
    }

    void runPick()
  }

  const syncSubscriptions = () => {
    const hosts = deps.listHosts().filter(host => !host.isDestroyed())
    const hostIds = new Set(hosts.map(host => host.id))

    const focused = hosts.find(host => host.isFocused())

    if (focused && lastFocusedId !== focused.id) {
      focusAt.set(focused.id, now())
      lastFocusedId = focused.id
    } else if (!focused) {
      lastFocusedId = null
    }

    hostSubs.forEach((subscription, id) => {
      if (!hostIds.has(id)) {
        subscription.listeners.forEach(([event, listener]) => subscription.target.removeListener(event, listener))
        hostSubs.delete(id)
      }
    })

    hosts.forEach(host => {
      if (hostSubs.has(host.id)) {
        return
      }

      const listeners: Subscription['listeners'] = []

      HOST_EVENTS.forEach(event => {
        const listener = () => {
          if (event === 'focus') {
            focusAt.set(host.id, now())
            lastFocusedId = host.id
          }

          schedulePick()
        }

        host.on(event, listener)
        listeners.push([event, listener])
      })

      hostSubs.set(host.id, { listeners, target: host })
    })

    const guests = deps.listGuests().filter(guest => !guest.isDestroyed())
    const guestIds = new Set(guests.map(guest => guest.webContentsId))

    guestSubs.forEach((subscription, id) => {
      if (!guestIds.has(id)) {
        subscription.listeners.forEach(([event, listener]) => subscription.target.removeListener(event, listener))
        guestSubs.delete(id)
      }
    })

    guests.forEach(guest => {
      if (guestSubs.has(guest.webContentsId)) {
        return
      }

      const listeners: Subscription['listeners'] = []

      GUEST_EVENTS.forEach(event => {
        const listener = () => schedulePick()

        guest.on(event, listener)
        listeners.push([event, listener])
      })

      guestSubs.set(guest.webContentsId, { listeners, target: guest })
    })
  }

  const computeAnchor = async (pane: AnchorPaneWindow): Promise<ComputedAnchor> => {
    const paneBounds = pane.getContentBounds()
    const paneZoom = pane.getZoomFactor()
    const hosts = deps.listHosts().filter(host => !host.isDestroyed())
    const hostById = new Map(hosts.map(host => [host.id, host]))
    const guestsByHost = new Map<number, AnchorGuestHandle[]>()

    deps
      .listGuests()
      .filter(guest => !guest.isDestroyed())
      .forEach(guest => {
        const host = guest.getHost()

        if (!host || !hostById.has(host.id)) {
          return
        }

        guestsByHost.set(host.id, [...(guestsByHost.get(host.id) ?? []), guest])
      })

    const candidates: AnchorHostCandidate[] = []

    for (const [hostId, guestHandles] of guestsByHost) {
      const host = hostById.get(hostId)

      if (!host) {
        continue
      }

      let probed: AnchorGuestCandidate[] = []

      try {
        // One hung host renderer must not stall the anchor forever.
        const result = await withTimeout(host.probeWebviews(), probeTimeoutMs, [])

        probed = Array.isArray(result) ? result : []
      } catch {
        probed = []
      }

      const probedById = new Map(probed.map(item => [item.webContentsId, item]))

      const guests = guestHandles.map(handle => {
        const info = probedById.get(handle.webContentsId)

        // Geometry and focus come from the host DOM probe; the title comes from
        // the guest's own webContents, which knows it even before the page
        // reports one (and survives the probe failing).
        return {
          active: info?.active ?? false,
          rect: info?.rect ?? null,
          title: handle.getTitle() || info?.title || '',
          visible: info?.visible ?? false,
          webContentsId: handle.webContentsId
        }
      })

      // Read host visibility AFTER the async probe: HUD mode can hide the host
      // between the guest handoff and the DOM answer.
      candidates.push({
        bounds: host.getContentBounds(),
        focused: host.isFocused(),
        guests,
        lastFocusedAt: focusAt.get(host.id) ?? 0,
        minimized: host.isMinimized(),
        visible: host.isVisible(),
        windowId: host.id,
        zoom: host.getZoomFactor()
      })
    }

    const picked = pickHermesGuest(candidates)

    if (picked && picked.guest.rect) {
      const host = picked.host
      const local = picked.guest.rect

      const screenRect: ScreenRect = {
        height: local.height * host.zoom,
        width: local.width * host.zoom,
        x: host.bounds.x + local.x * host.zoom,
        y: host.bounds.y + local.y * host.zoom
      }

      return {
        anchor: {
          kind: 'hermes-browser',
          label: picked.guest.title,
          rect: toPaneLocal(screenRect, paneBounds, paneZoom)
        },
        screenRect
      }
    }

    let os = null as Awaited<ReturnType<AnchorServiceDeps['enumerateOsWindow']>>

    try {
      os = await deps.enumerateOsWindow()
    } catch {
      os = null
    }

    if (os && os.bounds.width > 0 && os.bounds.height > 0) {
      return {
        anchor: {
          kind: 'os-window',
          label: os.title || os.app || '',
          rect: toPaneLocal(os.bounds, paneBounds, paneZoom)
        },
        screenRect: os.bounds
      }
    }

    return { anchor: DESKTOP_ANCHOR, screenRect: null }
  }

  /**
   * Re-home the pane to the anchor's display, then convert the rect again
   * against the pane's NEW content origin — a display swap changes it, and the
   * renderer would otherwise be handed coordinates from the old display.
   */
  const rehomeAnchor = (computed: ComputedAnchor): PaneAnchor => {
    if (!computed.screenRect) {
      return computed.anchor
    }

    deps.rehome?.(computed.screenRect)

    const pane = deps.getPane()

    if (!pane || pane.isDestroyed()) {
      return computed.anchor
    }

    return { ...computed.anchor, rect: toPaneLocal(computed.screenRect, pane.getContentBounds(), pane.getZoomFactor()) }
  }

  const pick = async (): Promise<PaneAnchor> => {
    syncSubscriptions()

    const pane = deps.getPane()

    if (!pane || pane.isDestroyed()) {
      lastScreenRect = null

      return DESKTOP_ANCHOR
    }

    const computed = await computeAnchor(pane)

    lastScreenRect = computed.screenRect

    return computed.anchor
  }

  const runPick = async (): Promise<void> => {
    const gen = generation

    picking = true

    try {
      const pane = deps.getPane()

      if (!pane || pane.isDestroyed()) {
        return
      }

      const computed = await computeAnchor(pane)

      // stop() or a newer start() owns the service now — drop the stale result.
      if (!running || gen !== generation) {
        return
      }

      if (prevAnchor && anchorEqual(prevAnchor, computed.anchor)) {
        return
      }

      const anchor = rehomeAnchor(computed)

      lastScreenRect = computed.screenRect
      prevAnchor = anchor
      deps.pushState({ anchor, type: 'anchor' })
    } finally {
      picking = false

      if (pending) {
        pending = false

        if (running && gen === generation) {
          schedulePick()
        }
      }
    }
  }

  const start = async (): Promise<void> => {
    const gen = ++generation

    if (!running) {
      running = true
      prevAnchor = null
      syncSubscriptions()
    }

    const pane = deps.getPane()

    const computed: ComputedAnchor =
      pane && !pane.isDestroyed() ? await computeAnchor(pane) : { anchor: DESKTOP_ANCHOR, screenRect: null }

    if (!running || gen !== generation) {
      return
    }

    const anchor = rehomeAnchor(computed)

    lastScreenRect = computed.screenRect
    prevAnchor = anchor

    deps.pushState({
      anchor,
      platform: deps.platform ?? process.platform,
      reducedMotion: deps.reducedMotion?.() ?? false,
      type: 'init'
    })

    // A re-entrant start (second `ready`) refreshes init only — the live poll
    // and the existing listeners stay exactly as they are.
    if (pollHandle === null) {
      pollHandle = setIntervalFn(() => {
        if (running) {
          schedulePick()
        }
      }, pollMs)
    }
  }

  const stop = (): void => {
    running = false
    generation += 1

    if (pollHandle !== null) {
      clearIntervalFn(pollHandle)
      pollHandle = null
    }

    hostSubs.forEach(subscription => {
      subscription.listeners.forEach(([event, listener]) => subscription.target.removeListener(event, listener))
    })
    guestSubs.forEach(subscription => {
      subscription.listeners.forEach(([event, listener]) => subscription.target.removeListener(event, listener))
    })
    hostSubs.clear()
    guestSubs.clear()
    focusAt.clear()
    lastFocusedId = null
    pending = false
  }

  return {
    currentScreenRect: () => lastScreenRect,
    isRunning: () => running,
    pick,
    start,
    stop
  }
}
