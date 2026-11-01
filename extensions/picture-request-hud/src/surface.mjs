/**
 * One HUD surface, used by both hosts: the Chrome side panel (the dock) and the
 * Popped-out Document-PiP window (whose document this module is injected into).
 *
 * `doc` is explicit because the PiP surface is a *different document in a
 * different realm*. Passing it in — rather than reaching for the global
 * `document` — is what keeps the two surfaces identical instead of one being a
 * mirror that drifts.
 */

import { bus } from './bus.mjs'
import { captureSupported, clearPreview, renderPreview, startCapture } from './capture.mjs'
import {
  MSG, STORAGE, copyFor, liveBadge, normalizeBackendUrl, normalizeTask,
} from './hud-core.mjs'

export function createSurface({ doc = document, onCapture = () => {}, role }) {
  const view = doc.defaultView ?? window
  const el = id => doc.getElementById(id)

  const ui = {
    ask: el('ask'),
    error: el('error'),
    errorBody: el('error-body'),
    errorTitle: el('error-title'),
    errorDismiss: el('error-dismiss'),
    hudState: el('hud-state'),
    live: el('live'),
    liveLabel: el('live-label'),
    log: el('log'),
    share: el('share'),
    status: el('status'),
    stop: el('stop'),
    task: el('task'),
    video: el('preview'),
  }

  let capture = null
  let liveElsewhere = null

  const setStatus = text => {
    if (ui.status) {ui.status.textContent = text}
  }

  const setError = (code, detail) => {
    if (!ui.error) {return}
    if (code === null) {
      ui.error.classList.add('hidden')
      return
    }
    const copy = copyFor(code)
    ui.error.classList.remove('hidden')
    if (ui.errorTitle) {ui.errorTitle.textContent = copy.title}
    if (ui.errorBody) {ui.errorBody.textContent = detail ? `${copy.body} (${detail})` : copy.body}
  }

  const log = (text, kind = 'info') => {
    if (!ui.log) {return}
    const line = doc.createElement('li')
    line.className = `log-line log-${kind}`
    line.textContent = text
    ui.log.prepend(line)
    while (ui.log.children.length > 40) {ui.log.lastElementChild.remove()}
  }

  const paint = () => {
    const live = !!capture
    doc.body.classList.toggle('is-live', live || !!liveElsewhere)
    ui.live?.classList.toggle('hidden', !live && !liveElsewhere)
    if (ui.liveLabel) {
      ui.liveLabel.textContent = live
        ? liveBadge(capture?.label)
        : (liveElsewhere ? `● LIVE — sharing in the ${liveElsewhere}` : '')
    }
    // The title is part of the indicator: a HUD can be parked over another app
    // with its banner out of view, and the window/task list still shows it.
    const base = role === 'dock' ? 'Picture Request — Hermes' : 'Hermes HUD'
    try {
      doc.title = live || liveElsewhere ? `● LIVE — ${base}` : base
    } catch {
      /* a document without a title is not worth failing over */
    }
    if (ui.share) {ui.share.disabled = live}
    if (ui.stop) {ui.stop.disabled = !live}
    ui.video?.classList.toggle('hidden', !live && !liveElsewhere)
  }

  const teardown = reason => {
    if (capture) {
      capture.stop()
      capture = null
    }
    clearPreview(ui.video)
    onCapture(null)
    paint()
    setStatus('Not sharing')
    if (reason !== 'silent') {log('Screen sharing stopped', 'info')}
    bus.post(MSG.captureChanged, { live: false, reason, role })
  }

  const share = async () => {
    setError(null)
    if (!captureSupported(view)) {
      setError('CAPTURE_UNSUPPORTED')
      return
    }
    setStatus('Waiting for you to pick a screen…')
    try {
      const next = await startCapture({ nav: view.navigator })
      capture = next
      // Chrome's own "Stop sharing" bar, a closed shared window, an unplugged
      // monitor — all arrive here, and all must drop the stream and the badge.
      next.onEnded(() => teardown('ended'))
      renderPreview(ui.video, next.stream, view)
      // The owning surface shows frames locally; a host can also hand the same
      // stream to another same-origin surface (the dock does this for the HUD).
      onCapture(next.stream)
      paint()
      setStatus(next.label ? `Sharing ${next.label}` : 'Sharing a screen')
      log(`Screen sharing started${next.settings.displaySurface ? ` (${next.settings.displaySurface})` : ''}`, 'live')
      bus.post(MSG.captureChanged, { label: next.label, live: true, role })
    } catch (error) {
      setError(error.code || 'CAPTURE_FAILED', error.message)
      setStatus('Not sharing')
    }
  }

  const backendUrl = async () => {
    const stored = await chrome.storage?.local?.get?.(STORAGE.backend).catch(() => null)
    return normalizeBackendUrl(stored?.[STORAGE.backend] || 'http://127.0.0.1:9120/api/hud/assist')
  }

  /**
   * Ask the local Hermes gateway. The only outbound request the extension makes,
   * it is loopback-only by default, and it fires only on Ask — never on capture.
   */
  const submit = async () => {
    setError(null)
    const task = normalizeTask(ui.task?.value)
    if (!task.ok) {
      setStatus('Type a request first')
      ui.task?.focus?.()
      return
    }
    const endpoint = await backendUrl()
    if (!endpoint) {
      setError('BACKEND_OFFLINE', 'bad endpoint')
      return
    }

    if (ui.ask) {ui.ask.disabled = true}
    setStatus('Asking Hermes…')
    log(`→ ${task.text.slice(0, 120)}`, 'ask')
    if (task.truncated) {log('request was truncated to 4000 characters', 'warn')}
    bus.post(MSG.taskSubmitted, { role, task: task.text.slice(0, 200) })

    try {
      const response = await view.fetch(endpoint, {
        body: JSON.stringify({
          context: { live: !!capture, source: capture?.label || null, surface: role },
          task: task.text,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
      })

      if (response.status === 404) {
        setError('BACKEND_OFFLINE', 'no /api/hud/assist route on that gateway')
        log('Gateway answered 404 — the assist route is not wired on this build.', 'warn')
      } else if (!response.ok) {
        setError('BACKEND_OFFLINE', `HTTP ${response.status}`)
      } else {
        const body = await response.json().catch(() => ({}))
        const reply = body.reply || body.text || body.message || '(empty reply)'
        log(reply, 'reply')
        setStatus('Hermes replied')
      }
    } catch (error) {
      setError('BACKEND_OFFLINE', error?.name === 'TimeoutError' ? 'timed out' : undefined)
      setStatus('Hermes is not reachable')
    } finally {
      if (ui.ask) {ui.ask.disabled = false}
      if (ui.task) {ui.task.value = ''}
    }
  }

  /* ---------------------------------------------------------------- wiring */

  ui.share?.addEventListener('click', share)
  ui.stop?.addEventListener('click', () => teardown('user'))
  ui.ask?.addEventListener('click', submit)
  ui.errorDismiss?.addEventListener('click', () => setError(null))
  ui.task?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {void submit()}
  })

  bus.subscribe(event => {
    if (!event || event.role === role) {return}

    if (event.type === MSG.captureChanged) {
      liveElsewhere = event.live ? (event.role === 'hud' ? 'HUD' : 'dock') : null
      if (ui.hudState) {
        ui.hudState.textContent = liveElsewhere ? `Sharing in the ${liveElsewhere}` : ''
        ui.hudState.classList.toggle('hidden', !ui.hudState.textContent)
      }
      if (role === 'dock' && event.live) {log('The floating HUD is sharing your screen', 'live')}
      paint()
    }

    // A stop pressed on one surface ends the stream owned by the other.
    if (event.type === MSG.captureStopRequested && capture) {teardown('remote')}
  })

  // Leaving the surface ends the share: a HUD that closes must not keep
  // capturing, and neither must a panel that navigates.
  view.addEventListener('pagehide', () => teardown('silent'))
  view.addEventListener('beforeunload', () => {
    capture?.stop()
    bus.post(MSG.captureChanged, { live: false, reason: 'unload', role })
  })

  paint()

  return { log, paint, setError, setStatus, share, stop: () => teardown('user'), submit, ui }
}
