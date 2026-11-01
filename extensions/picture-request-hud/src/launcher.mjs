/**
 * One launch path for the HUD, shared by every control that opens it.
 *
 * Why this is a module and not four lines in dock.mjs: the same click has to
 * behave the same whether it comes from the top-level Launch button, the
 * quieter "Pop out HUD" control, or a second panel that knows nothing about
 * the first. The rules it enforces are the whole feature:
 *
 *  1. A click always ends in something the user can see — a window, a window
 *     coming forward, or a named error. Never a silent no-op.
 *  2. Never a duplicate. A window this document owns is focused directly; a
 *     window another panel owns is asked to come forward over the bus.
 *  3. The click's activation is spent on `requestWindow` and nothing else, so
 *     the pre-flight probe is bounded well inside Chrome's 5s activation
 *     window (measured: 120ms here, 5000ms available).
 *
 * `openWindow` and `pipAvailable` are injectable so the decision logic can be
 * proven in node without a browser (tests/launcher.test.mjs).
 */

import { bus, MSG } from './bus.mjs'
import {
  DEFAULT_HUD_SIZE, ERROR_COPY, copyFor, describeLaunchError, hudIsLive, hudLaunchPlan,
} from './hud-core.mjs'
import { hasDocumentPip, openHudWindow } from './pip.mjs'

/** How long a launch waits for an answer to "is a HUD already up?". Bounded
 *  because it is spent from the click's transient activation. */
export const PROBE_WAIT_MS = 120

export function createHudLauncher({
  surface,
  onState = () => {},
  onOpen = () => {},
  onClose = () => {},
  openWindow = openHudWindow,
  pipAvailable = hasDocumentPip,
  size = DEFAULT_HUD_SIZE,
} = {}) {
  /** The window THIS document owns. A Document-PiP window is a child of the
   *  document that requested it — no other panel can reach it, which is why
   *  the bus exists for everything else. */
  let hud = null
  /** When any HUD in the extension last said it was alive. */
  let remoteSeenAt = 0

  const localOpen = () => !!hud && !hud.window.closed
  const remoteOpen = () => !localOpen() && hudIsLive(remoteSeenAt)
  const isOpen = () => localOpen() || remoteOpen()

  const emit = () => {
    onState({
      open: isOpen(),
      plan: hudLaunchPlan({ localOpen: localOpen(), remoteOpen: remoteOpen() }),
    })
  }

  const noteRemote = seenAt => {
    remoteSeenAt = seenAt ?? Date.now()
    emit()
  }

  /* ------------------------------------------------------------ the bus */

  bus.subscribe(event => {
    if (!event || event.role !== 'hud') {return}
    if (event.type === MSG.hudClosed) {
      remoteSeenAt = 0
      emit()
      return
    }
    // opened / heartbeat / state all mean the same thing: a HUD is on screen.
    if (event.type === MSG.hudOpened || event.type === MSG.hudHeartbeat || event.type === MSG.hudState) {
      if (event.open === false) {
        remoteSeenAt = 0
        emit()
      } else {
        noteRemote()
      }
    }
  })

  /**
   * Ask any HUD anywhere in the extension to identify itself.
   *
   * A HUD can outlive the panel that opened it (the panel is not the parent
   * for anything but its own window — another panel's HUD is invisible to us),
   * so the registry is only as good as the last heartbeat. This closes that
   * gap at click time without ever waiting long enough to lose the gesture.
   */
  const probe = ({ wait = PROBE_WAIT_MS } = {}) =>
    new Promise(resolve => {
      if (remoteOpen()) {
        resolve(true)
        return
      }
      let settled = false
      let timer = 0
      const unsubscribe = bus.subscribe(event => {
        if (event?.role !== 'hud') {return}
        if (event.type !== MSG.hudState && event.type !== MSG.hudOpened && event.type !== MSG.hudHeartbeat) {return}
        noteRemote()
        finish(true)
      })
      const finish = alive => {
        if (settled) {return}
        settled = true
        clearTimeout(timer)
        unsubscribe()
        resolve(alive || remoteOpen())
      }
      timer = setTimeout(() => finish(false), wait)
      bus.post(MSG.hudProbe, { role: 'dock' })
    })

  /* ----------------------------------------------------------- actions */

  const focusLocal = () => {
    if (!localOpen()) {return false}
    // Geometry first: a HUD can be dragged half off-screen, and "bring it to
    // the front" that leaves it out of reach is not bringing it anywhere.
    try {
      hud.applyGeometry()
    } catch {
      /* geometry is advisory */
    }
    try {
      hud.window.focus()
    } catch {
      /* focus is best effort */
    }
    return true
  }

  const bringRemoteForward = () => {
    bus.post(MSG.hudFocusRequest, { role: 'dock' })
    surface.setStatus('HUD is open — brought to the front')
    surface.log('The HUD open in another panel was brought to the front', 'info')
  }

  const fail = (code, detail) => {
    const known = ERROR_COPY[code] ? code : 'HUD_FAILED'
    surface.setError(known, detail)
    surface.setStatus('Could not open the HUD')
    surface.log(copyFor(known).title, 'warn')
    emit()
    return { action: 'open', error: known, ok: false }
  }

  /**
   * The click handler. Returns a small receipt (`{action, ok, error?}`) so a
   * test can assert what the click DID, not just that it did not throw.
   */
  const launch = async () => {
    surface.setError(null)

    const plan = hudLaunchPlan({ localOpen: localOpen(), remoteOpen: remoteOpen() })

    if (plan.action === 'focus-local') {
      focusLocal()
      surface.setStatus('HUD is open — brought to the front')
      surface.log('Brought the open HUD to the front', 'info')
      emit()
      return { action: plan.action, ok: true, reuse: true }
    }

    if (plan.action === 'focus-remote') {
      bringRemoteForward()
      emit()
      return { action: plan.action, ok: true, reuse: true }
    }

    // Nothing known to be open. Confirm before creating a second window.
    if (await probe()) {
      bringRemoteForward()
      return { action: 'focus-remote', ok: true, reuse: true }
    }

    if (!pipAvailable()) {
      return fail('HUD_UNSUPPORTED')
    }

    surface.setStatus('Opening the HUD…')
    try {
      const opened = await openWindow({ size, title: 'Hermes HUD' })
      hud = opened
      opened.applyGeometry()
      opened.window.addEventListener('pagehide', () => {
        hud = null
        onClose()
        surface.setStatus('HUD closed')
        emit()
      })
      onOpen(opened)
      surface.setStatus('HUD is open')
      surface.log('HUD launched as a separate always-on-top window', 'info')
      emit()
      return { action: 'open', ok: true, reuse: false }
    } catch (error) {
      return fail(describeLaunchError(error), error?.cause?.message ?? error?.message)
    }
  }

  return {
    hud: () => (localOpen() ? hud : null),
    isOpen,
    launch,
    probe,
    state: () => ({ localOpen: localOpen(), open: isOpen(), remoteOpen: remoteOpen() }),
  }
}
