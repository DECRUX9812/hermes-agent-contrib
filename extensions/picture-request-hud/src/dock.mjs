/** Side panel entry — the dock.
 *
 *  Two jobs, and no third: paint the top-level launch control, and own the
 *  capture mirror into the HUD's own preview. Everything about opening,
 *  focusing and failing a HUD lives in src/launcher.mjs, because both launch
 *  controls (the prominent one at the top and the quiet "Pop out HUD") must
 *  behave identically — one code path, one set of error states.
 */

import { LAUNCH_LABEL } from './hud-core.mjs'
import { createHudLauncher } from './launcher.mjs'
import { hasDocumentPip } from './pip.mjs'
import { createSurface } from './surface.mjs'

/** The window this document owns, kept here so the capture mirror below can
 *  reach the HUD's <video> without asking the launcher twice. */
let hud = null

const surface = createSurface({
  doc: document,
  role: 'dock',
  /** Mirror the dock's stream into the HUD's own preview element. A MediaStream
   *  cannot be cloned across documents, but both surfaces share this origin, so
   *  the HUD's <video> can take the object directly — measured working. */
  onCapture: stream => {
    const video = hud?.document?.getElementById('preview')
    if (!video) {return}
    video.srcObject = stream
    if (stream) {
      video.classList.remove('hidden')
      video.play?.().catch(() => {})
    } else {
      video.classList.add('hidden')
    }
  },
})

const launchButton = document.getElementById('launch-hud')
const launchLabel = document.getElementById('launch-label')
const launchNote = document.getElementById('launch-note')
const popout = document.getElementById('popout')
const hint = document.getElementById('popout-hint')

const NOTE_CLOSED = 'Always-on-top window beside any app. One click — no setup, no second tab.'
const NOTE_OPEN = 'The floating window is up. This brings it back to the front.'

/** One button, two honest faces: launch when it is down, bring it forward when
 *  it is up. The state comes from the launcher, never from a local guess, so a
 *  HUD opened by another panel is reflected here too. */
function paintLaunch(open) {
  if (launchButton) {
    launchButton.dataset.open = open ? 'true' : 'false'
    launchButton.setAttribute('aria-pressed', open ? 'true' : 'false')
  }
  if (launchLabel) {launchLabel.textContent = open ? LAUNCH_LABEL.open : LAUNCH_LABEL.closed}
  if (launchNote) {launchNote.textContent = open ? NOTE_OPEN : NOTE_CLOSED}
}

const launcher = createHudLauncher({
  onClose: () => {
    hud = null
  },
  onOpen: opened => {
    hud = opened
  },
  onState: ({ open }) => paintLaunch(open),
  surface,
})

if (!hasDocumentPip()) {
  popout.disabled = true
  hint.textContent = 'This browser cannot open a floating window. Use Chrome or Edge 116+, or the Hermes desktop app for the full always-on-top HUD.'
  // The prominent control stays live on purpose: a click then shows the named
  // reason instead of doing nothing.
  if (launchLabel) {launchLabel.textContent = 'HUD not available in this browser'}
  surface.setError('HUD_UNSUPPORTED')
}

const onLaunch = event => {
  event?.preventDefault?.()
  void launcher.launch()
}

launchButton?.addEventListener('click', onLaunch)
// The older control is kept, and routed through the same launcher: same reuse,
// same errors, no second implementation to drift.
popout?.addEventListener('click', onLaunch)

document.getElementById('open-app')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://127.0.0.1:9120/' })
})

// A panel opened while a HUD is already up must show "Bring HUD to front" on
// the first paint, not after the first click. Bounded: a HUD answers at once.
paintLaunch(false)
void launcher.probe({ wait: 300 }).then(() => paintLaunch(launcher.isOpen()))
