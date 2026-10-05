/**
 * Publishes the pane's control messages up to main (architecture §6):
 *
 * - `hit-regions` — the padded, merged rectangles of everything interactive,
 *   in pane-local CSS px, recomputed once per animation frame and sent ONLY
 *   when the shape actually changed. Main converts them to DIP.
 * - `focus` — the pane is non-focusable until a composer needs the keyboard.
 * - `ignore-mouse` — darwin/win32 only: the exact per-pixel test that turns
 *   click-through off over an avatar or a `[data-pane-hit]` element.
 *
 * A dedicated rAF loop, not a `useFrame`: regions must stay correct while the
 * canvas is idle (`frameloop='demand'`), or the dock and the hover chips would
 * stop being clickable the moment the last avatar hid.
 */

import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { dispatch } from '../director/director'
import { $avatars, $platform, pane3dRuntime } from '../director/store'
import type { ScreenRect } from '../protocol'
import { AVATAR_IDS } from '../protocol'
import { avatarFrames } from '../scene/projection'

import { decideIgnoreMouse } from './exact-hit'
import { buildHitRegions, domHitRects, regionsEqual } from './regions'

/** Every DOM node that should stay clickable, plus the chart container (§12). */
const HIT_SELECTOR = '[data-pane-hit],[data-pane-chart]'

/**
 * Forward-mode pointer state. Module-level and mutable: it is written by DOM
 * events at pointer rate and only read by the frame loop, so nothing here may
 * re-render React.
 */
const forwardPointer = { active: false, dragging: false, elementHit: false, x: 0, y: 0 }

function currentRegions(): ScreenRect[] {
  const avatars = $avatars.get()
  const avatarRects: ScreenRect[] = []

  AVATAR_IDS.forEach(id => {
    if (avatars[id].visible) {
      avatarRects.push(...avatarFrames[id].hitRects)
    }
  })

  return buildHitRegions({ avatars: avatarRects, dom: domHitRects(document.querySelectorAll(HIT_SELECTOR)) })
}

/** The composer enters `listening`; that is when the pane needs the keyboard. */
function isComposerOpen(): boolean {
  const avatars = $avatars.get()

  return AVATAR_IDS.some(id => avatars[id].state === 'listening')
}

export function HitRegionPublisher(): null {
  const platform = useStore($platform)

  // Forward mode only: the pointer arrives as a forwarded move because the
  // window ignores the mouse (Linux has no forwarded moves — setShape there).
  useEffect(() => {
    if (platform === 'linux') {
      forwardPointer.active = false

      return undefined
    }

    const onMove = (event: PointerEvent) => {
      forwardPointer.active = true
      forwardPointer.x = event.clientX
      forwardPointer.y = event.clientY
      forwardPointer.elementHit = Boolean(
        document.elementFromPoint(event.clientX, event.clientY)?.closest(HIT_SELECTOR)
      )
    }

    const onDown = () => {
      forwardPointer.dragging = true
    }

    const onUp = () => {
      forwardPointer.dragging = false
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [platform])

  // The pane becomes focusable only while a composer is open, and Esc closes
  // it — without that the pane could never give the keyboard back (§6).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      const avatars = $avatars.get()

      AVATAR_IDS.forEach(id => {
        if (avatars[id].state === 'listening') {
          dispatch(id, 'COMPOSER_CLOSE')
        }
      })
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    let frame = 0
    let lastRegions: ScreenRect[] = []
    let lastFocusable: boolean | null = null
    let lastIgnore = true

    const tick = () => {
      frame = requestAnimationFrame(tick)

      const api = window.hermesDesktop?.pane3d

      if (!api) {
        return
      }

      const regions = currentRegions()

      if (!regionsEqual(regions, lastRegions)) {
        lastRegions = regions
        pane3dRuntime.regions = regions
        api.control({ regions, type: 'hit-regions' })
      }

      const composerOpen = isComposerOpen()

      if (composerOpen !== lastFocusable) {
        lastFocusable = composerOpen
        api.control({ focusable: composerOpen, type: 'focus' })
      }

      if (pane3dRuntime.platform === 'linux') {
        return
      }

      const ignore = decideIgnoreMouse({
        composerOpen,
        current: lastIgnore,
        dragging: forwardPointer.dragging,
        elementHit: forwardPointer.elementHit,
        platform: pane3dRuntime.platform,
        pointer: forwardPointer.active ? { x: forwardPointer.x, y: forwardPointer.y } : null,
        regions: pane3dRuntime.regions
      })

      if (ignore !== lastIgnore) {
        lastIgnore = ignore
        api.control({ ignore, type: 'ignore-mouse' })
      }
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return null
}
