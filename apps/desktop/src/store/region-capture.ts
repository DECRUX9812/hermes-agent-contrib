import { atom } from 'nanostores'

import { translateNow } from '@/i18n'
import { notify } from '@/store/notifications'

/**
 * Region capture state (roadmap #34). The composer's attach menu kicks a
 * capture; the overlay (mounted once per window) reads this store, does the
 * region pick + markup, and lands the PNG on the composer. Window-local and
 * in-memory — a capture belongs to the window that asked for it and is never
 * persisted.
 */

export type RegionCaptureState =
  | { status: 'idle' }
  | { status: 'capturing' }
  | { frame: { dataUrl: string; height: number; width: number }; status: 'ready' }

export const $regionCapture = atom<RegionCaptureState>({ status: 'idle' })

export function closeRegionCapture(): void {
  $regionCapture.set({ status: 'idle' })
}

export async function startRegionCapture(): Promise<void> {
  const api = window.hermesDesktop?.regionCapture

  if (!api) {
    notify({ kind: 'error', message: translateNow('regionCapture.unavailable') })

    return
  }

  $regionCapture.set({ status: 'capturing' })

  try {
    const result = await api.capture()

    if (!result.ok) {
      notify({
        kind: 'error',
        message: translateNow(result.reason === 'screen-permission' ? 'regionCapture.permissionDenied' : 'regionCapture.captureFailed')
      })
      $regionCapture.set({ status: 'idle' })

      return
    }

    $regionCapture.set({ frame: result.frame, status: 'ready' })
  } catch {
    notify({ kind: 'error', message: translateNow('regionCapture.captureFailed') })
    $regionCapture.set({ status: 'idle' })
  }
}
