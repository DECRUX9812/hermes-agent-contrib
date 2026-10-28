import { TITLEBAR_HEIGHT, TOUCH_TITLEBAR_HEIGHT } from '@/app/shell/titlebar'
import { useMediaQuery } from '@/hooks/use-media-query'
import { hostHas } from '@/lib/host-capabilities'
import { TOUCH_POINTER_QUERY } from '@/lib/touch-interaction'

/** A 44px band is a phone/tablet affordance. A wide window on a coarse-pointer
 *  machine (touchscreen laptop, streamed desktop) is still a desk, and 44px
 *  squares there read as chunky rather than generous. */
const NARROW_TOUCH_BAND = '(max-width: 900px)'

/** Browser touch chrome needs a 44px band — but only where the window is narrow
 *  enough to be held. */
export function useTouchTitlebar(): boolean {
  const touch = useMediaQuery(TOUCH_POINTER_QUERY)
  const narrow = useMediaQuery(NARROW_TOUCH_BAND)

  return hostHas('touchSizedControls') && touch && narrow
}

export function useTitlebarHeight(): number {
  return useTouchTitlebar() ? TOUCH_TITLEBAR_HEIGHT : TITLEBAR_HEIGHT
}
