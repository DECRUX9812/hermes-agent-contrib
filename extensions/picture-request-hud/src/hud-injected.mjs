/**
 * Booted INSIDE the Document-PiP window by pip.mjs (injected as a module).
 *
 * This is the floating HUD: it owns its own DOM, its own user activation and its
 * own screen capture, so it keeps working when the dock is closed — and the dock
 * keeps working when the HUD is closed. The only thing they share is text on a
 * BroadcastChannel (src/bus.mjs).
 */

import { bus, MSG } from './bus.mjs'
import { HUD_HEARTBEAT_MS, STORAGE, clampHudGeometry } from './hud-core.mjs'
import { createSurface } from './surface.mjs'

const surface = createSurface({ doc: document, role: 'hud' })

/** The size hint given to requestWindow is advisory (a 420x560 request came back
 *  1280x720 on this Chrome), so the real geometry is applied from in here,
 *  against the display this window actually landed on. */
const fit = async () => {
  let stored = null
  try {
    const got = await chrome.storage?.local?.get?.(STORAGE.geometry)
    stored = got?.[STORAGE.geometry] ?? null
  } catch {
    /* no storage: keep the default */
  }

  const target = clampHudGeometry(stored, screen)
  try {
    resizeTo(target.width, target.height)
    surface.log(`HUD sized to ${target.width}×${target.height}`, 'info')
  } catch {
    surface.log('Chrome kept its own size for this window; drag an edge to resize.', 'warn')
  }
  chrome.storage?.local?.set?.({ [STORAGE.geometry]: target }).catch(() => {})
}

/** Debounced: resize fires per frame while the user drags an OS edge, and a
 *  storage write per frame is the only thing here that could stutter. */
let timer = 0
addEventListener('resize', () => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    chrome.storage?.local?.set?.({
      [STORAGE.geometry]: clampHudGeometry({ height: outerHeight, width: outerWidth }, screen),
    }).catch(() => {})
  }, 400)
})

addEventListener('focus', () => document.body.classList.add('focused'))
addEventListener('blur', () => document.body.classList.remove('focused'))

/* --------------------------------------------------------- launch handshake
 *
 * A panel cannot see another panel's window, so the HUD itself is the authority
 * on "is one up?". It says so on load, keeps saying so on a beat, and answers
 * anyone who asks — which is what stops a second Launch click (in this panel or
 * any other) from making a duplicate window.
 */
const announce = () => bus.post(MSG.hudState, { open: true, role: 'hud' })
const beat = setInterval(announce, HUD_HEARTBEAT_MS)

bus.subscribe(event => {
  if (!event || event.role !== 'dock') {return}
  if (event.type === MSG.hudProbe) {
    announce()
    return
  }
  if (event.type === MSG.hudFocusRequest) {
    // The panel that owns this window already focused it if it could; this is
    // the path for a panel that does not own it.
    try {
      focus()
      document.body.classList.add('focused')
    } catch {
      /* focus is best effort — a window manager may refuse */
    }
  }
})

addEventListener('pagehide', () => {
  clearInterval(beat)
  bus.post(MSG.hudClosed, { role: 'hud' })
})

announce()
void fit()
