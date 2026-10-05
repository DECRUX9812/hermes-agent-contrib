/**
 * AnchorService — where the avatars sit (architecture §7).
 *
 * `pick()` order:
 *  1. **hermes-browser** — the in-app browser page the user is on. Guests come
 *     from `webContents.getAllWebContents()` (type `webview`, not destroyed),
 *     each mapped to its host window via `BrowserWindow.fromWebContents(
 *     guest.hostWebContents)`. The guest whose host is focused (else the most
 *     recently focused host) wins; within a host the `<webview>` that is
 *     visible and holds `document.activeElement` wins. Guest ids are NOT stable
 *     (re-docking creates new ones), so they are re-enumerated on every pick and
 *     never cached.
 *  2. **os-window** — the frontmost non-Hermes window from
 *     `enumerateWindowsFrontToBack` (window-below.ts).
 *  3. **desktop** — no window; avatars float above the dock.
 *
 * The rect is converted to pane-window-local CSS px (screen DIP minus the pane
 * content origin, divided by the pane zoom) because that is the space the
 * renderer lays out in — Chromium UI zoom is per-origin, so the pane renders at
 * the session factor (0.9 on the validation host).
 *
 * Watching: host move/resize/focus/blur/closed and guest did-navigate/
 * did-navigate-in-page/page-title-updated, plus a ≤ 4 Hz poll while the pane is
 * open. `stop()` clears the poll and removes every listener (pane close).
 *
 * The selection rules and conversions are pure and unit-tested; the Electron
 * wiring lives in `createElectronAnchorService` and the orchestration takes
 * injected handles so `stop()` cleanup is provable without Electron.
 */

import { BrowserWindow, systemPreferences, webContents } from 'electron'

import type { PaneAnchor, PaneState, ScreenRect } from '../src/app/pane3d/protocol'

// ── Pure selection + conversion ─────────────────────────────────────────────

export interface AnchorGuestCandidate {
  webContentsId: number
  /** `<webview>` bounding rect in host content-area CSS px, or null if unlaid. */
  rect: ScreenRect | null
  visible: boolean
  /** The host document's activeElement is (inside) this webview. */
  active: boolean
  title: string
}

export interface AnchorHostCandidate {
  windowId: number
  focused: boolean
  /** `performance.now()`-style stamp of the last focus, 0 if never. */
  lastFocusedAt: number
  /** Host content bounds, screen DIP. */
  bounds: ScreenRect
  zoom: number
  guests: AnchorGuestCandidate[]
}

const usableGuest = (candidate: AnchorGuestCandidate): boolean =>
  candidate.visible && candidate.rect != null && candidate.rect.width > 0 && candidate.rect.height > 0

/**
 * Best browser guest across all Hermes host windows. Prefers the focused host,
 * then the most recently focused one; within that host prefers the guest that
 * holds the active element, then the first visible one.
 */
export function pickHermesGuest(
  hosts: AnchorHostCandidate[]
): { guest: AnchorGuestCandidate; host: AnchorHostCandidate } | null {
  const eligible = hosts.filter(host => host.guests.some(usableGuest))

  if (eligible.length === 0) {
    return null
  }

  const focused = eligible.find(host => host.focused)
  const host = focused ?? [...eligible].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0]
  const guests = host.guests.filter(usableGuest)
  const guest = guests.find(candidate => candidate.active) ?? guests[0]

  return { guest, host }
}

/**
 * Screen DIP → pane-window-local CSS px. The pane content origin is subtracted
 * in DIP, then the zoom converts DIP to CSS (the renderer's space). A broken
 * zoom is treated as 1 rather than collapsing every rect to nothing.
 */
export function toPaneLocal(rect: ScreenRect, paneOrigin: { x: number; y: number }, zoomFactor = 1): ScreenRect {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1

  return {
    height: rect.height / zoom,
    width: rect.width / zoom,
    x: (rect.x - paneOrigin.x) / zoom,
    y: (rect.y - paneOrigin.y) / zoom
  }
}

/** Change detection: same kind/label and every rect edge within `tolerance` px. */
export function anchorEqual(a: PaneAnchor, b: PaneAnchor, tolerance = 1): boolean {
  return (
    a.kind === b.kind &&
    a.label === b.label &&
    Math.abs(a.rect.x - b.rect.x) <= tolerance &&
    Math.abs(a.rect.y - b.rect.y) <= tolerance &&
    Math.abs(a.rect.width - b.rect.width) <= tolerance &&
    Math.abs(a.rect.height - b.rect.height) <= tolerance
  )
}

export const DESKTOP_ANCHOR: PaneAnchor = {
  kind: 'desktop',
  label: '',
  rect: { height: 0, width: 0, x: 0, y: 0 }
}

// ── Service orchestration ───────────────────────────────────────────────────

export interface AnchorPaneWindow {
  getContentBounds: () => ScreenRect
  getZoomFactor: () => number
  isDestroyed: () => boolean
}

export interface AnchorHostWindow {
  id: number
  isFocused: () => boolean
  isDestroyed: () => boolean
  getContentBounds: () => ScreenRect
  getZoomFactor: () => number
  /** Ask the host renderer for one record per `<webview>` element. */
  probeWebviews: () => Promise<AnchorGuestCandidate[]>
  on: (event: string, listener: () => void) => void
  removeListener: (event: string, listener: () => void) => void
}

export interface AnchorGuestHandle {
  webContentsId: number
  isDestroyed: () => boolean
  getTitle: () => string
  getHost: () => AnchorHostWindow | null
  on: (event: string, listener: () => void) => void
  removeListener: (event: string, listener: () => void) => void
}

export interface AnchorOsWindow {
  title: string
  app?: string
  /** Screen DIP. */
  bounds: ScreenRect
}

export interface AnchorServiceDeps {
  getPane: () => AnchorPaneWindow | null
  pushState: (state: PaneState) => void
  /** Re-home the pane to the display containing this screen-DIP rect. */
  rehome?: (screenRect: ScreenRect) => void
  listHosts: () => AnchorHostWindow[]
  listGuests: () => AnchorGuestHandle[]
  enumerateOsWindow: () => Promise<AnchorOsWindow | null>
  platform?: NodeJS.Platform
  reducedMotion?: () => boolean
  now?: () => number
  pollMs?: number
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
}

export interface AnchorService {
  /** Begin watching and push `init`. Idempotent. */
  start: () => Promise<void>
  /** Clear the poll and every listener. Idempotent. */
  stop: () => void
  /** Compute the current anchor without pushing it. */
  pick: () => Promise<PaneAnchor>
  /** The last anchor's screen-DIP rect (for the spawn-time display choice). */
  currentScreenRect: () => ScreenRect | null
  isRunning: () => boolean
}

interface Subscription {
  listeners: Array<[string, () => void]>
  target: { removeListener: (event: string, listener: () => void) => void }
}

const HOST_EVENTS = ['blur', 'closed', 'focus', 'move', 'resize'] as const
const GUEST_EVENTS = ['did-navigate', 'did-navigate-in-page', 'page-title-updated'] as const

export function createAnchorService(deps: AnchorServiceDeps): AnchorService {
  const now = deps.now ?? (() => Date.now())
  const pollMs = Math.max(250, deps.pollMs ?? 250)
  const setIntervalFn = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms))
  const clearIntervalFn = deps.clearIntervalFn ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>))

  let running = false
  let pollHandle: unknown = null
  let prevAnchor: PaneAnchor | null = null
  let lastScreenRect: ScreenRect | null = null
  let picking = false
  let pending = false

  const focusAt = new Map<number, number>()
  let lastFocusedId: number | null = null
  const hostSubs = new Map<number, Subscription>()
  const guestSubs = new Map<number, Subscription>()

  const schedulePick = () => {
    if (!running) {
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

  const computeAnchor = async (pane: AnchorPaneWindow): Promise<PaneAnchor> => {
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
        probed = await host.probeWebviews()
      } catch {
        probed = []
      }

      const probedById = new Map((Array.isArray(probed) ? probed : []).map(item => [item.webContentsId, item]))

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

      candidates.push({
        bounds: host.getContentBounds(),
        focused: host.isFocused(),
        guests,
        lastFocusedAt: focusAt.get(host.id) ?? 0,
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

      lastScreenRect = screenRect

      return {
        kind: 'hermes-browser',
        label: picked.guest.title,
        rect: toPaneLocal(screenRect, paneBounds, paneZoom)
      }
    }

    let os: AnchorOsWindow | null = null

    try {
      os = await deps.enumerateOsWindow()
    } catch {
      os = null
    }

    if (os && os.bounds.width > 0 && os.bounds.height > 0) {
      lastScreenRect = os.bounds

      return {
        kind: 'os-window',
        label: os.title || os.app || '',
        rect: toPaneLocal(os.bounds, paneBounds, paneZoom)
      }
    }

    lastScreenRect = null

    return DESKTOP_ANCHOR
  }

  const pick = async (): Promise<PaneAnchor> => {
    syncSubscriptions()
    const pane = deps.getPane()

    if (!pane || pane.isDestroyed()) {
      return DESKTOP_ANCHOR
    }

    return computeAnchor(pane)
  }

  const runPick = async () => {
    picking = true

    try {
      const anchor = await pick()

      if (!running) {
        return
      }

      if (prevAnchor && anchorEqual(prevAnchor, anchor)) {
        return
      }

      prevAnchor = anchor

      if (lastScreenRect && anchor.kind !== 'desktop') {
        deps.rehome?.(lastScreenRect)
      }

      deps.pushState({ anchor, type: 'anchor' })
    } finally {
      picking = false

      if (pending) {
        pending = false
        schedulePick()
      }
    }
  }

  const start = async (): Promise<void> => {
    if (running) {
      return
    }

    running = true
    prevAnchor = null
    syncSubscriptions()

    const pane = deps.getPane()
    const anchor = pane && !pane.isDestroyed() ? await computeAnchor(pane) : DESKTOP_ANCHOR

    if (!running) {
      return
    }

    prevAnchor = anchor

    if (lastScreenRect && anchor.kind !== 'desktop') {
      deps.rehome?.(lastScreenRect)
    }

    deps.pushState({
      anchor,
      platform: deps.platform ?? process.platform,
      reducedMotion: deps.reducedMotion?.() ?? false,
      type: 'init'
    })

    pollHandle = setIntervalFn(() => {
      if (!running) {
        return
      }

      schedulePick()
    }, pollMs)
  }

  const stop = (): void => {
    running = false

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

// ── Electron wiring ─────────────────────────────────────────────────────────

/** One record per `<webview>` element; ids come from the element itself. */
const WEBVIEW_PROBE = `(() => {
  const out = []
  document.querySelectorAll('webview').forEach(el => {
    let id = null
    try { id = typeof el.getWebContentsId === 'function' ? el.getWebContentsId() : null } catch (error) { id = null }
    if (id == null) return
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && r.width > 0 && r.height > 0
    const activeElement = document.activeElement
    const active = activeElement === el || (activeElement instanceof Node && el.contains(activeElement))
    out.push({ active, rect: { height: r.height, width: r.width, x: r.x, y: r.y }, visible, webContentsId: id })
  })
  return out
})()`

export interface ElectronAnchorServiceOptions {
  getPaneWindow: () => BrowserWindow | null
  pushState: (state: PaneState) => void
  rehome?: (screenRect: ScreenRect) => void
}

/** Build the AnchorService against the real Electron windows and guests. */
export function createElectronAnchorService(options: ElectronAnchorServiceOptions): AnchorService {
  // Imported lazily so the pure helper tests never load the native enumerator.
  const enumerateOsWindow = async (): Promise<AnchorOsWindow | null> => {
    const { enumerateWindowsFrontToBack, enumerationFailed } = await import('./window-below')
    const list = await enumerateWindowsFrontToBack(process.pid, true)

    if (enumerationFailed(list)) {
      return null
    }

    const front = list.find(item => item.pid !== process.pid)

    if (!front || !front.bounds.width || !front.bounds.height) {
      return null
    }

    return { app: front.app, bounds: front.bounds, title: front.title }
  }

  return createAnchorService({
    enumerateOsWindow,
    getPane: () => {
      const win = options.getPaneWindow()

      if (!win || win.isDestroyed()) {
        return null
      }

      return {
        getContentBounds: () => win.getContentBounds(),
        getZoomFactor: () => win.webContents.getZoomFactor(),
        isDestroyed: () => win.isDestroyed()
      }
    },
    listGuests: () =>
      webContents
        .getAllWebContents()
        .filter(contents => contents.getType() === 'webview' && !contents.isDestroyed())
        .map(contents => {
          const hostWebContents = contents.hostWebContents

          return {
            getHost: () => {
              const win = hostWebContents ? BrowserWindow.fromWebContents(hostWebContents) : null

              return win && !win.isDestroyed() ? wrapHost(win) : null
            },
            getTitle: () => {
              try {
                return contents.getTitle()
              } catch {
                return ''
              }
            },
            isDestroyed: () => contents.isDestroyed(),
            on: (event, listener) => contents.on(event as never, listener),
            removeListener: (event, listener) => contents.removeListener(event as never, listener),
            webContentsId: contents.id
          }
        }),
    listHosts: () =>
      BrowserWindow.getAllWindows()
        .filter(win => !win.isDestroyed())
        .map(wrapHost),
    platform: process.platform,
    pushState: options.pushState,
    reducedMotion: () => {
      try {
        return Boolean(systemPreferences.getAnimationSettings().prefersReducedMotion)
      } catch {
        return false
      }
    },
    rehome: options.rehome
  })
}

function wrapHost(win: Electron.BrowserWindow): AnchorHostWindow {
  return {
    getContentBounds: () => win.getContentBounds(),
    getZoomFactor: () => win.webContents.getZoomFactor(),
    id: win.id,
    isDestroyed: () => win.isDestroyed(),
    isFocused: () => win.isFocused(),
    on: (event, listener) => win.on(event as never, listener),
    probeWebviews: async () => {
      try {
        const result = await win.webContents.executeJavaScript(WEBVIEW_PROBE)

        return Array.isArray(result) ? (result as AnchorGuestCandidate[]) : []
      } catch {
        return []
      }
    },
    removeListener: (event, listener) => win.removeListener(event as never, listener)
  }
}
