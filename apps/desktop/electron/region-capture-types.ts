/** Shared contract for the `hermes:region-capture` IPC channel. Pure types —
 * imported by both the main-process handler and the renderer's global.d.ts. */

export interface RegionCaptureFrame {
  /** PNG data URL of the display under the requesting window. */
  dataUrl: string
  /** Pixel dimensions of the captured frame (thumbnail size, not CSS). */
  height: number
  width: number
}

export type RegionCaptureResult =
  | { frame: RegionCaptureFrame; ok: true }
  | { ok: false; reason: 'screen-permission' | 'unavailable' }

export interface RegionCaptureApi {
  capture(): Promise<RegionCaptureResult>
}
