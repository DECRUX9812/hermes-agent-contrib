import { describe, expect, it } from 'vitest'

import type { ScreenRect } from '../protocol'

import { PILL_GAP, pillLayout } from './pill-layout'

const viewport = { height: 1000, width: 1600 }
const pill = { height: 56, width: 220 }

function avatar(x: number, y: number, width = 120, height = 130): ScreenRect {
  return { height, width, x, y }
}

describe('task pill placement', () => {
  it('centres the pill under the avatar', () => {
    const placement = pillLayout(avatar(400, 200), pill, viewport)

    expect(placement.side).toBe('below')
    expect(placement.left).toBe(400 + 60 - 110)
    expect(placement.top).toBe(200 + 130 + PILL_GAP)
  })

  it('clamps the pill inside the pane on both horizontal edges', () => {
    expect(pillLayout(avatar(-40, 200), pill, viewport).left).toBe(8)
    expect(pillLayout(avatar(1560, 200), pill, viewport).left).toBe(viewport.width - pill.width - 8)
  })

  it('sits above the avatar when there is no room below', () => {
    const placement = pillLayout(avatar(400, 950), pill, viewport)

    expect(placement.side).toBe('above')
    expect(placement.top).toBe(950 - pill.height - PILL_GAP)
    expect(placement.top + pill.height).toBeLessThanOrEqual(viewport.height - 8)
  })

  it('clears an obstacle under the avatar instead of covering it', () => {
    const obstacle = { height: 200, width: 400, x: 360, y: 340 }
    const placement = pillLayout(avatar(400, 200), pill, viewport, PILL_GAP, 8, [obstacle])

    // The pill would have started at 340 and overlapped the obstacle it may not cover.
    expect(
      placement.top + pill.height + PILL_GAP <= obstacle.y || placement.top >= obstacle.y + obstacle.height + PILL_GAP
    ).toBe(true)
  })
})
