import { useEffect } from 'react'

import { translateNow } from '@/i18n'
import { notify } from '@/store/notifications'

// GPU acceleration is disabled under remote display (RDP/VNC/etc) to avoid
// flicker. Surfaces once per launch as a persistent toast through the shared
// notification stack — was a hand-rolled second top-center card at these same
// exact fixed coordinates, which could overlap a real toast.
export function RemoteDisplayBanner() {
  useEffect(() => {
    void window.hermesDesktop?.getRemoteDisplayReason?.().then(reason => {
      if (reason) {
        notify({
          // Ten seconds, not forever: the fact that this host is software
          // rendering does not change while the app is open, so a permanent
          // floating card over the composer is a standing artifact rather than
          // a notice. Long enough to read, gone before it becomes furniture.
          durationMs: 10_000,
          kind: 'info',
          message: translateNow('remoteDisplayBanner.message', reason),
          // Bottom-right, not the default centre column: the default placement
          // lands on top of the composer's own controls, which reads as a
          // z-index bug rather than a notice.
          placement: 'bottom-right'
        })
      }
    })
  }, [])

  return null
}
