/**
 * HUD mode for the browser-hosted Desktop — Chrome's Document Picture-in-Picture.
 *
 * Electron's HUD is a second BrowserWindow with its own renderer, so "open the
 * HUD" there means "spawn a window". The browser has no second renderer to
 * spawn: Chrome 116+ hands the page a chromeless, always-on-top OS window via
 * `documentPictureInPicture.requestWindow()`, but that window's document can
 * never be navigated — the WICG spec closes the window on navigation ("PiP
 * windows cannot be navigated; a same-origin navigation closes the window"),
 * and Chromium really does: `location.replace()` on a PiP window fires
 * `pagehide` and leaves the document at about:blank. Verified on Chrome 156.
 *
 * So the PiP window KEEPS the about:blank document it was created with (same
 * origin as the opener) and the HUD is portalled into it: this module builds a
 * host element inside that document, adopts the app's stylesheets and theme,
 * and publishes the host through `$hudPortalHost` so the app's own HUD shell
 * (`app/hud/hud-shell.tsx` → `WiredPane`) renders there with `createPortal`.
 * Same components, different realm — never a lookalike.
 *
 * Three things the PiP window does NOT give us, and which therefore stay
 * Electron-only (do not simulate them here):
 *   - transparency: the PiP window paints an opaque backdrop, so the HUD wears
 *     its solid treatment and the app's theme background is copied across;
 *   - click-through: the window eats every click inside its rectangle, and
 *     `setIgnoreMouseEvents` has no browser equivalent;
 *   - programmatic placement: `moveTo` cannot move a PiP window, so composer
 *     drag stays an Electron gesture (the PiP window is moved by its own OS
 *     frame) and the HUD's own resize handles are disabled, because Chrome
 *     resizes a PiP window natively.
 */

import { readJson, writeJson, writeKey } from '@/lib/storage'

/** The PiP document plus the host element the HUD portal renders into. */
export interface HudPortalHost {
  container: HTMLElement
  document: Document
  /** The PiP window (`window` of `document`). NOT the app window. */
  window: Window
}

/**
 * Where the browser HUD lives, as far as the app is concerned. `store/hud.ts`
 * owns the type and the atom (it is HUD state, not window plumbing) — this
 * module only hands the host over so the app can portal into it.
 */
export type HudHostSink = (host: HudPortalHost | null) => void

export interface HudChangedState {
  open: boolean
  sessionId: null | string
}

/** Why `open()` could not produce a window. Chrome throws DOMExceptions with
 *  exactly these meanings, so the codes are the exception names, lowercased. */
export type HudOpenError = 'failed' | 'not-allowed' | 'unsupported'

export interface HudOpenResult {
  error?: HudOpenError
  ok: boolean
}

/**
 * Chrome's Document-PiP surface. TypeScript's lib.dom still ships no types for
 * it (checked TS 6.0.3), so the pieces this app uses are declared here rather
 * than `any`-casting at every call site.
 */
interface DocumentPipWindow extends Window {
  readonly closed: boolean
  close: () => void
  focus: () => void
  resizeTo: (width: number, height: number) => void
}

interface DocumentPictureInPictureApi {
  readonly window: DocumentPipWindow | null
  requestWindow: (options?: {
    disallowReturnToOpener?: boolean
    height?: number
    preferInitialWindowPlacement?: boolean
    width?: number
  }) => Promise<DocumentPipWindow>
}

interface BrowserHudApi {
  beginMove: () => void
  close: () => Promise<{ ok: boolean }>
  endMove: () => void
  moveBy: (delta: { height: number; width: number }) => void
  nativeDrag: boolean
  onChanged: (callback: (state: HudChangedState) => void) => () => void
  onCursor: (callback: (point: { x: number; y: number } | null) => void) => () => void
  onGameOverlay: (callback: (state: { active: boolean; app: string }) => void) => () => void
  onGoto: (callback: (sessionId: string) => void) => () => void
  open: (request?: { profile?: null | string; sessionId?: null | string }) => Promise<HudOpenResult>
  resetLayout: () => Promise<{ ok: boolean }>
  setBounds: (bounds: { height: number; width: number; x: number; y: number }) => void
  setFrost: (showing: boolean) => Promise<{ ok: boolean }>
  setIgnoreMouse: (ignore: boolean) => void
  setSession: (sessionId: null | string) => void
  setWorkspaceTransfer?: (transferring: boolean) => void
  windowing: {
    clientPlacement: boolean
    controlDrag: boolean
    nativeDrag: boolean
    solid: boolean
    workspaceTransfer: boolean
  }
}

interface BrowserHudOptions {
  /** Hands the PiP document over to the app (`$hudPortalHost.set`). Called
   *  with null on close, BEFORE the container is detached, so React unmounts
   *  the portal while the node it renders into still exists. */
  setHost: HudHostSink
}

interface HudSize {
  height: number
  width: number
}

/** Same 620×320 bar `electron/hud-geometry.ts` spawns, so HUD mode opens at the
 *  same size in both hosts. Kept as a copy rather than an import: `electron/`
 *  is Node-only code and must not leak into the renderer bundle. */
export const HUD_DEFAULT_SIZE: HudSize = { height: 320, width: 620 }

/** The mins the Electron HUD enforces (spawnHudWindow minWidth/minHeight, and
 *  `hudResizeBounds`), applied here so a persisted or clamped size can never be
 *  smaller than the layout can render. */
export const HUD_MIN_SIZE: HudSize = { height: 160, width: 380 }

/** Screen margin kept free around the HUD, so the OS frame's own resize corner
 *  and the PiP window's controls stay reachable. */
const HUD_EDGE_MARGIN = 24

const GEOMETRY_KEY = 'hermes.hud.pip.geometry.v1'

const PORTAL_ID = 'hermes-hud-portal'

type ScreenLike = Pick<Screen, 'availHeight' | 'availWidth'>

function pipApi(): DocumentPictureInPictureApi | null {
  const api = (window as unknown as { documentPictureInPicture?: DocumentPictureInPictureApi })
    .documentPictureInPicture

  return typeof api?.requestWindow === 'function' ? api : null
}

/**
 * Whether this renderer can host the HUD at all.
 *
 * `canUseHud()` in `store/hud.ts` is presence-based (`typeof hud.open ===
 * 'function'`), and it gates both the titlebar button and Ctrl+Shift+H. So the
 * capability test lives HERE, at attach time: a `hud` object that exists but
 * cannot open would light up the affordance and then fail silently (the store
 * ignores `open()`'s result). No Document-PiP, no `hud` member, no button.
 */
export const canHostHudPortal = (): boolean => pipApi() !== null

function finiteSize(value: { height?: unknown; width?: unknown } | null): HudSize | null {
  if (!value) {
    return null
  }

  const width = Number(value.width)
  const height = Number(value.height)

  return Number.isFinite(width) && Number.isFinite(height) ? { height, width } : null
}

/**
 * Clamp a size to what the HUD can actually render on this screen: the same
 * mins as Electron, and never taller/wider than the work area minus a margin
 * (a persisted size from a bigger monitor must not open off-screen).
 *
 * Sizes are CSS pixels — the PiP window's `screen` is already in CSS pixels,
 * so nothing here touches devicePixelRatio; dividing by DPR would shrink the
 * bar to a third of its intended size on a HiDPI display.
 */
export function clampHudSize(size: HudSize, screen: ScreenLike): HudSize {
  const availWidth = Math.round(Number(screen.availWidth))
  const availHeight = Math.round(Number(screen.availHeight))
  const maxWidth = Math.max(HUD_MIN_SIZE.width, availWidth - HUD_EDGE_MARGIN * 2)
  const maxHeight = Math.max(HUD_MIN_SIZE.height, availHeight - HUD_EDGE_MARGIN * 2)

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Math.round(value), min), max)

  return {
    height: clamp(size.height, HUD_MIN_SIZE.height, maxHeight),
    width: clamp(size.width, HUD_MIN_SIZE.width, maxWidth)
  }
}

/** Last size the user settled on, if it is still a sane number. */
export function storedHudSize(): HudSize | null {
  return finiteSize(readJson<{ height?: unknown; width?: unknown }>(GEOMETRY_KEY))
}

export function clearStoredHudSize(): void {
  writeKey(GEOMETRY_KEY, null)
}

function defaultHudSize(screen: ScreenLike = window.screen): HudSize {
  return clampHudSize(HUD_DEFAULT_SIZE, screen)
}

/**
 * Copy the app's stylesheets into the PiP document.
 *
 * The rules are SERIALIZED rather than re-linked: a `<link>` is a fresh network
 * (+ parse) round-trip, and the HUD would paint unstyled for a frame or two
 * inside a window the user just opened. Same-origin sheets all read fine; a
 * cross-origin sheet throws on `cssRules`, and that one falls back to a link.
 *
 * `<base>` is what keeps `url()` references (fonts, icons, background images)
 * resolving: the PiP document's URL is about:blank, which would otherwise
 * resolve them against nothing.
 */
function adoptStyles(target: Document): void {
  const base = target.createElement('base')

  base.href = document.baseURI

  const style = target.createElement('style')
  const rules: string[] = []

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        rules.push(rule.cssText)
      }
    } catch {
      const href = sheet.href

      if (href) {
        const link = target.createElement('link')

        link.rel = 'stylesheet'
        link.href = href
        target.head.append(link)
      }
    }
  }

  style.textContent = rules.join('\n')
  target.head.append(base, style)
}

/**
 * Carry the theme across. The app paints its theme on `<html>` — a class for
 * dark/light, inline custom properties, and the pre-paint background that
 * index.html's anti-white-flash script writes — so the PiP document gets the
 * same attributes and the same inline style. `style.cssText` also carries the
 * UI-scale `zoom`, which is why the HUD opens at the user's chosen text size
 * instead of 100%.
 */
function adoptTheme(target: Document): void {
  const source = document.documentElement
  const root = target.documentElement

  root.className = source.className
  root.style.cssText = source.style.cssText

  for (const attribute of Array.from(source.attributes)) {
    if (attribute.name !== 'class' && attribute.name !== 'style') {
      root.setAttribute(attribute.name, attribute.value)
    }
  }

  // The dropdown/popover max-height rules key off this (styles.css) — a HUD
  // menu must fit the PiP window, not the app window it was copied from.
  root.setAttribute('data-hud-window', '')
  target.body.className = document.body.className

  const reset = target.createElement('style')

  reset.textContent = 'html,body{margin:0;padding:0;height:100%;overflow:hidden;}#' + PORTAL_ID + '{position:fixed;inset:0;}'
  target.head.append(reset)
  target.title = 'Hermes HUD'
}

export function createBrowserHud({ setHost }: BrowserHudOptions): BrowserHudApi {
  let pip: DocumentPipWindow | null = null
  let host: null | HudPortalHost = null
  let sessionId: null | string = null
  const changedListeners = new Set<(state: HudChangedState) => void>()
  // Kept so `onGoto` can return an honest disposer even though a portal HUD
  // cannot be retargeted (see `onGoto`).
  const gotoListeners = new Set<(sessionId: string) => void>()

  const emit = (open: boolean) => {
    for (const listener of changedListeners) {
      listener({ open, sessionId })
    }
  }

  const resize = (win: DocumentPipWindow, size: HudSize) => {
    try {
      // Chrome ignores the requestWindow size hint on some Linux builds
      // (measured: 420×560 in, 1280×720 out), so the size is re-applied after
      // the window exists. It only works while the opener still holds the
      // click/keypress that opened the HUD — which is exactly now.
      win.resizeTo(size.width, size.height)
    } catch {
      // No transient activation left (or the compositor refused): the hint
      // already asked for this size, so the HUD is still usable.
    }
  }

  const persistSize = (win: DocumentPipWindow) => {
    const width = win.outerWidth || win.innerWidth
    const height = win.outerHeight || win.innerHeight

    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      writeJson(GEOMETRY_KEY, { height, width })
    }
  }

  const teardown = (win: DocumentPipWindow) => {
    win.removeEventListener('pagehide', onPageHide)
    win.removeEventListener('resize', onResize)

    if (pip === win) {
      pip = null
    }

    if (host) {
      const previous = host

      host = null
      // Clear the atom first: React unmounts the portal while its container is
      // still in the document, instead of rendering into a detached node.
      setHost(null)
      previous.container.remove()
    }
  }

  const onPageHide = () => {
    const win = pip

    if (!win) {
      return
    }

    // The PiP window was closed from its own OS controls: the window is gone,
    // so there is nothing left to resize or focus — only the broadcast, which
    // is what keeps the titlebar toggle and the app window's handoff truthful.
    teardown(win)
    emit(false)
  }

  const onResize = () => {
    if (pip && !pip.closed) {
      persistSize(pip)
    }
  }

  const buildHost = (win: DocumentPipWindow): HudPortalHost => {
    const target = win.document

    adoptStyles(target)
    adoptTheme(target)

    const container = target.createElement('div')

    container.id = PORTAL_ID
    target.body.append(container)

    return { container, document: target, window: win }
  }

  const open = async (request?: { profile?: null | string; sessionId?: null | string }): Promise<HudOpenResult> => {
    if (typeof request?.sessionId === 'string' && request.sessionId) {
      sessionId = request.sessionId
    }

    if (pip && !pip.closed) {
      // Already up: re-open means "put this conversation in the HUD", and the
      // portal shows whatever this renderer is on — so raising the window is
      // the whole action. Never a second window (Chrome would refuse, and a
      // second HUD would have no owner).
      try {
        pip.focus()
      } catch {
        // Focus is best-effort; some window managers refuse it.
      }

      emit(true)

      return { ok: true }
    }

    const api = pipApi()

    if (!api) {
      return { error: 'unsupported', ok: false }
    }

    // `profile` is deliberately unused: the portal renders THIS renderer's
    // gateway, which adopted its profile at boot. Electron respawns the HUD to
    // switch profiles; there is no second renderer here to re-point.

    const size = clampHudSize(storedHudSize() ?? HUD_DEFAULT_SIZE, window.screen)

    let win: DocumentPipWindow

    try {
      // Must happen while the caller still holds the user gesture: Chrome
      // rejects requestWindow without activation (NotAllowedError).
      win = await api.requestWindow({ height: size.height, width: size.width })
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''

      if (name === 'NotAllowedError') {
        return { error: 'not-allowed', ok: false }
      }

      if (name === 'NotSupportedError') {
        return { error: 'unsupported', ok: false }
      }

      return { error: 'failed', ok: false }
    }

    pip = win
    host = buildHost(win)
    win.addEventListener('pagehide', onPageHide)
    win.addEventListener('resize', onResize)
    resize(win, size)
    setHost(host)
    emit(true)

    return { ok: true }
  }

  const close = async (): Promise<{ ok: boolean }> => {
    const win = pip

    if (!win || win.closed) {
      // Idempotent: a close after the user dismissed the window (pagehide
      // already broadcast) or a second close must be a no-op, not a throw.
      pip = null

      return { ok: true }
    }

    // Detach first so closing cannot race a pagehide broadcast into a second
    // `open: false` — every `onChanged` subscriber would re-run its handoff.
    teardown(win)

    try {
      win.close()
    } catch {
      // Already gone between the check and the call.
    }

    emit(false)

    return { ok: true }
  }

  return {
    beginMove: () => {
      // No-op: a PiP window cannot be placed by script. See the module header.
    },
    close,
    endMove: () => {
      // See beginMove.
    },
    moveBy: () => {
      // See beginMove.
    },
    // False: dragging the bar is Electron's native/desktop-layout path. In the
    // browser the OS moves the PiP window from its own frame.
    nativeDrag: false,
    onChanged: callback => {
      changedListeners.add(callback)

      return () => void changedListeners.delete(callback)
    },
    onCursor: () => () => {
      // Linux's cursor feed has no browser equivalent; click-through is
      // Electron-only. Present because the contract requires it.
    },
    onGameOverlay: () => () => {
      // No OS window list from a page.
    },
    onGoto: callback => {
      // A portalled HUD shares the app window's router, so "switch the HUD to
      // another session" cannot be honoured without moving the whole app
      // window. Registered so the contract holds, never fired.
      gotoListeners.add(callback)

      return () => void gotoListeners.delete(callback)
    },
    open,
    resetLayout: async () => {
      clearStoredHudSize()

      if (pip && !pip.closed) {
        resize(pip, defaultHudSize(pip.screen))
      }

      return { ok: true }
    },
    setBounds: bounds => {
      if (!pip || pip.closed) {
        return
      }

      const clamped = clampHudSize(bounds, pip.screen)

      // Width/height only: Chrome will not move a PiP window, so x/y are
      // intentionally dropped (the HUD's resize handles are disabled in portal
      // mode for the same reason — Chrome resizes the window natively).
      resize(pip, clamped)
    },
    setFrost: () => Promise.resolve({ ok: true }),
    setIgnoreMouse: () => {
      // No-op by design: Chrome's PiP window cannot be made click-through.
    },
    setSession: value => {
      sessionId = typeof value === 'string' && value ? value : null
    },
    setWorkspaceTransfer: () => {
      // X11 virtual-desktop handoff; nothing to transfer from a page.
    },
    windowing: {
      // Client placement is impossible (no moveTo), control-drag has nothing to
      // drive, and native drag is the Electron path.
      clientPlacement: false,
      controlDrag: false,
      nativeDrag: false,
      // The PiP window is opaque and always eats clicks, so the HUD wears the
      // solid treatment rather than the click-through one it cannot honour.
      solid: true,
      workspaceTransfer: false
    }
  }
}
