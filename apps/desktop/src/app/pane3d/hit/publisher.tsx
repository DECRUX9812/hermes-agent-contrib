/**
 * Publishes the pane's control messages up to main (architecture §6):
 *
 * - `hit-regions` — the padded, merged rectangles of everything interactive,
 *   in pane-local CSS px, recomputed once per animation frame and sent ONLY
 *   when the shape actually changed. Main converts them to DIP.
 * - `focus` — the pane is non-focusable until a composer needs the keyboard.
 * - `ignore-mouse` — darwin/win32 only: the exact per-pixel test that turns
 *   click-through off over an avatar or a `[data-pane-hit]` element. Padded
 *   shape regions never take the mouse by themselves.
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

import { type ForwardHitCursor, stepForwardHit } from './exact-hit'
import { buildHitRegions, domHitRects, regionsEqual } from './regions'

/** Every DOM node that should stay clickable, plus the chart container (§12). */
const HIT_SELECTOR = '[data-pane-hit],[data-pane-chart]'

/**
 * Forward-mode pointer state. Module-level and mutable: it is written by DOM
 * events at pointer rate and only read by the frame loop, so nothing here may
 * re-render React. The exact target is deliberately NOT cached here — it is
 * re-tested every tick (see `exactElementHit`).
 */
const forwardPointer = { active: false, dragging: false, x: 0, y: 0 }

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

/**
 * The exact target test at a pointer position. Recomputed every frame rather
 * than cached from the last `pointermove`: Chromium sends no move when the
 * content changes UNDER a stationary pointer, so an element that disappears
 * would otherwise leave the window taking clicks. `elementFromPoint` skips
 * `pointer-events:none` layers, which is exactly the pane's click-through
 * overlay, and it also ignores the zero-opacity handle wrapper — only a real
 * interactive node matches.
 */
function exactElementHit(point: { x: number; y: number }): boolean {
  return Boolean(document.elementFromPoint(point.x, point.y)?.closest(HIT_SELECTOR))
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
    const forwardCursor: ForwardHitCursor = { ignore: true }

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

      const pointer = forwardPointer.active ? { x: forwardPointer.x, y: forwardPointer.y } : null

      const step = stepForwardHit(forwardCursor, {
        composerOpen,
        dragging: forwardPointer.dragging,
        elementHit: pointer !== null && exactElementHit(pointer),
        platform: pane3dRuntime.platform,
        pointer,
        regionsEmpty: regions.length === 0
      })

      forwardCursor.ignore = step.ignore

      if (step.message) {
        api.control(step.message)
      }
    }

    frame = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(frame)
  }, [])

  return null
}
