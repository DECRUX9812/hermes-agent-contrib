/**
 * Document Picture-in-Picture, wrapped so every failure has a name.
 *
 * DECISIVE CONSTRAINT (measured on Chrome 156 here, and it is spec behaviour):
 * a Document-PiP window is closed as soon as its document navigates. Measured:
 * http:// URL → window closed, blob: URL → closed, data: URL → navigation
 * silently ignored. So you can NOT point a PiP window at another page and let
 * that page boot. The window keeps the about:blank document it was born with
 * (same origin as the opener) and the opener builds the surface inside it.
 *
 * What that document DOES have, verified in this repo's probes:
 *  - a separate JS realm: an injected module script executes in it;
 *  - the opener's stylesheets: an absolute chrome-extension:// link applies;
 *  - everything the opener can read: `pip.document` is fully accessible.
 *
 * Chrome's PiP window is a real OS window — chromeless, independently movable
 * and resizable, kept above other windows by the browser. It is NOT click-through
 * and NOT transparent: those stay Electron-only (the desktop app's HUD).
 */

import { STORAGE, clampHudGeometry, describeHudError } from './hud-core.mjs'
import { hudMarkup } from './hud-markup.mjs'

export const hasDocumentPip = () =>
  typeof window !== 'undefined' && 'documentPictureInPicture' in window && typeof window.documentPictureInPicture.requestWindow === 'function'

/**
 * Open the HUD window and build its surface inside.
 *
 * Must be called from a user gesture (transient activation) — so this function
 * touches nothing asynchronous before `requestWindow`.
 */
export async function openHudWindow({ size, title = 'Hermes HUD' }) {
  if (!hasDocumentPip()) {
    throw hudError('HUD_UNSUPPORTED', 'Document Picture-in-Picture is not available in this browser.')
  }

  const requested = clampHudGeometry(size, window.screen)
  let win

  try {
    win = await window.documentPictureInPicture.requestWindow({
      height: requested.height,
      // Leave the opener tab with the real app: a return-to-opener button on a
      // HUD whose whole job is to sit beside your work is a way to lose it.
      disallowReturnToOpener: true,
      preferInitialWindowPlacement: true,
      width: requested.width,
    })
  } catch (error) {
    throw hudError(describeHudError(error), error?.message, error)
  }

  try {
    mountHudDocument(win.document, { title })
  } catch (error) {
    closeQuietly(win)
    throw hudError('HUD_FAILED', error?.message, error)
  }

  return {
    applyGeometry(next) {
      return applyGeometry(win, next ?? requested)
    },
    close: () => closeQuietly(win),
    document: win.document,
    window: win,
  }
}

/** Put the surface, the stylesheet and the module into the PiP document. */
export function mountHudDocument(doc, { title } = {}) {
  doc.title = title ?? 'Hermes HUD'
  doc.documentElement.dataset.hud = 'pip'
  doc.body.className = 'surface hud'
  doc.body.innerHTML = hudMarkup()

  // The stylesheet must be absolute: the PiP document's URL is about:blank, so a
  // relative href would resolve against nothing.
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = chrome.runtime.getURL('hud.css')
  doc.head.appendChild(link)

  // The module runs in the PiP realm, so the HUD owns its own events, its own
  // activation and its own capture — the dock is not a dependency.
  const script = doc.createElement('script')
  script.type = 'module'
  script.src = chrome.runtime.getURL('src/hud-injected.mjs')
  doc.head.appendChild(script)

  return doc
}

/**
 * Apply geometry from inside the PiP document. The size hint passed to
 * requestWindow is advisory (measured: a 420x560 request came back 1280x720),
 * so the real size is set here, clamped to the display this window landed on.
 */
export function applyGeometry(win, size) {
  try {
    const doc = win.document
    if (!doc?.defaultView) {return { applied: false }}
    const fitted = clampHudGeometry(size, doc.defaultView.screen)
    doc.defaultView.resizeTo(fitted.width, fitted.height)
    return { ...fitted, applied: true }
  } catch {
    return { ...clampHudGeometry(size, window.screen), applied: false }
  }
}

/** Persisted geometry so a HUD comes back the size you left it. */
export function rememberGeometry(storage, size) {
  try {
    storage?.set?.({ [STORAGE.geometry]: clampHudGeometry(size, window.screen) })
  } catch {
    /* storage is a nicety, never a hard dependency */
  }
}

function closeQuietly(win) {
  try {
    win.close()
  } catch {
    /* already gone */
  }
}

/** Every failure carries a `code` from ERROR_COPY so callers never have to read
 *  DOMException names. `cause` keeps the original for the log. */
function hudError(code, message, cause) {
  const error = new Error(message || code)
  error.code = code
  if (cause) {error.cause = cause}
  return error
}
