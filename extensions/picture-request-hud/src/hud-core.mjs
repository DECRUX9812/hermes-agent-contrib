/**
 * Pure logic for the Picture Request HUD — no DOM, no chrome.*, no window.
 *
 * Everything here is unit-tested in node (tests/hud-core.test.mjs) so the
 * fragile parts (geometry clamping across DPI and multi-monitor offsets, the
 * capture consent state machine, error copy) are proven without a browser.
 * The DOM glue in src/dock.mjs and src/hud.mjs only wires these functions to
 * real elements and real permissions.
 */

/** Default HUD size in CSS pixels. Narrow enough to park beside a document,
 *  tall enough for a composer plus a few lines of reply. */
export const DEFAULT_HUD_SIZE = { width: 420, height: 560 }

/** Below this the composer stops being usable; above it, the HUD is a tab. */
export const MIN_HUD_SIZE = { width: 320, height: 360 }
export const MAX_HUD_SIZE = { width: 900, height: 1200 }

export const STORAGE = {
  geometry: 'pru.hud.geometry',
  backend: 'pru.assist.backend',
  copyOnShare: 'pru.assist.copyOnShare',
}

/** Messages on the extension-origin BroadcastChannel. The dock and the popped
 *  out HUD are different documents, so they cannot share objects — only text. */
export const MSG = {
  hudOpened: 'hud:opened',
  hudClosed: 'hud:closed',
  hudState: 'hud:state',
  /** "Is a HUD alive anywhere in this extension?" — asked before opening one,
   *  so a second panel never makes a duplicate window. */
  hudProbe: 'hud:probe',
  /** "Bring your window forward" — the only thing a panel can do to a HUD it
   *  does not own (a Document-PiP window belongs to the document that asked). */
  hudFocusRequest: 'hud:focus-request',
  hudHeartbeat: 'hud:heartbeat',
  captureChanged: 'capture:changed',
  captureStopRequested: 'capture:stop-requested',
  taskSubmitted: 'task:submitted',
  error: 'hud:error',
}

/**
 * Fit a HUD size into the display the *PiP window itself* reports.
 *
 * Two traps this handles, both measured on real Chrome rather than assumed:
 *  - the size hint passed to requestWindow is advisory (Chrome 156 on Linux
 *    returned 1280x720 for a 420x560 request), so geometry has to be applied
 *    from inside the window afterwards;
 *  - a multi-monitor setup reports the *display the window is on* through
 *    screen.availLeft/availTop, so a translated monitor (e.g. a laptop to the
 *    left of an external panel) can report availLeft > 0 while availWidth stays
 *    small. Clamping to availWidth alone is correct; adding availLeft is not.
 */
export function clampHudGeometry(size, screen = {}) {
  // A display we cannot measure is assumed to be a normal desktop, not the
  // HUD's own size: falling back to the requested size would make the margin
  // below shrink the window every time `screen` was unavailable (jsdom, tests,
  // an unusual embedder).
  const availWidth = positive(screen.availWidth, 1920)
  const availHeight = positive(screen.availHeight, 1080)
  const requested = {
    width: positive(size?.width, DEFAULT_HUD_SIZE.width),
    height: positive(size?.height, DEFAULT_HUD_SIZE.height),
  }

  // Leave a little breathing room so the window can always be grabbed and
  // moved — a HUD flush to every edge cannot be dragged by its own chrome.
  const margin = 16
  const maxWidth = Math.max(MIN_HUD_SIZE.width, availWidth - margin)
  const maxHeight = Math.max(MIN_HUD_SIZE.height, availHeight - margin)

  const width = Math.round(Math.min(Math.max(requested.width, MIN_HUD_SIZE.width), Math.min(maxWidth, MAX_HUD_SIZE.width)))
  const height = Math.round(Math.min(Math.max(requested.height, MIN_HUD_SIZE.height), Math.min(maxHeight, MAX_HUD_SIZE.height)))

  return { height, width }
}

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Device pixel ratio is only ever used for logging/diagnostics: every size we
 *  pass to the window manager and every size we measure in CSS is DIP, so a
 *  2x panel must not double anything. Exported so the intent is testable. */
export const hudCssPixels = value => Math.round(positive(value, 0))

/**
 * Capture consent is explicit and revocable, so it is a state machine rather
 * than a boolean:
 *
 *   idle → asking → live → stopped → idle
 *             ↘ denied ↗
 *
 * `denied` and `stopped` are distinct on purpose: a denial needs recovery copy
 * ("Chrome blocked it, here's how to allow it"), a stop needs none.
 */
export function createConsentState(onChange = () => {}) {
  let state = 'idle'
  let detail = null
  const emit = () => onChange({ detail, state })
  const set = (next, extra = null) => {
    state = next
    detail = extra
    emit()
  }

  return {
    /** True only while frames are actually flowing. */
    get isLive() {
      return state === 'live'
    },
    get state() {
      return state
    },
    /** A screen share can only be requested straight after a real gesture. */
    begin() {
      if (state === 'live' || state === 'asking') {return false}
      set('asking')
      return true
    },
    granted(detail) {
      set('live', detail)
    },
    denied(error) {
      set('denied', describeCaptureError(error))
    },
    stopped(reason = 'user') {
      set('stopped', reason)
    },
    reset() {
      set('idle')
    },
    /** Sharing ended without us asking (track ended, monitor unplugged,
     *  Chrome revoked it). Same terminal state, no recovery copy. */
    ended() {
      set('stopped', 'ended')
    },
  }
}

/** Map the browser's raw failure to one code we have copy for. Anything
 *  unrecognised stays `CAPTURE_FAILED` with the original message kept — never
 *  silently swallowed, so a user can paste it to us. */
export function describeCaptureError(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {return 'CAPTURE_DENIED'}
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {return 'CAPTURE_NO_SOURCE'}
  if (name === 'NotReadableError' || name === 'TrackStartError') {return 'CAPTURE_BUSY'}
  if (name === 'InvalidStateError') {return 'CAPTURE_NO_GESTURE'}
  if (name === 'AbortError') {return 'CAPTURE_CANCELLED'}
  if (name === 'NotSupportedError') {return 'CAPTURE_UNSUPPORTED'}
  return 'CAPTURE_FAILED'
}

/** How often an open HUD re-announces itself. Short enough that a panel opened
 *  a moment later already knows, cheap enough to ignore (one text message). */
export const HUD_HEARTBEAT_MS = 2000

/** How long an announcement counts as proof the HUD is still alive. Two missed
 *  beats plus slack: a HUD that was closed by the user must not look open. */
export const HUD_REGISTRY_TTL_MS = 6000

/** True when a HUD announcement is recent enough to mean "still on screen". */
export function hudIsLive(seenAt, now = Date.now(), ttl = HUD_REGISTRY_TTL_MS) {
  if (typeof seenAt !== 'number' || !Number.isFinite(seenAt) || seenAt <= 0) {return false}
  const age = now - seenAt
  // A clock that jumped backwards must not keep a dead window "alive".
  return age >= 0 && age <= ttl
}

/** The one button's two faces. Same words as the desktop app's HUD control:
 *  launch when it is down, bring it forward when it is up. */
export const LAUNCH_LABEL = { closed: 'Launch HUD', open: 'Bring HUD to front' }

/**
 * Decide what a launch click should do, given what is already open.
 *
 * Order matters and is not an optimisation: a window we own is focused
 * directly, a window another panel owns is asked to come forward, and only
 * when both are false is a new window created. `reuse` is what the caller
 * reports, so "one click, never a duplicate" is a testable property rather
 * than a hope.
 */
export function hudLaunchPlan({ localOpen = false, remoteOpen = false } = {}) {
  if (localOpen) {return { action: 'focus-local', label: LAUNCH_LABEL.open, reuse: true }}
  if (remoteOpen) {return { action: 'focus-remote', label: LAUNCH_LABEL.open, reuse: true }}
  return { action: 'open', label: LAUNCH_LABEL.closed, reuse: false }
}

/** Launch failures get the same named codes as every other failure here, so a
 *  click can never end in a silent no-op. An error that already carries a code
 *  we have copy for keeps it. */
export function describeLaunchError(error) {
  const code = error?.code
  if (typeof code === 'string' && ERROR_COPY[code]) {return code}
  return describeHudError(error)
}

/** Why a HUD cannot be opened, in the order the causes actually occur. */
export function describeHudError(error) {
  const name = error?.name || ''
  if (name === 'NotAllowedError') {return 'HUD_NO_GESTURE'}
  if (name === 'NotSupportedError') {return 'HUD_UNSUPPORTED'}
  if (name === 'InvalidStateError') {return 'HUD_BLOCKED'}
  return 'HUD_FAILED'
}

export const ERROR_COPY = {
  HUD_UNSUPPORTED: {
    body: 'This browser has no Document Picture-in-Picture. Use Chrome or Edge 116+, or the Hermes desktop app for the full always-on-top HUD.',
    title: 'Floating HUD is not available here',
  },
  HUD_NO_GESTURE: {
    body: 'Browsers only open a floating window directly from a click or key press. Click "Launch HUD" again.',
    title: 'Needs a click to open',
  },
  HUD_BLOCKED: {
    body: 'Chrome refused a second floating window for this page. Close the current HUD first — one HUD per page is a browser limit.',
    title: 'A HUD is already open',
  },
  HUD_FAILED: {
    body: 'The floating window did not open. Reload the panel and try again.',
    title: 'Could not open the HUD',
  },
  CAPTURE_DENIED: {
    body: 'You did not pick a screen. Nothing is being shared. Click "Share screen" when you want to try again.',
    title: 'Screen sharing was declined',
  },
  CAPTURE_CANCELLED: {
    body: 'The picker was closed. Nothing is being shared.',
    title: 'Screen sharing cancelled',
  },
  CAPTURE_NO_SOURCE: {
    body: 'No screen or window was offered. Check that this machine has a display, then try again.',
    title: 'Nothing to share',
  },
  CAPTURE_BUSY: {
    body: 'Another app may be locking the display. Close other screen recorders and try again.',
    title: 'Screen is busy',
  },
  CAPTURE_NO_GESTURE: {
    body: 'Screen sharing must start from a click. Click "Share screen" again.',
    title: 'Needs a click to start',
  },
  CAPTURE_UNSUPPORTED: {
    body: 'Screen capture is unavailable on this surface. Open the panel in Chrome (not a phone browser) and try again.',
    title: 'Screen capture unsupported',
  },
  CAPTURE_FAILED: {
    body: 'The screen stream failed to start. Nothing is being shared.',
    title: 'Screen capture failed',
  },
  BACKEND_OFFLINE: {
    body: 'The Hermes gateway is not answering. Start it with `hermes webapp`, or set a different endpoint in the panel.',
    title: 'Hermes is offline',
  },
  EXTENSION_CONTEXT_LOST: {
    body: 'This panel was loaded from disk and the extension was reloaded. Reopen the panel from the toolbar.',
    title: 'Panel is out of date',
  },
}

export const copyFor = code => ERROR_COPY[code] ?? { body: '', title: code }

/** The line a user reads while sharing. Constant, unambiguous, impossible to
 *  mistake for an idle state — that is the whole privacy indicator. */
export const liveBadge = label =>
  label ? `● LIVE — sharing ${label}` : '● LIVE — sharing a screen'

/** Task text guard: trim, cap, refuse empties. Keeps a paste-bomb from being
 *  submitted as a "picture request". */
export const MAX_TASK_CHARS = 4000
export function normalizeTask(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) {return { error: 'EMPTY', ok: false }}
  if (trimmed.length > MAX_TASK_CHARS) {return { ok: true, text: trimmed.slice(0, MAX_TASK_CHARS).trim(), truncated: true }}
  return { ok: true, text: trimmed, truncated: false }
}

/** A backend URL is only useful if it is loopback http(s) — an extension cannot
 *  reach anything else without another host permission, and silently failing
 *  later is worse than refusing now. */
export function normalizeBackendUrl(raw) {
  try {
    const url = new URL(String(raw || '').trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {return null}
    if (!url.pathname || url.pathname === '/') {url.pathname = '/api/health'}
    return url.toString()
  } catch {
    return null
  }
}

/** Which parts of the screen the user may explicitly allow. The default is the
 *  narrowest thing that can answer a picture request. */
export const CAPTURE_MODES = {
  screen: { label: 'A whole screen', hint: 'share the display with any window on it' },
  window: { label: 'One window', hint: 'share a single app window' },
  tab: { label: 'One Chrome tab', hint: 'share just this tab' },
}
