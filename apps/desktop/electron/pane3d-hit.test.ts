/**
 * Contract tests for the click-through strategy planner (architecture §6,
 * VAL-HIT-005). The planner is the whole platform policy as data: Linux shapes
 * the window to the published regions (and NEVER to `setShape([])`, which
 * Electron would read as "whole rectangle"), darwin/win32 stay in forward mode
 * where the renderer's per-pixel test owns the ignore toggle, and region CSS
 * pixels convert to DIP through the window's zoom factor, rounded outward.
 * `applyHitRegions` runs that plan except on Linux, where the ignore ops are
 * skipped: X11's `setIgnoreMouseEvents(true)` is a one-way door that would make
 * the pane permanently click-through.
 *
 * Platform arrives as data — no test fakes the host OS.
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import type { ScreenRect } from '../src/app/pane3d/protocol'

import { applyHitRegions, COLLAPSED_SHAPE, planHitApplication, regionsToDip } from './pane3d-hit'

const rect = (x: number, y: number, width: number, height: number): ScreenRect => ({ height, width, x, y })

const MUSE = rect(100, 200, 120, 160)
const DOCK = rect(1600, 900, 280, 32)

test('linux with regions enables the mouse and shapes to the converted rects', () => {
  const plan = planHitApplication([MUSE], 'linux', 1)

  assert.equal(plan.strategy, 'shape')
  assert.equal(plan.ignoreMouse, false)
  assert.equal(plan.forward, false)
  assert.deepEqual(plan.shape, [MUSE])
  assert.deepEqual(plan.ops, [
    { forward: false, ignore: false, op: 'setIgnoreMouseEvents' },
    { op: 'setShape', rects: [MUSE] }
  ])
})

test('linux with no regions collapses to 1x1 and ignores the mouse, never setShape([])', () => {
  const plan = planHitApplication([], 'linux', 1)

  assert.equal(plan.strategy, 'shape')
  assert.equal(plan.ignoreMouse, true)
  assert.deepEqual(plan.ops, [
    { op: 'setShape', rects: [COLLAPSED_SHAPE] },
    { forward: false, ignore: true, op: 'setIgnoreMouseEvents' }
  ])
  assert.deepEqual(COLLAPSED_SHAPE, rect(0, 0, 1, 1))

  plan.ops.forEach(op => {
    if (op.op === 'setShape') {
      assert.notDeepEqual(op.rects, [], 'an empty setShape would make the pane a solid window')
      assert.equal(op.rects.length, 1)
    }
  })
})

test('region CSS pixels convert to DIP through the zoom factor, rounded outward', () => {
  // 10.5..110.5 x 20.2..70.5 at zoom 0.9 -> x 9, right 100, y 18, bottom 64.
  assert.deepEqual(regionsToDip([rect(10.5, 20.2, 100, 50.3)], 0.9), [rect(9, 18, 91, 46)])
  assert.deepEqual(regionsToDip([rect(10, 20, 100, 50)], 1), [rect(10, 20, 100, 50)])
  // A zoom the window cannot report must behave like 1 rather than zero the shape out.
  assert.deepEqual(regionsToDip([MUSE], 0), [MUSE])
  assert.deepEqual(regionsToDip([MUSE], Number.NaN), [MUSE])
  assert.deepEqual(regionsToDip([MUSE], -2), [MUSE])
})

test('the plan shapes to DIP, not to the renderer CSS px it was handed', () => {
  const plan = planHitApplication([rect(10, 20, 100, 50)], 'linux', 0.9)

  assert.deepEqual(plan.shape, [rect(9, 18, 90, 45)])
  assert.deepEqual(plan.ops[1], { op: 'setShape', rects: [rect(9, 18, 90, 45)] })
})

test('darwin and win32 plan forward mode and leave the shape alone', () => {
  const darwin = planHitApplication([MUSE], 'darwin', 0.9)
  const win32 = planHitApplication([DOCK], 'win32', 2)

  for (const plan of [darwin, win32]) {
    assert.equal(plan.strategy, 'forward')
    assert.equal(plan.ignoreMouse, true)
    assert.equal(plan.forward, true)
    assert.equal(plan.shape, null, 'forward platforms never call setShape')
    assert.deepEqual(plan.ops, [], 'the renderer owns the ignore toggle for non-empty regions')
  }
})

test('forward mode with nothing interactable re-arms click-through', () => {
  const plan = planHitApplication([], 'darwin', 1)

  assert.equal(plan.strategy, 'forward')
  assert.deepEqual(plan.ops, [{ forward: true, ignore: true, op: 'setIgnoreMouseEvents' }])
})

test('applyHitRegions shapes on linux and never runs the ignore op there', () => {
  const calls: string[] = []
  const shapeCalls: ScreenRect[][] = []

  const win = {
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => {
      calls.push(`ignore:${ignore}:${options?.forward ?? false}`)
    },
    setShape: (rects: ScreenRect[]) => {
      calls.push(`shape:${rects.length}`)
      shapeCalls.push(rects)
    }
  }

  const plan = applyHitRegions(win, [MUSE], 'linux', 1)

  assert.equal(plan.strategy, 'shape')
  assert.deepEqual(shapeCalls[0], [MUSE])
  // X11's ignore-mouse is a one-way door: (true) empties the input region and
  // (false) cannot restore it, so the shape is the only mechanism there and
  // the pane must never call it.
  assert.deepEqual(calls, ['shape:1'])
})

test('applyHitRegions collapses an empty update to 1x1 and never shapes to nothing', () => {
  const calls: string[] = []
  const shapes: ScreenRect[][] = []

  const win = {
    setIgnoreMouseEvents: (ignore: boolean) => calls.push(`ignore:${ignore}`),
    setShape: (rects: ScreenRect[]) => {
      calls.push(`shape:${rects.length}`)
      shapes.push(rects)
    }
  }

  applyHitRegions(win, [], 'linux', 0.9)

  assert.deepEqual(calls, ['shape:1'])
  assert.deepEqual(shapes, [[COLLAPSED_SHAPE]])
})

test('applyHitRegions keeps the ignore toggle on forward platforms', () => {
  const calls: string[] = []

  const win = {
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) =>
      calls.push(`ignore:${ignore}:${options?.forward ?? false}`),
    setShape: () => calls.push('shape')
  }

  applyHitRegions(win, [], 'darwin', 0.9)

  assert.deepEqual(calls, ['ignore:true:true'])
})

test('applyHitRegions does not touch the mouse on darwin when regions exist', () => {
  const calls: string[] = []

  const win = {
    setIgnoreMouseEvents: (ignore: boolean) => calls.push(`ignore:${ignore}`),
    setShape: () => calls.push('shape')
  }

  applyHitRegions(win, [MUSE], 'darwin', 0.9)

  assert.deepEqual(calls, [])
})
