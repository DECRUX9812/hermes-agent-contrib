import { TITLEBAR_HEIGHT, TOUCH_TITLEBAR_HEIGHT } from '@/app/shell/titlebar'
import { useTouchTitlebar } from '@/app/shell/use-touch-titlebar'

import { isSessionStripPane } from '../store'

/** The desktop tab strip's row (`h-7`). */
const TAB_STRIP_HEIGHT = 28

interface ZoneHeaderLayoutInput {
  /** The titlebar measured too little room beside its controls for the tabs. */
  measuredBelowControls: boolean
  narrow: boolean
  shown: readonly string[]
  /** A top-edge zone's tabs ride the window band with the controls. */
  topEdge: boolean
}

export interface ZoneHeaderLayout {
  /** A narrow touch zone holding session tabs swaps the scrolling strip for
   *  the compact picker. */
  compactTabs: boolean
  tabStripHeight: number
  /** A top-edge zone's tabs take their own row under the window controls. */
  tabsBelowControls: boolean
  /** A top-edge zone's tabs share the titlebar band with the controls. */
  tabsInTitlebar: boolean
  titlebarHeight: number
}

/** Where a zone's tabs sit relative to the window titlebar, and how tall the
 *  titlebar band and the tab row are. */
export function useZoneHeaderLayout({
  measuredBelowControls,
  narrow,
  shown,
  topEdge
}: ZoneHeaderLayoutInput): ZoneHeaderLayout {
  const touchTitlebar = useTouchTitlebar()
  const compactTabs = touchTitlebar && narrow && shown.some(isSessionStripPane)
  // A top-edge zone's tabs ride the window band with the controls. Only a
  // measured squeeze (or the touch picker) drops them to their own row: a
  // sidebar group used to be forced below, which left a whole column of dead
  // chrome above its switcher while the window band ran empty beside it.
  const tabsBelowControls = topEdge && (compactTabs || measuredBelowControls)

  return {
    compactTabs,
    // The compact tab row is a touch target the same height as the touch band.
    tabStripHeight: compactTabs ? TOUCH_TITLEBAR_HEIGHT : TAB_STRIP_HEIGHT,
    tabsBelowControls,
    tabsInTitlebar: topEdge && !tabsBelowControls,
    titlebarHeight: touchTitlebar ? TOUCH_TITLEBAR_HEIGHT : TITLEBAR_HEIGHT
  }
}
