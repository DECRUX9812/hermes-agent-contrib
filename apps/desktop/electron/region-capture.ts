import { BrowserWindow, desktopCapturer, ipcMain, screen, systemPreferences } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'

import type { RegionCaptureResult } from './region-capture-types'

/**
 * Region capture (roadmap #34): the renderer asks for a full-resolution frame
 * of the display under the requesting window, then does region pick + markup
 * itself in an in-app overlay. One IPC, one answer — unlike the macOS-native
 * `command-screenshot` gesture there is no persistent monitor; the overlay is
 * the only consumer and it captures on demand.
 *
 * The frame is captured from the WINDOW's display so multi-monitor setups grab
 * the screen the user is working on. Pixel size = display size × scaleFactor
 * (Retina needs the scale or the markup canvas lands on half-res pixels).
 */

/** Largest thumbnail edge — beyond this desktopCapturer compresses hard and
 *  markup text blurs; 8192 covers a 5K Retina frame. */
const MAX_FRAME_EDGE = 8192

export interface CaptureSource {
  display_id?: string
  thumbnail: { getSize(): { height: number; width: number }; isEmpty(): boolean; toPNG(): Buffer }
}

interface DisplayLike {
  id: number
  scaleFactor: number
  size: { height: number; width: number }
}

/** Thumbnail request for a display: full native pixels, capped. */
export function frameSizeForDisplay(display: DisplayLike): { height: number; width: number } {
  const scale = Math.max(1, display.scaleFactor || 1)
  const width = Math.min(Math.round(display.size.width * scale), MAX_FRAME_EDGE)
  const height = Math.min(Math.round(display.size.height * scale), MAX_FRAME_EDGE)

  return { height, width }
}

/** Match a desktopCapturer source to a display, with fallbacks for sources that
 *  don't report `display_id` (older runtimes, virtual drivers). */
export function pickSourceForDisplay(
  sources: readonly CaptureSource[],
  display: DisplayLike | null | undefined,
  displays: readonly DisplayLike[]
): CaptureSource | undefined {
  if (sources.length === 0) {
    return undefined
  }

  if (display) {
    const exact = sources.find(source => source.display_id === String(display.id))

    if (exact) {
      return exact
    }
  }

  // Single-source answers (one display, or a driver that collapses them) are
  // always the right pick.
  if (sources.length === 1 || displays.length <= 1) {
    return sources[0]
  }

  return undefined
}

export function installRegionCapture({ rendererUrl }: { rendererUrl: string }): () => void {
  const channel = 'hermes:region-capture:capture'
  const expectedUrl = new URL(rendererUrl)

  ipcMain.handle(channel, async (event: IpcMainInvokeEvent): Promise<RegionCaptureResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)

    // Same trust rule as command-screenshot: only the app's own top frame may
    // ask for screen pixels, so a guest webview can't scrape the display.
    if (!win || win.isDestroyed() || event.senderFrame !== event.sender.mainFrame) {
      return { ok: false, reason: 'unavailable' }
    }

    try {
      const url = new URL(event.senderFrame.url)

      if (
        url.protocol !== expectedUrl.protocol ||
        url.host !== expectedUrl.host ||
        url.pathname !== expectedUrl.pathname
      ) {
        return { ok: false, reason: 'unavailable' }
      }
    } catch {
      return { ok: false, reason: 'unavailable' }
    }

    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      return { ok: false, reason: 'screen-permission' }
    }

    const display = screen.getDisplayMatching(win.getBounds())
    const thumbnailSize = frameSizeForDisplay(display)

    const sources = await desktopCapturer
      .getSources({ thumbnailSize, types: ['screen'] })
      .catch(() => [] as CaptureSource[])

    const source = pickSourceForDisplay(sources, display, screen.getAllDisplays())

    if (!source || source.thumbnail.isEmpty()) {
      return { ok: false, reason: 'unavailable' }
    }

    const png = source.thumbnail.toPNG()
    const size = source.thumbnail.getSize()

    return {
      // Report the REAL thumbnail size — desktopCapturer keeps aspect and may
      // downscale, so the requested size isn't necessarily what came back.
      frame: { dataUrl: `data:image/png;base64,${png.toString('base64')}`, height: size.height, width: size.width },
      ok: true
    }
  })

  return () => ipcMain.removeHandler(channel)
}
