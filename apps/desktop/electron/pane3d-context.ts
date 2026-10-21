/**
 * PageContextService — what the user is looking at (architecture §9).
 *
 * `capture()` order:
 *  1. **hermes-browser** — the same in-app-browser guest the avatars perch on
 *     (`collectHostCandidates` + `pickHermesGuest` from pane3d-anchor.ts), read
 *     directly from its webContents: url, title and the page's current
 *     selection.
 *  2. **os-window** — the frontmost non-Hermes OS window: title + app, no url.
 *  3. **none** — nothing to read.
 *
 * Two invariants make the composer safe to open:
 *  - The whole capture resolves within `CONTEXT_TIMEOUT_MS`; a hung guest or a
 *    hung OS enumerator yields `none` instead of blocking the pane.
 *  - A failing `executeJavaScript` omits the selection but never throws, so the
 *    url/title chips still work on a page that refuses the read.
 *
 * The service is Electron-free: the injected handles are declared here and
 * built for Electron in pane3d-context-electron.ts (which shares its browser
 * source with the AnchorService).
 */

import type { PageContext } from '../src/app/pane3d/protocol'

import { collectHostCandidates } from './pane3d-anchor'
import { pickHermesGuest, PROBE_TIMEOUT_MS, withTimeout } from './pane3d-anchor-pick'
import type { AnchorGuestHandle, AnchorHostWindow, AnchorOsWindow } from './pane3d-anchor-types'

/** The pane must never wait longer than this for a page read (§9). */
export const CONTEXT_TIMEOUT_MS = 800
/** The page's selection is trimmed and capped at this length (§9). */
export const SELECTION_MAX_CHARS = 4000
export const SELECTION_SCRIPT = 'String(window.getSelection())'

/** An in-app-browser guest handle: the anchor's handle plus the page reads. */
export interface ContextGuestHandle extends AnchorGuestHandle {
  getURL: () => string
  executeJavaScript: (code: string) => Promise<unknown>
}

export interface PageContextDeps {
  listHosts: () => AnchorHostWindow[]
  listGuests: () => ContextGuestHandle[]
  /** Already filtered to a foreign window by pane3d-anchor-electron.ts. */
  enumerateOsWindow: () => Promise<AnchorOsWindow | null>
  now?: () => number
  timeoutMs?: number
  probeTimeoutMs?: number
}

export interface PageContextService {
  capture: () => Promise<PageContext>
}

/** `String(window.getSelection())` → trimmed, capped, or null when blank. */
export function normalizeSelection(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()

  return trimmed ? trimmed.slice(0, SELECTION_MAX_CHARS) : null
}

function safeString(read: () => string): string {
  try {
    return String(read() ?? '')
  } catch {
    return ''
  }
}

export function createPageContextService(deps: PageContextDeps): PageContextService {
  const now = deps.now ?? (() => Date.now())
  const timeoutMs = Math.max(1, deps.timeoutMs ?? CONTEXT_TIMEOUT_MS)
  const probeTimeoutMs = Math.max(1, deps.probeTimeoutMs ?? PROBE_TIMEOUT_MS)

  const captureBrowser = async (): Promise<PageContext | null> => {
    let hosts: AnchorHostWindow[] = []
    let guests: ContextGuestHandle[] = []

    try {
      hosts = deps.listHosts()
      guests = deps.listGuests()
    } catch {
      return null
    }

    const { candidates, guestHandles } = await collectHostCandidates(hosts, guests, { probeTimeoutMs })
    const picked = pickHermesGuest(candidates)

    if (!picked) {
      return null
    }

    const guest = guestHandles.get(picked.guest.webContentsId)

    // collectHostCandidates already dropped destroyed handles; re-check because
    // the guest can be torn down during the probe.
    if (!guest || guest.isDestroyed()) {
      return null
    }

    const url = safeString(() => guest.getURL())
    const title = safeString(() => guest.getTitle())
    const selection = await readSelection(guest)
    const context: PageContext = { capturedAt: now(), source: 'hermes-browser' }

    if (url) {
      context.url = url
    }

    if (title) {
      context.title = title
    }

    if (selection !== null) {
      context.selection = selection
    }

    return context
  }

  const captureOsWindow = async (): Promise<PageContext | null> => {
    let os: AnchorOsWindow | null = null

    try {
      os = await deps.enumerateOsWindow()
    } catch {
      os = null
    }

    if (!os) {
      return null
    }

    const context: PageContext = { capturedAt: now(), source: 'os-window' }

    if (os.title) {
      context.title = os.title
    }

    if (os.app) {
      context.app = os.app
    }

    return context
  }

  const capture = async (): Promise<PageContext> => {
    const attempt = async (): Promise<PageContext | null> => (await captureBrowser()) ?? captureOsWindow()
    // `withTimeout` resolves with null on a rejection too, so a thrown read can
    // never reject the IPC handler and leave the composer stuck.
    const live = await withTimeout(attempt(), timeoutMs, null)

    return live ?? { capturedAt: now(), source: 'none' }
  }

  return { capture }
}

/**
 * The page selection, or null when the read fails. `executeJavaScript` rejects
 * on a destroyed or navigated-away guest, and a page with a locked-down
 * selection can throw too — neither may break the capture (§9).
 */
async function readSelection(guest: ContextGuestHandle): Promise<string | null> {
  try {
    return normalizeSelection(await guest.executeJavaScript(SELECTION_SCRIPT))
  } catch {
    return null
  }
}
