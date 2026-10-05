import { useEffect, useState } from 'react'

import type { Viewport } from '../scene/projection'

/** The pane's CSS-pixel viewport, re-read on resize (pane-local px, not DIP). */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() => ({
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    width: typeof window === 'undefined' ? 0 : window.innerWidth
  }))

  useEffect(() => {
    const onResize = () => setViewport({ height: window.innerHeight, width: window.innerWidth })

    window.addEventListener('resize', onResize)

    return () => window.removeEventListener('resize', onResize)
  }, [])

  return viewport
}
