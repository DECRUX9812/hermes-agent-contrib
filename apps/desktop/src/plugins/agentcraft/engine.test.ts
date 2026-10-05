import { describe, expect, it } from 'vitest'

import {
  B,
  bs,
  bsId,
  bsMeta,
  bulb,
  Dir,
  facing,
  idOf,
  Lamp,
  lamp,
  lampStatus,
  light,
  lightLoss,
  occludes,
  stairs,
} from './blocks'
import { AX, AZ, buildStudioPlan, DESK_ORDER, FEET } from './hq-builder'
import { findPath } from './life'
import { computeLight, smoothLight } from './light'
import { Plan } from './plan'
import { walkableGrid } from './world'

describe('block state packing', () => {
  it('round-trips id and meta', () => {
    const s = bs(idOf('oak_planks'), 0x2a)
    expect(bsId(s)).toBe(idOf('oak_planks'))
    expect(bsMeta(s)).toBe(0x2a)
  })

  it('facing stores dir in the low bits', () => {
    for (const dir of [Dir.N, Dir.E, Dir.S, Dir.W]) {
      expect(bsMeta(facing(idOf('bell'), dir)) & 0x03).toBe(dir)
    }
  })

  it('stairs pack dir and top bit independently', () => {
    const s = stairs(idOf('dark_oak_stairs'), Dir.S, true)
    expect(bsMeta(s) & 0x03).toBe(Dir.S)
    expect(bsMeta(s) & 0x04).not.toBe(0)
  })

  it('lamp status survives packing and reads back', () => {
    for (const status of [Lamp.IDLE, Lamp.WORKING, Lamp.ERROR, Lamp.DONE]) {
      expect(lampStatus(lamp(idOf('status_lamp'), status))).toBe(status)
    }
  })

  it('light blocks are non-occluding but carry emitted light', () => {
    const s = light(15)
    expect(occludes(s)).toBe(false)
    expect(lightLoss(s)).toBeLessThan(2)
  })

  it('bulb lit flag toggles emitted light', () => {
    const lit = bulb(true)
    const dark = bulb(false)
    expect(lit).not.toBe(dark)
  })
})

const mkPlan = () =>
  new Plan(-46, 60, -36, 46, 100, 54, 64, y => (y > 64 ? bs(B.AIR) : bs(B.DIRT)))

describe('plan', () => {
  const mk = mkPlan

  it('set/get round-trips block states', () => {
    const p = mk()
    const s = facing(idOf('monitor'), Dir.S)
    p.set(3, FEET, -9, s)
    expect(p.get(3, FEET, -9)).toBe(s)
    expect(bsId(p.get(999, 999, 999))).toBe(B.AIR)
  })

  it('bind associates a cell with an id', () => {
    const p = mk()
    p.set(1, FEET, 1, bs(idOf('monitor')))
    p.bind(1, FEET, 1, 'marlow')
    expect([...p.bindings.values()]).toContain('marlow')
  })

  it('anchors store pose + anchor lookup is by name', () => {
    const p = mk()
    p.anchor('seat_x', 1.5, FEET, 2.5, 90, 10)
    const a = p.anchors.get('seat_x')!
    expect(a.x).toBe(1.5)
    expect(a.yaw).toBe(90)
  })
})

describe('the HQ build', () => {
  const p = buildStudioPlan(DESK_ORDER)

  it('creates the studio anchors the scene relies on', () => {
    for (const name of ['task_wall', 'decision_podium', 'goal_atrium', 'spawn']) {
      expect(p.anchors.has(name), name).toBe(true)
    }

    for (const id of DESK_ORDER) {
      expect(p.anchors.has(`seat_${id}`), id).toBe(true)
      expect(p.anchors.has(`monitor_${id}`), id).toBe(true)
    }

    for (const cam of ['cam:exterior_hero', 'cam:task_wall', 'cam:night']) {
      expect(p.anchors.has(cam), cam).toBe(true)
    }
  })

  it('every camera anchor is inside the site box', () => {
    let n = 0

    for (const [name, a] of p.anchors) {
      if (!name.startsWith('cam:')) {continue}
      n++
      expect(a.x, name).toBeGreaterThan(-60)
      expect(a.x, name).toBeLessThan(62)
      expect(a.y, name).toBeGreaterThan(60)
      expect(a.y, name).toBeLessThan(100)
    }

    expect(n).toBeGreaterThan(5)
  })

  it('task wall anchor sits on the west-side board facing east', () => {
    const t = p.anchors.get('task_wall')!
    expect(t.x).toBeCloseTo(AX - 7.873, 1)
    expect(t.z).toBeCloseTo(AZ + 0.5, 1)
  })
})

describe('light propagation', () => {
  it('sky light reaches the floor inside the hall', () => {
    const p = buildStudioPlan(DESK_ORDER)
    const field = computeLight(p)
    const { sky } = smoothLight(field, AX, FEET, AZ, 0, 1, 0, AX, AZ)
    expect(sky).toBeGreaterThan(0.2)
  })

  it('block light decays away from a lamp', () => {
    const p = mkPlan()
    p.set(0, FEET + 2, 0, lamp(idOf('status_lamp'), Lamp.WORKING))
    const field = computeLight(p)
    const near = smoothLight(field, 0, FEET + 1, 0, 0, 1, 0, 0, 0).block
    const far = smoothLight(field, 0, FEET - 2, 0, 0, 1, 0, 0, 0).block
    expect(near).toBeGreaterThan(far)
  })
})

describe('walkable grid + pathfinding', () => {
  it('finds a path between two desks through the hall', () => {
    const p = buildStudioPlan(DESK_ORDER)
    const grid = walkableGrid(p)
    const seatA = p.anchors.get('seat_tove')!
    const seatB = p.anchors.get('seat_kit')!

    const path = findPath(
      grid,
      Math.floor(seatA.x), Math.floor(seatA.z),
      Math.floor(seatB.x), Math.floor(seatB.z),
    )

    expect(path.length).toBeGreaterThan(0)
    // manhattan-optimal-ish: path should be sane length, not a random walk
    expect(path.length).toBeLessThan(60)
    const end = path[path.length - 1]
    expect(end[0]).toBe(Math.floor(seatB.x))
    expect(end[1]).toBe(Math.floor(seatB.z))
  })

  it('returns empty when the goal is far outside the site', () => {
    const p = buildStudioPlan(DESK_ORDER)
    const grid = walkableGrid(p)
    const path = findPath(grid, 0, 20, -400, -300)
    expect(path.length).toBe(0)
  })
})
