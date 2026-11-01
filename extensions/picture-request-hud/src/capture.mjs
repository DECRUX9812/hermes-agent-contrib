/**
 * Screen capture with the consent story built in.
 *
 * There is exactly one way frames start flowing: `startCapture()` after a click
 * on our own "Share screen" button, which calls `getDisplayMedia` — the browser
 * shows its own source picker, and that picker IS the consent dialog. We never
 * capture implicitly, never re-capture after a stop without a new click, and we
 * tear the tracks down the moment anything else ends them.
 */

import { describeCaptureError } from './hud-core.mjs'

export const captureSupported = (view = typeof window === 'undefined' ? undefined : window) =>
  !!view?.navigator?.mediaDevices?.getDisplayMedia

/** Request one screen/window. Throws a named error carrying a `code` from
 *  ERROR_COPY so the UI never has to interpret MediaStreamError. */
export async function startCapture({ frameRate = 30, nav = globalThis.navigator } = {}) {
  if (!captureSupported({ navigator: nav })) {
    throw coded('CAPTURE_UNSUPPORTED', 'getDisplayMedia is not available on this surface.')
  }

  let stream

  try {
    stream = await nav.mediaDevices.getDisplayMedia({
      audio: false,
      // `monitor`/`browser` hints are ignored unless the user picks that source;
      // asking for a capped frame rate keeps a 4K monitor from pinning a core.
      video: { frameRate: { ideal: frameRate, max: frameRate } },
    })
  } catch (error) {
    throw coded(describeCaptureError(error), error?.message || describeCaptureError(error), error)
  }

  const track = stream.getVideoTracks()[0]

  if (!track) {
    stream.getTracks().forEach(t => t.stop())
    throw coded('CAPTURE_NO_SOURCE', 'The stream had no video track.')
  }

  const settings = typeof track.getSettings === 'function' ? track.getSettings() : {}

  return {
    /** What the user is sharing, in their words: usually the window or screen
     *  label Chrome reports. Empty when the platform hides it (Linux often does). */
    label: track.label || '',
    /** Explicit: the indicator is driven by this, never by a timer. */
    onEnded: handler => {
      track.addEventListener('ended', handler, { once: true })
    },
    settings: {
      displaySurface: settings.displaySurface ?? null,
      height: settings.height ?? null,
      width: settings.width ?? null,
    },
    stop() {
      stream.getTracks().forEach(t => {
        try {
          t.stop()
        } catch {
          /* already stopped */
        }
      })
    },
    stream,
    track,
  }
}

/** Attach a stream to a <video>, with autoplay quirks handled. */
export function renderPreview(video, stream, view = typeof window === 'undefined' ? undefined : window) {
  if (!video) {return}
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  const played = video.play?.()
  if (played?.catch) {played.catch(() => {})}
}

export function clearPreview(video) {
  if (!video) {return}
  try {
    video.pause()
  } catch {
    /* nothing playing */
  }
  video.srcObject = null
}

export function coded(code, message, cause) {
  const error = new Error(message || code)
  error.code = code
  if (cause) {error.cause = cause}
  return error
}
