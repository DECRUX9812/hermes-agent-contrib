/**
 * Contract tests for the forward click-through decision (architecture §6,
 * VAL-HIT-005's toggle clause). The pane must never take the mouse on Linux,
 * must keep it while the composer is open, must not change its mind mid-drag,
 * and otherwise ignores the mouse exactly when the pointer is off every region.
 */

import { describe, expect, it } from 'vitest'

import type { ScreenRect } from '../protocol'

import { decideIgnoreMouse, pointInAnyRegion, pointInRect } from './exact-hit'

const rect = (x: number, y: number, width: number, height: number): ScreenRect => ({ height, width, x, y })
const MUSE: ScreenRect = rect(100, 200, 120, 160)

const base = {
  composerOpen: false,
  current: true,
  dragging: false,
  elementHit: false,
  platform: 'darwin' as NodeJS.Platform,
  pointer: { x: 0, y: 0 },
  regions: [MUSE]
}

describe('pointInRect / pointInAnyRegion', () => {
  it('is inclusive of the top-left corner and exclusive of the bottom-right', () => {
    expect(pointInRect({ x: 100, y: 200 }, MUSE)).toBe(true)
    expect(pointInRect({ x: 219, y: 359 }, MUSE)).toBe(true)
    expect(pointInRect({ x: 220, y: 200 }, MUSE)).toBe(false)
    expect(pointInRect({ x: 100, y: 360 }, MUSE)).toBe(false)
    expect(pointInAnyRegion({ x: 150, y: 250 }, [rect(0, 0, 10, 10), MUSE])).toBe(true)
    expect(pointInAnyRegion({ x: 150, y: 250 }, [rect(0, 0, 10, 10)])).toBe(false)
  })
})

describe('decideIgnoreMouse', () => {
  it('never takes the mouse on linux — setShape owns interactivity there', () => {
    expect(decideIgnoreMouse({ ...base, current: true, platform: 'linux' })).toBe(true)
    expect(decideIgnoreMouse({ ...base, current: false, platform: 'linux', pointer: { x: 999, y: 999 } })).toBe(false)
  })

  it('ignores the mouse when the pointer is off every region and takes it over one', () => {
    expect(decideIgnoreMouse({ ...base, pointer: { x: 10, y: 10 } })).toBe(true)
    expect(decideIgnoreMouse({ ...base, pointer: { x: 150, y: 250 } })).toBe(false)
  })

  it('takes the mouse when only the DOM test matched (a card over empty canvas)', () => {
    expect(decideIgnoreMouse({ ...base, elementHit: true, pointer: { x: 10, y: 10 }, regions: [] })).toBe(false)
  })

  it('keeps the mouse while the composer is open, wherever the pointer is', () => {
    expect(decideIgnoreMouse({ ...base, composerOpen: true, pointer: { x: 10, y: 10 } })).toBe(false)
  })

  it('does not flip state mid-drag', () => {
    expect(decideIgnoreMouse({ ...base, current: false, dragging: true, pointer: { x: 10, y: 10 } })).toBe(false)
    expect(decideIgnoreMouse({ ...base, current: true, dragging: true, pointer: { x: 150, y: 250 } })).toBe(true)
  })

  it('stays click-through until the first forwarded move', () => {
    expect(decideIgnoreMouse({ ...base, elementHit: true, pointer: null, regions: [] })).toBe(true)
  })

  it('behaves the same on win32 as on darwin', () => {
    expect(decideIgnoreMouse({ ...base, platform: 'win32', pointer: { x: 150, y: 250 } })).toBe(false)
    expect(decideIgnoreMouse({ ...base, platform: 'win32', pointer: { x: 1, y: 1 } })).toBe(true)
  })
})
