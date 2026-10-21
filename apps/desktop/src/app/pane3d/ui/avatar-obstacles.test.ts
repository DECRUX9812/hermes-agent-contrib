// Register the cast: each body module calls `registerAvatar`, and the slot row
// only lays out avatars the registry knows (VAL-NOTIFY-007).
import '../avatars/grok'
import '../avatars/muse'

import { describe, expect, it } from 'vitest'

import { chartRuntime } from '../director/chart-state'
import type { AvatarState } from '../director/store'
import type { AvatarId, PaneAnchor, ScreenRect } from '../protocol'
import { AVATAR_IDS } from '../protocol'
import { reservedSlotRect, unionScreenRects } from '../scene/projection'
import { type AvatarSilhouette, visibleSlotLayout } from '../scene/slot-layout'

import { avatarObstacleBoxes, chartObstacleBox, isSettlingAvatar } from './avatar-obstacles'

/**
 * The card/bubble obstacle source (VAL-NOTIFY-007). While an avatar emerges its
 * rig is still below the perch line, so its animated `screenRect` reports the
 * space it will occupy as free. The reserved space — the final perch rect taken
 * straight from the slot row — must be an obstacle from the frame the avatar
 * becomes visible.
 */

const VIEWPORT = { height: 1198, width: 2132 }
const ANCHOR: PaneAnchor = { kind: 'hermes-browser', label: 'X post', rect: { height: 800, width: 2132, x: 0, y: 120 } }

const SILHOUETTES: AvatarSilhouette[] = [
  { height: 1.1, id: 'muse', width: 1.35 },
  { height: 1.05, id: 'grok', width: 0.7 }
]

function rows(
  states: Partial<Record<AvatarId, AvatarState>>
): Record<AvatarId, { state: AvatarState; visible: boolean }> {
  return Object.fromEntries(
    AVATAR_IDS.map(id => [
      id,
      { state: states[id] ?? 'hidden', visible: states[id] !== undefined && states[id] !== 'hidden' }
    ])
  ) as Record<AvatarId, { state: AvatarState; visible: boolean }>
}

function frames(
  byId: Partial<Record<AvatarId, ScreenRect | null>>
): Record<AvatarId, { screenRect: ScreenRect | null }> {
  return Object.fromEntries(AVATAR_IDS.map(id => [id, { screenRect: byId[id] ?? null }])) as Record<
    AvatarId,
    { screenRect: ScreenRect | null }
  >
}

/** Grok's perch, as the slot row and the registry budget it. */
function grokPerch(): ScreenRect {
  const slots = visibleSlotLayout({
    anchor: ANCHOR,
    avatars: rows({ grok: 'emerging', muse: 'idle' }),
    silhouettes: SILHOUETTES,
    viewport: VIEWPORT
  })

  return reservedSlotRect(slots.grok, SILHOUETTES[1], VIEWPORT)
}

const MUSE_RECT: ScreenRect = { height: 131, width: 195, x: 1425, y: 156 }

describe('isSettlingAvatar — the rig is between the pane and its perch', () => {
  it('is true only while emerging or hiding', () => {
    expect(isSettlingAvatar('emerging')).toBe(true)
    expect(isSettlingAvatar('hiding')).toBe(true)
    expect(isSettlingAvatar('idle')).toBe(false)
    expect(isSettlingAvatar('notifying')).toBe(false)
    expect(isSettlingAvatar('thinking')).toBe(false)
  })
})

describe('avatarObstacleBoxes — reserve the perch an emerging avatar climbs into', () => {
  it('unions the emerging avatar’s animated rect with its final perch rect', () => {
    const perch = grokPerch()
    // The rig is still below the perch line, on its way up.
    const animated: ScreenRect = { ...perch, y: perch.y + 90 }

    const boxes = avatarObstacleBoxes({
      anchor: ANCHOR,
      avatars: rows({ grok: 'emerging', muse: 'idle' }),
      frames: frames({ grok: animated, muse: MUSE_RECT }),
      silhouettes: SILHOUETTES,
      viewport: VIEWPORT
    })

    expect(boxes).toContainEqual(MUSE_RECT)
    expect(boxes).toContainEqual(unionScreenRects(animated, perch))

    // The reserved perch is covered, so a card can neither sit in the
    // newcomer's path nor on its landing spot.
    const grok = boxes[1]

    expect(grok.x).toBeLessThanOrEqual(perch.x)
    expect(grok.y).toBeLessThanOrEqual(perch.y)
    expect(grok.x + grok.width).toBeGreaterThanOrEqual(perch.x + perch.width)
    expect(grok.y + grok.height).toBeGreaterThanOrEqual(perch.y + perch.height)
  })

  it('reserves the perch even before the emerging avatar has projected a rect', () => {
    const perch = grokPerch()

    const boxes = avatarObstacleBoxes({
      anchor: ANCHOR,
      avatars: rows({ grok: 'emerging', muse: 'idle' }),
      frames: frames({ grok: null, muse: MUSE_RECT }),
      silhouettes: SILHOUETTES,
      viewport: VIEWPORT
    })

    expect(boxes).toEqual([MUSE_RECT, perch])
  })

  it('keeps a settled avatar’s exact projected rect (no slot approximation)', () => {
    const boxes = avatarObstacleBoxes({
      anchor: ANCHOR,
      avatars: rows({ grok: 'idle', muse: 'notifying' }),
      frames: frames({ grok: { ...MUSE_RECT, x: 1219 }, muse: MUSE_RECT }),
      silhouettes: SILHOUETTES,
      viewport: VIEWPORT
    })

    expect(boxes).toEqual([MUSE_RECT, { ...MUSE_RECT, x: 1219 }])
  })

  it('skips hidden avatars and the bubble’s own speaker', () => {
    const perch = grokPerch()

    const input = {
      anchor: ANCHOR,
      avatars: rows({ grok: 'emerging', muse: 'idle' }),
      frames: frames({ grok: null, muse: MUSE_RECT }),
      silhouettes: SILHOUETTES,
      viewport: VIEWPORT
    }

    expect(avatarObstacleBoxes({ ...input, exclude: 'grok' })).toEqual([MUSE_RECT])
    expect(avatarObstacleBoxes({ ...input, exclude: 'muse' })).toEqual([perch])
    expect(avatarObstacleBoxes({ ...input, avatars: rows({}) })).toEqual([])
  })
})

describe('chartObstacleBox — the presented chart panel as a secondary obstacle (VAL-CHART-005)', () => {
  const PANEL: ScreenRect = { height: 127, width: 388, x: 1093, y: 52 }

  it('is the runtime panel rect only while a chart is presented', () => {
    chartRuntime.visible = false
    chartRuntime.panelRect = null
    expect(chartObstacleBox()).toBeNull()

    chartRuntime.visible = true
    chartRuntime.panelRect = PANEL
    expect(chartObstacleBox()).toEqual(PANEL)

    // A panel rect without a presentation (mid-teardown) is not an obstacle.
    chartRuntime.visible = false
    expect(chartObstacleBox()).toBeNull()

    chartRuntime.panelRect = null
  })
})
