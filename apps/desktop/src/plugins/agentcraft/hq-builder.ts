/**
 * The "Warm Studio" HQ world builder — a line-faithful TypeScript port of
 * `mod/src/main/java/dev/agentcraft/hq/StudioHqBuilder.java` +
 * `HqLandscape.java` (MIT, github.com/blendi-remade/agentcraft). All constants,
 * geometry decisions and camera anchors are 1:1 so the rendered studio matches
 * the Minecraft build block for block.
 *
 * Coordinate conventions identical to Minecraft: +x east, +z south, y up.
 * Blocks fill the unit cube from (x,y,z) to (x+1,y+1,z+1).
 */

import {
  Axis,
  B,
  bell,
  bs,
  candle,
  chain,
  Dir,
  facing,
  flowerBed,
  lamp,
  Lamp,
  lantern,
  light,
  log,
  MC_2D,
  slab,
  stairs,
  trapdoor,
  upper,
} from './blocks'
import { Plan } from './plan'

// ------------------------------------------------------------------ dimensions
export const GROUND = 64
export const FLOOR = 65
export const FEET = 66
export const HX = 24
export const HZN = -10
export const HZS = 6
export const WALL_TOP = 71
export const FRIEZE = 72
export const EAVE_Y = 72
export const RIDGE_Z = -2
export const AX = 0
export const AZ = 15
export const ATRIUM_TOP = 76
export const SPRING = 77
export const SITE = [-46, 60, -36, 46, 100, 54] as const

export const DESK_X = [-15, -11, -7, 7, 11, 15]
export const DESK_ORDER = ['tove', 'juniper', 'marlow', 'wren', 'rowan', 'kit']
export const CHAIR_DX = -1
export const BEACON = 'beacon'

const AIR = bs(B.AIR)
const PLASTER = bs(B.PLASTER_PANEL)
const PLASTER_FRAME = bs(B.PLASTER_FRAME)
const WALNUT = bs(B.WALNUT_PANEL)
const WALNUT_TRIM = bs(B.WALNUT_TRIM)
const TILE = bs(B.TERRACOTTA_TILE)
const PARQUET = bs(B.OAK_PARQUET)
const GLOW_PANEL = bs(B.GLOW_PANEL)
const PLINTH = bs(B.MUD_BRICKS)
const FLOOR_WOOD = bs(B.BIRCH_PLANKS)
const DARK_PLANKS = bs(B.DARK_OAK_PLANKS)
const GLASS_PANE = bs(B.GLASS_PANE)
const ROOF_STAIRS = B.CUT_COPPER_STAIRS
const ROOF_SLAB = B.CUT_COPPER_SLAB
const ROOF_FULL = bs(B.DARK_OAK_PLANKS)
const ROOF_TRIM = B.DARK_OAK_STAIRS
const CEIL_STAIRS = B.PALE_OAK_STAIRS
const CEIL_FULL = bs(B.PALE_OAK_PLANKS)
const COPPER = bs(B.CUT_COPPER)
const COPPER_STAIRS = B.CUT_COPPER_STAIRS
const COPPER_SLAB = B.CUT_COPPER_SLAB
const COPPER_CHAIN = B.COPPER_CHAIN
const LANTERN = lantern(B.LANTERN, false)
const LANTERN_HANGING = lantern(B.LANTERN, true)
const SOFA = B.WOOL_STAIRS

const post = () => log(B.STRIPPED_DARK_OAK_LOG, Axis.Y)
const beam = (axis: Axis) => log(B.STRIPPED_DARK_OAK_LOG, axis)
const bulbOff = () => bs(B.COPPER_BULB, 0)

export function deskIds(cast: string[]): string[] {
  const out: string[] = []

  for (const id of DESK_ORDER) {
    if (cast.includes(id)) {out.push(id)}
  }

  for (const id of cast) {
    if (!out.includes(id)) {out.push(id)}
  }

  while (out.length < DESK_X.length) {out.push(`agent${out.length}`)}

  return out
}

// ================================================================== geometry helpers

export function octIn(dx: number, dz: number): boolean {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)

  return ax <= 8 && az <= 8 && ax + az <= 12
}

export function octFoot(dx: number, dz: number): boolean {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)

  return ax <= 9 && az <= 9 && ax + az <= 14
}

export function octWall(dx: number, dz: number): boolean {
  return octFoot(dx, dz) && !octIn(dx, dz)
}

export function octR(dx: number, dz: number): number {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)

  return Math.max(Math.max(ax, az), ax + az - 4)
}

export function octInside(dx: number, dz: number, a: number): boolean {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)

  return ax <= a && az <= a && ax + az <= Math.floor((3 * a + 1) / 2)
}

export function roofY(z: number): number {
  return EAVE_Y + Math.min(z + 11, 7 - z)
}

export function isPostX(x: number): boolean {
  const ax = Math.abs(x)

  return ax === 24 || ax === 21 || ax === 17 || ax === 13 || ax === 9 || ax === 5
}

export function fireplaceX(x: number): boolean {
  return x >= -12 && x <= -9
}

// ================================================================== hall

function hallShell(p: Plan): void {
  p.fill(-HX, GROUND, HZN, HX, GROUND, HZS, bs(B.DIRT))

  for (let x = -HX; x <= HX; x++) {
    for (let z = HZN; z <= HZS; z++) {
      const edge = Math.abs(x) === HX || z === HZN || z === HZS
      p.set(x, FLOOR, z, edge ? PLINTH : FLOOR_WOOD)
    }
  }

  for (let x = -HX; x <= HX; x++) {
    wallColumn(p, x, HZN, true)

    if (!octFoot(x - AX, HZS - AZ)) {
      wallColumn(p, x, HZS, false)
    }
  }

  for (let z = HZN; z <= HZS; z++) {
    for (const sx of [-HX, HX]) {
      gableColumn(p, sx, z)
    }
  }

  for (let x = -21; x <= 21; x++) {
    if (!isPostX(x)) {continue}
    p.set(x, WALL_TOP, HZN + 1, stairs(B.DARK_OAK_STAIRS, Dir.N, true))

    if (Math.abs(x) >= 9) {
      p.fill(x, FEET, HZS - 1, x, WALL_TOP, HZS - 1, post())
    } else {
      p.set(x, WALL_TOP, HZS - 1, stairs(B.DARK_OAK_STAIRS, Dir.S, true))
    }

    p.fill(x, FRIEZE, HZN + 1, x, FRIEZE, HZS - 1, beam(Axis.Z))
    p.fill(x, FRIEZE + 1, RIDGE_Z, x, roofY(RIDGE_Z) - 2, RIDGE_Z, post())

    for (let i = 1; i <= 3; i++) {
      p.set(x, FRIEZE + 1 + (3 - i), RIDGE_Z - i, stairs(B.DARK_OAK_STAIRS, Dir.S, true))
      p.set(x, FRIEZE + 1 + (3 - i), RIDGE_Z + i, stairs(B.DARK_OAK_STAIRS, Dir.N, true))
    }
  }

  for (let x = -HX + 1; x <= HX - 1; x++) {
    if (isPostX(x)) {continue}
    p.set(x, WALL_TOP, HZN + 1, slab(B.DARK_OAK_SLAB, true))

    if (!octFoot(x - AX, HZS - AZ) && !fireplaceX(x)) {
      p.set(x, WALL_TOP, HZS - 1, slab(B.DARK_OAK_SLAB, true))
    }
  }
}

function wallColumn(p: Plan, x: number, z: number, north: boolean): void {
  p.set(x, FLOOR, z, PLINTH)

  if (isPostX(x)) {
    p.fill(x, FEET, z, x, WALL_TOP, z, post())
  } else {
    p.set(x, FEET, z, WALNUT_TRIM)
    const ax = Math.abs(x)

    if (north) {
      if (ax <= 3) {
        p.fill(x, FEET + 1, z, x, WALL_TOP, z, GLASS_PANE)
      } else if (ax === 4) {
        p.fill(x, FEET + 1, z, x, WALL_TOP, z, PLASTER)
      } else {
        p.fill(x, FEET + 1, z, x, FEET + 3, z, PLASTER)
        p.fill(x, FEET + 4, z, x, WALL_TOP, z, GLASS_PANE)
      }
    } else {
      p.fill(x, FEET + 1, z, x, FEET + 4, z, GLASS_PANE)
      p.set(x, WALL_TOP, z, PLASTER_FRAME)
    }
  }

  p.set(x, FRIEZE, z, beam(Axis.X))
}

function gableColumn(p: Plan, x: number, z: number): void {
  const corner = z === HZN || z === HZS
  p.set(x, FLOOR, z, PLINTH)

  if (corner || z === RIDGE_Z || z === -6 || z === 2) {
    p.fill(x, FEET, z, x, WALL_TOP, z, post())
  } else {
    p.set(x, FEET, z, WALNUT_TRIM)
    p.fill(x, FEET + 1, z, x, FEET + 2, z, PLASTER)
    p.fill(x, FEET + 3, z, x, WALL_TOP - 1, z, GLASS_PANE)
    p.set(x, WALL_TOP, z, PLASTER_FRAME)
  }

  p.set(x, FRIEZE, z, beam(Axis.Z))
  const top = roofY(z) - 1

  for (let y = FRIEZE + 1; y <= top; y++) {
    p.set(x, y, z, PLASTER)
  }

  if (FRIEZE + 1 <= top) {
    p.set(x, FRIEZE + 1, z, beam(Axis.Z))
  }

  const dz = z - RIDGE_Z
  const cy = FRIEZE + 4.5

  for (let y = FRIEZE + 2; y <= top; y++) {
    const dy = y - cy
    const r = Math.sqrt(dz * dz + dy * dy)

    if (r < 2.4) {
      p.set(x, y, z, GLASS_PANE)
    } else if (r < 3.2) {
      p.set(x, y, z, DARK_PLANKS)
    } else if (z === RIDGE_Z) {
      p.set(x, y, z, post())
    }
  }
}

function hallRoof(p: Plan): void {
  for (let x = -HX - 1; x <= HX + 1; x++) {
    for (let z = HZN - 1; z <= HZS + 1; z++) {
      if (octFoot(x - AX, z - AZ)) {continue}
      const y = roofY(z)

      if (z === RIDGE_Z) {
        p.set(x, y, z, ROOF_FULL)
        p.set(x, y + 1, z, slab(B.DARK_OAK_SLAB, false))
      } else {
        const trim = Math.abs(x) === HX + 1 || z === HZN - 1 || z === HZS + 1
        p.set(x, y, z, stairs(trim ? ROOF_TRIM : ROOF_STAIRS, z < RIDGE_Z ? Dir.S : Dir.N, false))
      }

      if (Math.abs(x) < HX && z > HZN && z < HZS) {
        if (z === RIDGE_Z) {
          p.set(x, y - 1, z, CEIL_FULL)
        } else {
          p.set(x, y - 1, z, stairs(CEIL_STAIRS, z < RIDGE_Z ? Dir.N : Dir.S, true))
        }
      }
    }
  }

  dormer(p, -15, true)
  dormer(p, 15, true)
  dormer(p, -15, false)
  dormer(p, 15, false)
  const ct = roofY(4) + 4
  p.fill(-11, FRIEZE, 4, -10, ct, 5, bs(B.MUD_BRICKS))
  p.fill(-11, ct + 1, 4, -10, ct + 1, 5, slab(B.MUD_BRICK_SLAB, false))
  p.set(-11, ct + 1, 4, bs(B.CAMPFIRE))
}

function dormer(p: Plan, cx: number, south: boolean): void {
  const zf = south ? HZS : HZN
  const out = south ? 1 : -1
  const ridge = 79

  for (let k = -3; k <= 3; k++) {
    const x = cx + k
    const hd = ridge - Math.abs(k)

    for (let z = zf + out; z !== RIDGE_Z - out; z -= out) {
      const yr = roofY(z)

      if (yr >= hd) {break}
      p.set(x, hd, z, k === 0 ? ROOF_FULL : stairs(ROOF_STAIRS, k < 0 ? Dir.E : Dir.W, false))

      if (k === 0) {
        p.set(x, hd + 1, z, slab(B.DARK_OAK_SLAB, false))
      }

      if (z === zf || z === zf + out) {continue}

      if (Math.abs(k) <= 1) {
        p.set(x, yr, z, AIR)
        p.set(x, yr - 1, z, AIR)
      } else if (Math.abs(k) === 2) {
        for (let y = yr + 1; y < hd; y++) {
          p.set(x, y, z, PLASTER)
        }
      }
    }
  }

  for (let k = -2; k <= 2; k++) {
    const x = cx + k
    const hd = ridge - Math.abs(k)

    for (let y = FRIEZE + 1; y < hd; y++) {
      let st: number

      if (Math.abs(k) === 2) {
        st = post()
      } else if (y <= FRIEZE + 3) {
        st = GLASS_PANE
      } else if (y === FRIEZE + 4) {
        st = beam(Axis.X)
      } else {
        st = PLASTER
      }

      p.set(x, y, zf, st)
    }
  }
}

// ================================================================== atrium (octagon)

function atriumShell(p: Plan): void {
  for (let dx = -9; dx <= 9; dx++) {
    for (let dz = -9; dz <= 9; dz++) {
      if (!octFoot(dx, dz)) {continue}
      const x = AX + dx
      const z = AZ + dz
      p.set(x, GROUND, z, bs(B.DIRT))

      if (octIn(dx, dz)) {
        for (let y = FEET; y <= 92; y++) {
          p.set(x, y, z, AIR)
        }

        continue
      }

      p.set(x, FLOOR, z, PLINTH)

      for (let y = FEET; y <= ATRIUM_TOP; y++) {
        p.set(x, y, z, atriumWall(dx, dz, y))
      }
    }
  }

  for (let x = -3; x <= 3; x++) {
    for (let y = FEET; y <= FEET + 4; y++) {
      p.set(x, y, HZS, AIR)
    }
  }

  p.set(-3, FEET + 4, HZS, stairs(B.DARK_OAK_STAIRS, Dir.E, true))
  p.set(3, FEET + 4, HZS, stairs(B.DARK_OAK_STAIRS, Dir.W, true))
  p.fill(-2, FEET + 5, HZS, 2, FEET + 5, HZS, beam(Axis.X))
  p.fill(-4, FEET, HZS, -4, FEET + 5, HZS, post())
  p.fill(4, FEET, HZS, 4, FEET + 5, HZS, post())
  const zs = AZ + 9

  for (let x = -1; x <= 1; x++) {
    for (let y = FEET; y <= FEET + 3; y++) {
      p.set(x, y, zs, AIR)
    }
  }

  p.set(-1, FEET + 3, zs, stairs(B.DARK_OAK_STAIRS, Dir.E, true))
  p.set(1, FEET + 3, zs, stairs(B.DARK_OAK_STAIRS, Dir.W, true))
  p.fill(-1, FEET + 4, zs, 1, FEET + 4, zs, beam(Axis.X))
  p.fill(-1, FEET + 5, zs, 1, FEET + 7, zs, GLASS_PANE)
  p.fill(-2, FEET, zs, -2, FEET + 7, zs, post())
  p.fill(2, FEET, zs, 2, FEET + 7, zs, post())

  for (let x = -1; x <= 1; x++) {
    p.set(x, FLOOR, zs, DARK_PLANKS)
  }
}

function atriumWall(dx: number, dz: number, y: number): number {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)
  const orthoX = ax === 9 && az <= 4
  const orthoZ = az === 9 && ax <= 4
  const cornerPost = (ax === 9 && az === 5) || (az === 9 && ax === 5)

  if (cornerPost) {return post()}

  if (y === FEET) {return WALNUT_TRIM}

  if (orthoX || orthoZ) {
    const along = orthoX ? az : ax
    const north = orthoZ && dz < 0

    if (y === 72) {
      return beam(orthoX ? Axis.Z : Axis.X)
    }

    if (north) {
      return y === 71 ? PLASTER_FRAME : PLASTER
    }

    if (along === 2) {
      return post()
    }

    if (y >= 73 && y <= 75 && along <= 1) {
      return GLASS_PANE
    }

    if (orthoX && y === FEET + 3) {
      return beam(Axis.Z)
    }

    return y === 71 ? PLASTER_FRAME : PLASTER
  }

  const southDiag = dz > 0

  if (southDiag && y >= FEET + 1 && y <= 75 && y !== 72 && ax >= 6 && ax <= 8 && az >= 5 && az <= 8) {
    return GLASS_PANE
  }

  if (y === 72) {
    return DARK_PLANKS
  }

  return y === 71 ? PLASTER_FRAME : PLASTER
}

// ================================================================== dome

export const DOME_R = 10.6
export const DOME_H = 9.0
export const DOME_RI = 8.8
export const DOME_HI = 7.0
export const DOME_P = 2.2
const DOME_SKIN = bs(B.COPPER_BLOCK)

export function hip(dx: number, dz: number): boolean {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)
  const r = octR(dx, dz)

  return r >= 4 && ax + az - 4 === r && (ax === r || az === r)
}

export function domeFoot(dx: number, dz: number): boolean {
  return octFoot(dx, dz) && octR(dx, dz) < DOME_R - 0.05
}

export function profile(r: number, rad: number, h: number): number {
  const q = Math.pow(Math.min(1, r / rad), DOME_P)

  return h * Math.sqrt(Math.max(0, 1 - q))
}

function domeTop2(dx: number, dz: number): number {
  if (!domeFoot(dx, dz)) {return 2 * SPRING}

  return Math.round(2 * (SPRING + profile(octR(dx, dz), DOME_R, DOME_H)))
}

function domeIn2(dx: number, dz: number): number {
  const r = octR(dx, dz)

  if (!domeFoot(dx, dz) || r >= DOME_RI) {return 2 * SPRING}
  const i2 = Math.round(2 * (SPRING + profile(r, DOME_RI, DOME_HI)))

  return Math.min(i2, domeTop2(dx, dz) - 4)
}

function oculus(dx: number, dz: number): boolean {
  return octInside(dx, dz, 2)
}

function dome(p: Plan): void {
  const topY = SPRING + Math.ceil(DOME_H) + 1

  for (let dx = -9; dx <= 9; dx++) {
    for (let dz = -9; dz <= 9; dz++) {
      if (!domeFoot(dx, dz) || oculus(dx, dz)) {continue}
      const t2 = domeTop2(dx, dz)
      const i2 = domeIn2(dx, dz)
      const rib = dx === 0 || dz === 0

      for (let y = SPRING; y <= topY; y++) {
        const lo = 2 * y >= i2 && 2 * y < t2
        const hi = 2 * y + 1 >= i2 && 2 * y + 1 < t2

        if (!lo && !hi) {continue}
        const exterior = 2 * y + 2 >= t2 || exposedOut(dx, dz, y)
        const interior = (i2 > 2 * SPRING && 2 * y <= i2 && i2 < 2 * y + 2) || exposedIn(dx, dz, y)
        let s: number

        if (exterior && hip(dx, dz)) {
          s = lo && hi ? DARK_PLANKS : slab(B.DARK_OAK_SLAB, !lo)
        } else if (exterior) {
          s = lo && hi ? DOME_SKIN : slab(COPPER_SLAB, !lo)
        } else if (interior) {
          const slabId = rib ? B.DARK_OAK_SLAB : B.PALE_OAK_SLAB
          const full = rib ? DARK_PLANKS : PLASTER
          s = lo && hi ? full : lo ? slab(slabId, false) : slab(slabId, true)
        } else {
          s = COPPER
        }

        p.set(AX + dx, y, AZ + dz, s)
      }
    }
  }

  for (let dx = -10; dx <= 10; dx++) {
    for (let dz = -10; dz <= 10; dz++) {
      const x = AX + dx
      const z = AZ + dz

      if (octWall(dx, dz)) {
        p.set(x, SPRING, z, beam(Math.abs(dx) > Math.abs(dz) ? Axis.Z : Axis.X))

        continue
      }

      if (octFoot(dx, dz) || !octInside(dx, dz, 10)) {continue}
      const ax = Math.abs(dx)
      const az = Math.abs(dz)
      const inDir: Dir = ax >= az ? (dx > 0 ? Dir.W : Dir.E) : dz > 0 ? Dir.N : Dir.S
      const inX = DIR_STEP_X[inDir]
      const inZ = DIR_STEP_Z[inDir]

      if (!octFoot(dx + inX, dz + inZ)) {continue}

      if (p.isAir(x, ATRIUM_TOP, z)) {
        p.set(x, ATRIUM_TOP, z, stairs(B.DARK_OAK_STAIRS, inDir, true))
      }
    }
  }

  lanternCupola(p)
}

const DIR_STEP_X = [0, 1, 0, -1]
const DIR_STEP_Z = [-1, 0, 1, 0]

function exposedOut(dx: number, dz: number, y: number): boolean {
  for (let d = 0; d < 4; d++) {
    const nx = dx + DIR_STEP_X[d]
    const nz = dz + DIR_STEP_Z[d]

    if (!domeFoot(nx, nz)) {
      if (y > SPRING || !octFoot(nx, nz)) {return true}

      continue
    }

    if (!oculus(nx, nz) && domeTop2(nx, nz) <= 2 * y + 1) {return true}
  }

  return false
}

function exposedIn(dx: number, dz: number, y: number): boolean {
  for (let d = 0; d < 4; d++) {
    const nx = dx + DIR_STEP_X[d]
    const nz = dz + DIR_STEP_Z[d]

    if (!domeFoot(nx, nz)) {continue}

    if (oculus(nx, nz)) {
      if (2 * y + 1 < lanternBase() * 2) {return true}

      continue
    }

    const i2 = domeIn2(nx, nz)

    if (i2 > 2 * SPRING && i2 > 2 * y) {return true}
  }

  return false
}

export function lanternBase(): number {
  return Math.floor(SPRING + profile(3.0, DOME_R, DOME_H) + 0.5)
}

function lanternCupola(p: Plan): void {
  const b = lanternBase()

  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const x = AX + dx
      const z = AZ + dz
      const ax = Math.abs(dx)
      const az = Math.abs(dz)
      const ring = octInside(dx, dz, 3) && !octInside(dx, dz, 2)
      const inner = octInside(dx, dz, 2)

      if (ring) {
        p.set(x, b, z, COPPER)
        const postCell = (ax === 3 && az === 2) || (ax === 2 && az === 3)

        for (let y = b + 1; y <= b + 2; y++) {
          p.set(x, y, z, postCell ? COPPER : GLASS_PANE)
        }

        if (postCell) {
          p.set(x, b + 3, z, COPPER)
        } else {
          p.set(x, b + 3, z, lamp(B.STATUS_LAMP, Lamp.IDLE))
          p.bind(x, b + 3, z, BEACON)
        }
      } else if (inner) {
        for (let y = b - 2; y <= b + 3; y++) {
          p.set(x, y, z, AIR)
        }
      }

      if (octInside(dx, dz, 4) && !octInside(dx, dz, 3)) {
        p.set(x, b + 4, z, slab(COPPER_SLAB, false))
      } else if (octInside(dx, dz, 3)) {
        p.set(x, b + 4, z, octInside(dx, dz, 1) ? GLOW_PANEL : COPPER)
      }

      if (octInside(dx, dz, 3) && !octInside(dx, dz, 2)) {
        p.set(x, b + 5, z, slab(COPPER_SLAB, false))
      } else if (octInside(dx, dz, 2)) {
        p.set(x, b + 5, z, COPPER)
      }

      if (octInside(dx, dz, 2) && !octInside(dx, dz, 1)) {
        p.set(x, b + 6, z, slab(COPPER_SLAB, false))
      } else if (octInside(dx, dz, 1)) {
        p.set(x, b + 6, z, COPPER)
      }
    }
  }

  p.set(AX, b + 7, AZ, slab(COPPER_SLAB, false))
  p.set(AX, b + 8, AZ, bs(B.LIGHTNING_ROD))
  p.set(AX + 1, b + 2, AZ, light(14))
  p.set(AX - 1, b + 2, AZ, light(14))
  p.set(AX, b + 2, AZ + 1, light(14))
  p.set(AX, b + 2, AZ - 1, light(14))
}

// ================================================================== floors

function floors(p: Plan): void {
  for (let x = -HX + 1; x <= HX - 1; x++) {
    for (let z = HZN + 1; z <= HZS - 1; z++) {
      let f = FLOOR_WOOD

      if (Math.abs(x) === HX - 1 || z === HZN + 1 || z === HZS - 1) {
        f = DARK_PLANKS
      }

      if (Math.abs(x) <= 1 && z >= HZN + 4) {
        f = Math.abs(x) === 1 ? DARK_PLANKS : TILE
      }

      p.set(x, FLOOR, z, f)
    }
  }

  for (let x = -3; x <= 3; x++) {
    p.set(x, FLOOR, HZS, Math.abs(x) <= 1 ? TILE : DARK_PLANKS)
  }

  for (let dx = -8; dx <= 8; dx++) {
    for (let dz = -8; dz <= 8; dz++) {
      if (!octIn(dx, dz)) {continue}
      const r = octR(dx, dz)
      let f: number

      if (r <= 1) {
        f = DARK_PLANKS
      } else if (r === 2) {
        f = TILE
      } else if (r === 3) {
        f = DARK_PLANKS
      } else if (r === 8) {
        f = DARK_PLANKS
      } else if (r === 7) {
        f = TILE
      } else {
        f = FLOOR_WOOD
      }

      p.set(AX + dx, FLOOR, AZ + dz, f)
    }
  }
}

// ================================================================== stations

function desks(p: Plan, cast: string[]): void {
  const ids = deskIds(cast)
  const desk = slab(B.DARK_OAK_SLAB, true)
  const zd = HZN + 1

  for (let i = 0; i < DESK_X.length; i++) {
    const bx = DESK_X[i]
    const id = ids[i]

    for (let x = bx - 1; x <= bx + 1; x++) {
      p.set(x, FEET, zd, desk)

      for (let y = FEET + 1; y <= FEET + 2; y++) {
        p.set(x, y, zd, facing(B.MONITOR, Dir.S))
        p.bind(x, y, zd, id)
      }
    }

    p.set(bx, FEET + 3, HZN, lamp(B.STATUS_LAMP, Lamp.IDLE))
    p.bind(bx, FEET + 3, HZN, `agent:${id}`)
    p.set(bx - 1, FEET + 3, HZN, PLASTER_FRAME)
    p.set(bx + 1, FEET + 3, HZN, PLASTER_FRAME)
    const cx = bx + CHAIR_DX
    p.set(cx, FEET, zd + 1, stairs(B.DARK_OAK_STAIRS, Dir.S, false))
    p.anchor(`desk_${id}`, cx + 0.5, FEET, zd + 1.5, 180, 0)
    p.anchor(`seat_${id}`, cx + 0.5, FEET, zd + 1.5, 180, 0)
    p.anchor(`monitor_${id}`, bx + 0.5, FEET + 2.0, zd + 0.25 + 0.002, 0, 0)
    p.cameraLookAt(`desk_${id}`, bx + 2.0, FEET + 2.2, zd + 3.8, bx + 0.2, FEET + 1.8, zd + 0.25)
  }

  for (const x of [-17, -13, -9, -5, 5, 9, 13, 17]) {
    const ax = Math.abs(x)

    if (ax === 5) {
      p.set(x, FEET, zd, bs(B.POTTED_FLOWERING_AZALEA))

      continue
    }

    p.set(x, FEET, zd, facing(B.CHISELED_BOOKSHELF, Dir.S))

    if (ax !== 9) {
      p.set(x, FEET + 1, zd, ax === 17 ? bs(B.POTTED_FERN) : LANTERN)
    }
  }

  for (let x = -3; x <= 3; x++) {
    p.set(x, FEET, HZN + 1, stairs(B.DARK_OAK_STAIRS, Dir.N, false))
  }

  p.set(-4, FEET, HZN + 1, bs(B.MOSS))
  p.set(4, FEET, HZN + 1, bs(B.MOSS))
  p.set(-4, FEET + 1, HZN + 1, bs(B.FLOWERING_AZALEA_PLANT))
  p.set(4, FEET + 1, HZN + 1, bs(B.AZALEA_PLANT))
}

function library(p: Plan): void {
  const xw = -HX + 1
  const archive = facing(B.MEMORY_ARCHIVE, Dir.E)

  for (let z = HZN + 1; z <= HZS - 1; z++) {
    const pil = z === -6 || z === RIDGE_Z || z === 2

    for (let y = FEET; y <= FEET + 2; y++) {
      if (pil) {
        p.set(xw, y, z, post())
      } else if (y === FEET + 1 && (z === -4 || z === 0 || z === 4)) {
        p.set(xw, y, z, facing(B.MEMORY_CATALOG, Dir.E))
      } else {
        p.set(xw, y, z, archive)
        p.bind(xw, y, z, 'shared')
      }
    }

    p.set(xw, FEET + 3, z, pil ? post() : stairs(B.DARK_OAK_STAIRS, Dir.W, true))
  }

  for (let x = -22; x <= -19; x++) {
    for (let y = FEET; y <= FEET + 2; y++) {
      p.set(x, y, HZN + 1, y === FEET + 1 ? facing(B.CHISELED_BOOKSHELF, Dir.S) : bs(B.BOOKSHELF))
    }
  }

  p.set(-22, FEET + 3, HZN + 1, bs(B.POTTED_FERN))
  p.set(-19, FEET + 3, HZN + 1, LANTERN)

  for (let z = -1; z <= 1; z++) {
    p.set(-18, FEET, z, facing(B.MEMORY_ARCHIVE, Dir.W))
    p.bind(-18, FEET, z, 'shared')
    p.set(-18, FEET + 1, z, z === 0 ? LANTERN : candle(B.CANDLE, 2, true))
  }

  p.set(-18, FEET, -2, facing(B.MEMORY_CATALOG, Dir.W))
  p.set(-18, FEET, 2, facing(B.MEMORY_CATALOG, Dir.W))
  p.set(-18, FEET + 1, -2, bs(B.POTTED_FLOWERING_AZALEA))
  p.set(-19, FEET, -4, facing(B.LECTERN, Dir.W))
  p.set(-20, FEET, 3, facing(B.LECTERN, Dir.E))

  for (let x = -22; x <= -19; x++) {
    for (let z = -5; z <= 4; z++) {
      p.set(x, FLOOR, z, PARQUET)
    }
  }

  p.anchor('slot_library_1', -19.6, FEET, -3.5, -90, 0)
  p.anchor('slot_library_2', -20.4, FEET, 1.5, 90, 0)
  p.anchor('slot_library_3', -18.6, FEET, 3.5, 90, 0)
  p.anchor('slot_library_4', -20.6, FEET, -0.8, 90, 0)
}

function workshop(p: Plan): void {
  const xe = HX - 1
  const bench = slab(B.DARK_OAK_SLAB, true)

  for (let z = -6; z <= -2; z++) {
    p.set(xe, FEET, z, bench)
  }

  for (let i = 0; i < 3; i++) {
    const z = -5 + i
    p.set(HX, FEET + 2, z, lamp(B.STATUS_LAMP, Lamp.IDLE))
    p.bind(HX, FEET + 2, z, `ci:#${i + 1}`)
  }

  p.set(xe, FEET + 1, -6, bs(B.BREWING_STAND))
  p.set(xe, FEET + 1, -2, LANTERN)
  p.set(xe, FEET + 1, -4, facing(B.CONSOLE_TERMINAL, Dir.W))
  p.anchor('slot_testbench_1', 21.6, FEET, -4.6, -90, 0)
  p.anchor('slot_testbench_2', 21.6, FEET, -2.6, -90, 0)
  p.anchor('slot_testbench_3', 19.8, FEET, -3.6, -90, 0)

  for (let x = 19; x <= 21; x += 2) {
    p.set(x, FEET, HZN + 1, facing(B.CONSOLE_TERMINAL, Dir.S))
  }

  p.set(20, FEET, HZN + 1, bench)
  p.set(22, FEET, HZN + 1, bench)
  p.set(22, FEET + 1, HZN + 1, bs(B.POTTED_FERN))
  p.set(20, FEET + 1, HZN + 1, candle(B.CANDLE, 3, true))
  p.set(23, FEET, HZN + 1, bs(B.BARREL))
  p.anchor('slot_terminal_1', 19.5, FEET, -7.6, 180, 0)
  p.anchor('slot_terminal_2', 21.5, FEET, -7.6, 180, 0)

  for (let z = -1; z <= 1; z++) {
    p.set(xe, FEET, z, facing(B.MERGE_STATION, Dir.W))

    for (let y = FEET; y <= WALL_TOP; y++) {
      p.set(HX, y, z, y === FEET ? WALNUT_TRIM : WALNUT)
    }
  }

  p.set(HX, FEET + 3, 0, lamp(B.STATUS_LAMP, Lamp.OFF))
  p.bind(HX, FEET + 3, 0, 'merge')
  p.set(HX, FEET + 3, -1, bulbOff())
  p.set(HX, FEET + 3, 1, bulbOff())
  p.set(xe, WALL_TOP, -1, slab(B.DARK_OAK_SLAB, true))
  p.set(xe, WALL_TOP, 0, slab(B.DARK_OAK_SLAB, true))
  p.set(xe, WALL_TOP, 1, slab(B.DARK_OAK_SLAB, true))
  p.set(xe, FEET + 1, 1, bs(B.POTTED_FLOWERING_AZALEA))
  p.anchor('slot_mergestation_1', 21.5, FEET, -0.5, -90, 0)
  p.anchor('slot_mergestation_2', 21.5, FEET, 1.4, -90, 0)
  p.set(xe, FEET, 4, bs(B.BARREL))
  p.set(xe, FEET + 1, 4, bs(B.POTTED_FERN))
  floorLamp(p, xe, 3)
}

function floorLamp(p: Plan, x: number, z: number): void {
  p.set(x, FEET, z, bs(B.SPRUCE_FENCE))
  p.set(x, FEET + 1, z, LANTERN)
}

function lounge(p: Plan): void {
  for (let x = -14; x <= -7; x++) {
    for (let z = -3; z <= 3; z++) {
      const border = x === -14 || x === -7 || z === -3 || z === 3
      p.set(x, FEET, z, bs(border ? B.CARPET_BROWN : B.CARPET_WHITE))
    }
  }

  for (let x = -12; x <= -9; x++) {
    for (let y = FEET; y <= WALL_TOP; y++) {
      const jamb = x === -12 || x === -9

      if (y <= FEET + 1 && !jamb) {
        p.set(x, y, HZS - 1, y === FEET ? bs(B.CAMPFIRE) : AIR)
      } else {
        p.set(x, y, HZS - 1, bs(B.MUD_BRICKS))
      }
    }

    p.set(x, FEET + 2, HZS - 2, slab(B.MUD_BRICK_SLAB, true))
  }

  p.set(-12, FEET + 3, HZS - 2, candle(B.CANDLE, 3, true))
  p.set(-9, FEET + 3, HZS - 2, bs(B.POTTED_FERN))

  const chairs: Array<[number, number, number]> = [
    [-12, -2, 0],
    [-9, -2, 0],
    [-13, 0, -90],
    [-8, 0, 90],
    [-13, 2, -90],
    [-8, 2, 90],
  ]

  chairs.forEach((c, i) => {
    const back = c[2] === 0 ? Dir.N : c[2] === -90 ? Dir.W : Dir.E
    p.set(c[0], FEET, c[1], stairs(SOFA, back, false))
    p.anchor(`slot_lounge_${i + 1}`, c[0] + 0.5, FEET, c[1] + 0.5, c[2], 0)
  })

  for (let x = -11; x <= -10; x++) {
    for (let z = 0; z <= 1; z++) {
      p.set(x, FEET, z, slab(B.DARK_OAK_SLAB, false))
    }
  }

  p.set(-11, FEET + 1, 0, candle(B.CANDLE, 3, true))
  p.set(-10, FEET + 1, 1, bs(B.POTTED_FLOWERING_AZALEA))
  floorLamp(p, -14, -3)
  floorLamp(p, -7, 3)
  p.set(-14, FEET, 3, bs(B.POTTED_FERN))
}

function meeting(p: Plan): void {
  for (let x = 6; x <= 15; x++) {
    for (let z = -2; z <= 2; z++) {
      const border = x === 6 || x === 15 || z === -2 || z === 2
      p.set(x, FEET, z, bs(border ? B.CARPET_BROWN : B.CARPET_LIGHT_GRAY))
    }
  }

  const top = slab(B.DARK_OAK_SLAB, true)

  for (let x = 8; x <= 13; x++) {
    p.set(x, FEET, 0, top)
  }

  p.set(10, FEET + 1, 0, LANTERN)
  p.set(12, FEET + 1, 0, candle(B.CANDLE, 2, true))
  p.set(8, FEET + 1, 0, bs(B.POTTED_FERN))
  let n = 1

  for (const x of [8, 10, 12]) {
    p.set(x, FEET, -1, stairs(B.BIRCH_STAIRS, Dir.N, false))
    p.anchor(`slot_meeting_${n++}`, x + 0.5, FEET, -0.5, 0, 0)
  }

  for (const x of [9, 11, 13]) {
    p.set(x, FEET, 1, stairs(B.BIRCH_STAIRS, Dir.S, false))
    p.anchor(`slot_meeting_${n++}`, x + 0.5, FEET, 1.5, 180, 0)
  }
}

function atrium(p: Plan): void {
  p.set(AX, FEET, AZ, lamp(B.STATUS_LAMP, Lamp.IDLE))
  p.bind(AX, FEET, AZ, 'goal:atrium')

  for (let sx = -1; sx <= 1; sx++) {
    for (let sz = -1; sz <= 1; sz++) {
      if (sx !== 0 || sz !== 0) {
        p.set(AX + sx, FEET, AZ + sz, slab(COPPER_SLAB, false))
      }
    }
  }

  p.anchor('goal_atrium', AX + 0.5, FEET, AZ + 0.5, 180, 0)

  const xb = AX - 8
  const board = facing(B.TASK_BOARD, Dir.E)

  for (let z = AZ - 3; z <= AZ + 3; z++) {
    for (let y = FEET + 1; y <= FEET + 4; y++) {
      p.set(xb, y, z, board)
    }

    p.set(xb, FEET, z, WALNUT_TRIM)
    p.set(xb, FEET + 5, z, WALNUT)
    p.set(xb + 1, FEET + 5, z, slab(B.DARK_OAK_SLAB, true))
  }

  for (let y = FEET; y <= FEET + 5; y++) {
    p.set(xb, y, AZ - 4, post())
    p.set(xb, y, AZ + 4, post())
  }

  p.anchor('task_wall', xb + 1 - 0.875 + 0.002, FEET + 3.0, AZ + 0.5, -90, 0)

  for (let z = AZ - 3; z <= AZ + 3; z++) {
    p.setIfAir(xb + 1, FEET + 4, z, light(15))

    if ((z - AZ) % 2 === 0) {
      p.setIfAir(xb + 1, FEET + 2, z, light(14))
    }
  }

  for (let z = AZ - 3; z <= AZ + 3; z++) {
    p.set(xb + 1, FEET + 5, z, slab(B.PALE_OAK_SLAB, true))
    p.set(xb, FEET + 5, z, PLASTER_FRAME)
  }

  const xp = AX + 6
  p.set(xp, FEET, AZ, facing(B.DECISION_PODIUM, Dir.W))
  p.anchor('decision_podium', xp + 0.5, FEET + 0.95, AZ + 0.5, 90, 0)
  const xa = AX + 8

  for (let z = AZ - 2; z <= AZ + 2; z++) {
    for (let y = FEET; y <= FEET + 5; y++) {
      const side = Math.abs(z - AZ) === 2
      p.set(xa, y, z, side ? COPPER : y === FEET ? WALNUT_TRIM : WALNUT)
    }

    p.set(xa, FEET + 6, z, beam(Axis.Z))
  }

  p.setIfAir(xa - 1, FEET + 4, AZ, light(14))
  p.setIfAir(xa - 2, FEET + 1, AZ - 1, light(13))
  p.setIfAir(xa - 2, FEET + 1, AZ + 1, light(13))
  p.set(xa, FEET + 3, AZ, lamp(B.STATUS_LAMP, Lamp.OFF))
  p.bind(xa, FEET + 3, AZ, 'decisions')

  for (let z = AZ - 1; z <= AZ + 1; z++) {
    p.set(xa, FEET + 5, z, bulbOff())
  }

  p.set(xa - 1, FEET + 3, AZ - 1, bell(B.BELL, Dir.W))
  p.set(xa - 1, FEET + 2, AZ + 1, slab(B.DARK_OAK_SLAB, true))
  p.set(xa - 1, FEET + 3, AZ + 1, LANTERN)
  p.set(xp + 1, FEET, AZ + 3, facing(B.CONSOLE_TERMINAL, Dir.W))
  const ux = xp - 0.5
  const uz = AZ + 0.5
  p.anchor('podium_user', ux, FEET, uz, -90, 0)

  const userSlots: Array<[number, number]> = [
    [xp - 1.2, AZ - 1.6],
    [xp - 1.2, AZ + 2.6],
    [xp - 2.9, AZ - 0.9],
  ]

  userSlots.forEach(([sx, sz], i) => {
    const yaw = (Math.atan2(-(ux - sx), uz - sz) * 180) / Math.PI
    p.anchor(`slot_user_${i + 1}`, sx, FEET, sz, yaw, 0)
  })

  for (const sx of [-1, 1]) {
    p.set(AX + sx * 5, FEET, AZ - 6, stairs(B.DARK_OAK_STAIRS, sx < 0 ? Dir.W : Dir.E, false))
    p.set(AX + sx * 6, FEET, AZ - 5, stairs(B.DARK_OAK_STAIRS, sx < 0 ? Dir.W : Dir.E, false))
    p.set(AX + sx * 4, FEET, AZ - 7, bs(B.POTTED_FERN))
    p.set(AX + sx * 6, FEET, AZ + 5, bs(B.MOSS))
    p.set(AX + sx * 5, FEET, AZ + 6, bs(B.MOSS))
    p.set(AX + sx * 6, FEET + 1, AZ + 5, bs(B.FLOWERING_AZALEA_PLANT))
    p.set(AX + sx * 5, FEET + 1, AZ + 6, bs(B.AZALEA_PLANT))
  }

  for (let dx = -8; dx <= 8; dx++) {
    for (let dz = -8; dz <= 8; dz++) {
      if (!octIn(dx, dz) || octR(dx, dz) !== 8) {continue}
      p.set(AX + dx, ATRIUM_TOP, AZ + dz, slab(B.DARK_OAK_SLAB, true))

      if ((dx + dz) % 3 === 0) {
        p.setIfAir(AX + dx, ATRIUM_TOP + 1, AZ + dz, light(12))
      }
    }
  }

  chandelier(p)

  for (let dx = -5; dx <= 5; dx += 5) {
    for (let dz = -5; dz <= 5; dz += 5) {
      if (dx !== 0 || dz !== 0) {
        p.setIfAir(AX + dx, SPRING + 3, AZ + dz, light(13))
      }
    }
  }

  p.setIfAir(AX + 2, SPRING + 5, AZ + 2, light(12))
  p.setIfAir(AX - 2, SPRING + 5, AZ - 2, light(12))

  for (let dx = -8; dx <= 8; dx += 4) {
    for (let dz = -8; dz <= 8; dz += 4) {
      if (octIn(dx, dz) && (dx !== 0 || dz !== 0)) {
        p.setIfAir(AX + dx, FEET + 1, AZ + dz, light(12))
        p.setIfAir(AX + dx, FEET + 6, AZ + dz, light(10))
      }
    }
  }

  floorLamp(p, AX - 3, AZ + 7)
  floorLamp(p, AX + 3, AZ + 7)
}

function chandelier(p: Plan): void {
  const ry = ATRIUM_TOP - 1
  const top = lanternBase() + 3

  for (let y = ry; y <= top; y++) {
    p.set(AX, y, AZ, chain(COPPER_CHAIN, Axis.Y))
  }

  for (let d = -2; d <= 2; d++) {
    p.set(AX + d, ry, AZ - 2, chain(COPPER_CHAIN, Axis.X))
    p.set(AX + d, ry, AZ + 2, chain(COPPER_CHAIN, Axis.X))
    p.set(AX - 2, ry, AZ + d, chain(COPPER_CHAIN, Axis.Z))
    p.set(AX + 2, ry, AZ + d, chain(COPPER_CHAIN, Axis.Z))
  }

  for (const d of [-1, 1]) {
    p.set(AX + d, ry, AZ, chain(COPPER_CHAIN, Axis.X))
    p.set(AX, ry, AZ + d, chain(COPPER_CHAIN, Axis.Z))
  }

  for (let dx = -2; dx <= 2; dx += 2) {
    for (let dz = -2; dz <= 2; dz += 2) {
      if (dx !== 0 || dz !== 0) {
        p.set(AX + dx, ry - 1, AZ + dz, LANTERN_HANGING)
      }
    }
  }
}

function hallLighting(p: Plan): void {
  for (let x = -21; x <= 21; x++) {
    if (!isPostX(x)) {continue}

    for (const z of [-5, 1]) {
      if (Math.abs(x) === 5 && z === 1) {continue}
      p.set(x, FRIEZE - 1, z, chain(B.IRON_CHAIN, Axis.Y))
      p.set(x, FRIEZE - 2, z, LANTERN_HANGING)
    }
  }

  for (let x = -21; x <= 21; x++) {
    if (isPostX(x)) {
      p.setIfAir(x, FRIEZE + 1, -7, light(12))
      p.setIfAir(x, FRIEZE + 1, 3, light(12))
    } else if (mod(x, 4) === 1) {
      p.setIfAir(x, roofY(RIDGE_Z) - 2, RIDGE_Z, light(10))
    }
  }

  for (let x = -HX + 1; x <= HX - 1; x += 2) {
    p.setIfAir(x, FRIEZE, HZN + 1, light(12))

    if (!octFoot(x - AX, HZS - AZ) && !fireplaceX(x)) {
      p.setIfAir(x, FRIEZE, HZS - 1, light(12))
    }
  }

  for (const x of [-19, -11, -7, -3, 3, 7, 11, 19]) {
    p.set(x, roofY(RIDGE_Z) - 1, RIDGE_Z, GLOW_PANEL)
  }

  for (let x = -22; x <= 22; x += 4) {
    for (const z of [-7, -3, 1, 4]) {
      p.setIfAir(x, FEET + 1, z, light(z === 4 ? 11 : 12))
    }
  }
}

// ================================================================== cameras

function cameras(p: Plan): void {
  const az = AZ
  p.cameraLookAt('exterior_hero', 18, 72.5, 46, -3, 75.5, 10)
  p.cameraLookAt('night', 16.5, 71.5, 45.5, -2, 75.5, 11)
  p.cameraLookAt('entrance_atrium', AX - 1.5, FEET + 2.2, az + 6.8, AX + 2.0, FEET + 3.8, az - 2)
  p.cameraLookAt('task_wall', AX - 4.6, FEET + 3.0, az + 0.5, AX - 7.9, FEET + 3.0, az + 0.5)
  p.cameraLookAt('decision_podium', AX + 3.0, FEET + 1.5, az + 2.3, AX + 6.8, FEET + 1.9, az - 0.8)
  p.cameraLookAt('wide_interior', -5.0, FEET + 1.7, -4.6, -18.0, FEET + 1.0, -2.8)
  p.cameraLookAt('library', -14.0, FEET + 2.8, 4.0, -21.5, FEET + 1.2, -1.5)
  p.cameraLookAt('console', AX + 2.5, FEET + 2.2, az + 6.5, AX + 7.5, FEET + 1.0, az + 2.5)
  p.cameraLookAt('merge_station', 19.5, FEET + 1.6, 2.6, 24.0, FEET + 1.8, -0.2)
  p.cameraLookAt('testbench', 16.0, FEET + 2.6, -0.5, 23, FEET + 1.0, -4.5)
  p.cameraLookAt('hall', -5.0, FEET + 1.7, -4.6, 18.0, FEET + 1.5, -2.0)
}

// ================================================================== landscape

export function hash(x: number, z: number, salt: number): number {
  let h = (BigInt(x) * 73856093n) ^ (BigInt(z) * 19349663n) ^ (BigInt(salt) * 83492791n)
  h = BigInt.asIntN(64, h)
  h ^= h >> 13n
  h = BigInt.asIntN(64, h * 0x5bd1e995n)
  h ^= h >> 15n
  h = BigInt.asIntN(64, h * 0x27d4eb2dn)
  h ^= h >> 16n

  return Number(BigInt.asIntN(32, h) & 0x7fffffffn)
}

export function rnd(x: number, z: number, salt: number): number {
  return hash(x, z, salt) / 0x7fffffff
}

const FLAT = [
  [-29, -16, 29, 12],
  [-20, 6, 20, 33],
  [-37, 9, -10, 34],
  [4, 29, 22, 45],
  [-6, 25, 6, 49],
]

export const GATE_Z = 48

export function smooth(e0: number, e1: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)))

  return t * t * (3 - 2 * t)
}

export function flatDistance(x: number, z: number): number {
  let best = Number.MAX_VALUE

  for (const r of FLAT) {
    const dx = Math.max(0, Math.max(r[0] - x, x - r[2]))
    const dz = Math.max(0, Math.max(r[1] - z, z - r[3]))
    best = Math.min(best, Math.sqrt(dx * dx + dz * dz))
  }

  return best
}

export function edge(x: number, z: number): number {
  return Math.min(Math.min(x - SITE[0], SITE[3] - x), Math.min(z - SITE[2], SITE[5] - z))
}

export function terrainHeight(x: number, z: number): number {
  const e = edge(x, z)
  const crest = 5.2 + 1.8 * Math.sin(x * 0.15 + z * 0.07) + 1.4 * Math.cos(z * 0.19 - x * 0.11) + 0.8 * Math.sin((x + z) * 0.31)
  const berm = e >= 7 ? crest * smooth(19, 7, e) : crest * smooth(-1, 7, e)

  return Math.round(berm * smooth(0, 7, flatDistance(x, z)))
}

export function ground(p: Plan): void {
  const nx = p.maxX - p.minX + 1
  const nz = p.maxZ - p.minZ + 1
  const hs = new Int16Array(nx * nz)

  for (let x = p.minX; x <= p.maxX; x++) {
    for (let z = p.minZ; z <= p.maxZ; z++) {
      hs[(x - p.minX) * nz + (z - p.minZ)] = terrainHeight(x, z)
    }
  }

  for (let pass = 0; pass < 12; pass++) {
    let changed = false

    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const h = hs[i * nz + k]
        let lo = h

        if (i > 0) {lo = Math.min(lo, hs[(i - 1) * nz + k])}

        if (i < nx - 1) {lo = Math.min(lo, hs[(i + 1) * nz + k])}

        if (k > 0) {lo = Math.min(lo, hs[i * nz + k - 1])}

        if (k < nz - 1) {lo = Math.min(lo, hs[i * nz + k + 1])}

        if (h > lo + 1) {
          hs[i * nz + k] = lo + 1
          changed = true
        }
      }
    }

    if (!changed) {break}
  }

  for (let x = p.minX; x <= p.maxX; x++) {
    for (let z = p.minZ; z <= p.maxZ; z++) {
      const h = hs[(x - p.minX) * nz + (z - p.minZ)]

      if (h <= 0) {continue}

      for (let y = GROUND; y < GROUND + h; y++) {
        p.set(x, y, z, bs(B.DIRT))
      }

      p.set(x, GROUND + h, z, bs(B.GRASS))
      p.setTop(x, z, GROUND + h)
    }
  }
}

function exterior(p: Plan): void {
  terraces(p)
  portico(p)
  paths(p)
  gate(p)
  pond(p)
  garden(p)
  trees(p)
  foundationPlanting(p)
  outdoorLight(p)
  meadow(p)
}

function outdoorLight(p: Plan): void {
  for (let x = -22; x <= 22; x += 3) {
    if (Math.abs(x) < 10) {continue}
    p.setIfAir(x, FEET + 3, HZS + 1, light(14))

    if (mod(x, 6) === 2) {
      p.setIfAir(x, FEET, HZS + 3, light(11))
    }
  }

  for (let dx = -10; dx <= 10; dx++) {
    for (let dz = -10; dz <= 10; dz++) {
      if (octFoot(dx, dz) || !octInside(dx, dz, 10) || dz < -6) {continue}

      if (mod(dx * 3 + dz * 5, 7) !== 0) {continue}
      p.setIfAir(AX + dx, FEET + 3, AZ + dz, light(13))
      p.setIfAir(AX + dx, SPRING + 1, AZ + dz, light(13))
    }
  }

  const z0 = AZ + 10

  for (const sx of [-3, 3]) {
    p.setIfAir(sx, FEET + 3, z0 + 1, LANTERN_HANGING)
  }

  p.setIfAir(AX, FEET + 1, z0 + 2, light(14))
  p.setIfAir(AX, FEET, AZ + 15, light(12))

  for (const c of [
    [7, 34],
    [19, 34],
    [7, 40],
    [19, 40],
    [10, 32],
    [16, 42],
  ]) {
    p.setIfAir(c[0], FLOOR + 1, c[1], light(10))
  }

  const top = roofY(3) + 3

  for (let x = 20; x <= 21; x++) {
    for (let z = 3; z <= 4; z++) {
      for (let y = roofY(z); y <= top; y++) {
        p.set(x, y, z, bs(B.MUD_BRICKS))
      }

      p.set(x, top + 1, z, slab(B.MUD_BRICK_SLAB, false))
    }
  }

  p.set(20, top + 1, 3, bs(B.CAMPFIRE))
}

function meadowAt(p: Plan, x: number, z: number): boolean {
  const t = p.top(x, z)

  return p.get(x, t, z) === bs(B.GRASS) && p.isAir(x, t + 1, z)
}

function terraces(p: Plan): void {
  const deck = bs(B.SPRUCE_PLANKS)

  for (const side of [-1, 1]) {
    const xa = side < 0 ? -HX : 10
    const xb = side < 0 ? -10 : HX

    for (let x = xa; x <= xb; x++) {
      for (let z = HZS + 1; z <= HZS + 4; z++) {
        const isEdge = z === HZS + 4 || x === xa || x === xb
        p.set(x, GROUND, z, bs(B.DIRT))
        p.set(x, FLOOR, z, isEdge ? PLINTH : deck)
      }
    }

    const mid = side < 0 ? -17 : 17

    for (let x = xa + 1; x <= xb - 1; x++) {
      const z = HZS + 4

      if (Math.abs(x - mid) <= 1) {
        p.set(x, FLOOR, z, slab(B.MUD_BRICK_SLAB, false))
        p.set(x, FLOOR, z + 1, slab(B.SPRUCE_SLAB, false))

        continue
      }

      if ((x - xa) % 4 === 2) {
        p.set(x, FEET, z, bs(B.MOSS))
        p.set(x, FEET + 1, z, (hash(x, z, 5) & 1) === 0 ? bs(B.FLOWERING_AZALEA_PLANT) : bs(B.AZALEA_PLANT))
      } else if ((x - xa) % 4 === 0 && x !== xa + 0) {
        p.set(x, FEET, z, bs(B.SPRUCE_FENCE))
        p.set(x, FEET + 1, z, LANTERN)
      }
    }

    for (let x = xa + 1; x <= xb - 1; x++) {
      if (isPostX(x) || Math.abs(x) < 10) {continue}

      if (hash(x, 3, 9) % 3 === 0) {
        p.set(x, FEET, HZS + 1, trapdoor(B.SPRUCE_TRAPDOOR, Dir.S, true, false))
      }
    }

    for (let bx = mid - 5; bx <= mid + 5; bx += 10) {
      p.set(bx, FEET, HZS + 2, stairs(B.SPRUCE_STAIRS, Dir.N, false))
      p.set(bx + 1, FEET, HZS + 2, stairs(B.SPRUCE_STAIRS, Dir.N, false))
    }
  }
}

function portico(p: Plan): void {
  const z0 = AZ + 10
  const z1 = AZ + 13

  for (let x = -4; x <= 4; x++) {
    for (let z = z0; z <= z1; z++) {
      p.set(x, GROUND, z, bs(B.DIRT))
      p.set(x, FLOOR, z, Math.abs(x) === 4 || z === z1 ? PLINTH : DARK_PLANKS)
    }

    if (Math.abs(x) <= 2) {
      p.set(x, FLOOR, z1 + 1, slab(B.MUD_BRICK_SLAB, false))
    }
  }

  for (let x = -2; x <= 2; x++) {
    p.set(x, FLOOR, z1, slab(B.MUD_BRICK_SLAB, true))
  }

  const beamY = FEET + 4

  for (const sx of [-3, 3]) {
    p.fill(sx, FEET, z1, sx, beamY - 1, z1, post())
    p.fill(sx, beamY, z0, sx, beamY, z1, beam(Axis.Z))
    p.set(sx, beamY - 1, z0, stairs(B.DARK_OAK_STAIRS, Dir.S, true))
  }

  p.fill(-3, beamY, z1, 3, beamY, z1, beam(Axis.X))
  const rs = COPPER_STAIRS

  for (let z = z0; z <= z1 + 1; z++) {
    for (let k = 0; k <= 4; k++) {
      const y = beamY + 1 + (4 - k)

      if (k === 0) {
        p.set(AX, y, z, COPPER)
        p.set(AX, y + 1, z, slab(COPPER_SLAB, false))
      } else {
        p.set(AX - k, y, z, stairs(rs, Dir.E, false))
        p.set(AX + k, y, z, stairs(rs, Dir.W, false))
      }
    }

    p.set(AX - 5, beamY, z, slab(COPPER_SLAB, true))
    p.set(AX + 5, beamY, z, slab(COPPER_SLAB, true))
  }

  for (let k = -3; k <= 3; k++) {
    const topY = beamY + (4 - Math.abs(k))

    for (let y = beamY + 1; y <= topY; y++) {
      p.set(AX + k, y, z1, PLASTER)
    }
  }

  p.set(AX, beamY + 2, z1, GLASS_PANE)
  p.set(AX, beamY + 3, z1, DARK_PLANKS)
  p.set(AX - 1, beamY + 2, z1, DARK_PLANKS)
  p.set(AX + 1, beamY + 2, z1, DARK_PLANKS)
  p.set(AX, beamY + 3, z0 + 1, chain(B.IRON_CHAIN, Axis.Y))
  p.set(AX, beamY + 2, z0 + 1, chain(B.IRON_CHAIN, Axis.Y))
  p.set(AX, beamY + 1, z0 + 1, LANTERN_HANGING)
  p.set(-2, FEET, z0, bs(B.POTTED_FLOWERING_AZALEA))
  p.set(2, FEET, z0, bs(B.POTTED_FLOWERING_AZALEA))
}

function path(p: Plan, x: number, z: number): void {
  const t = p.top(x, z)

  if (p.get(x, t, z) === bs(B.GRASS) && p.isAir(x, t + 1, z)) {
    p.set(x, t, z, bs(B.DIRT_PATH))
  }
}

function lanternPost(p: Plan, x: number, z: number): void {
  if (!meadowAt(p, x, z)) {return}
  const t = p.top(x, z)
  p.set(x, t + 1, z, bs(B.SPRUCE_FENCE))
  p.set(x, t + 2, z, bs(B.SPRUCE_FENCE))
  p.set(x, t + 3, z, LANTERN)
}

export function pathX(z: number): number {
  const z1 = AZ + 15

  return Math.round(Math.sin((z - z1) / 9.0) * 2.0)
}

function paths(p: Plan): void {
  const z1 = AZ + 15

  for (let z = z1; z <= GATE_Z + 1; z++) {
    const cx = pathX(z)

    for (let x = cx - 1; x <= cx + 1; x++) {
      path(p, x, z)
    }

    if ((z - z1) % 7 === 3 && z < GATE_Z - 2) {
      lanternPost(p, cx + (Math.floor((z - z1) / 7) % 2 === 0 ? 3 : -3), z)
    }
  }

  for (const side of [-1, 1]) {
    const mid = side * 17

    for (let z = HZS + 6; z <= AZ + 15; z++) {
      const t = (z - HZS - 6) / (AZ + 15 - HZS - 6)
      const x = mid - side * Math.round(13 * (1 - Math.cos((t * Math.PI) / 2)))
      path(p, x, z)
      path(p, x - side, z)
    }
  }

  for (let x = -HX - 3; x <= HX + 3; x++) {
    path(p, x, HZN - 4)
  }

  for (let z = HZN - 4; z <= HZS + 6; z++) {
    path(p, -HX - 3, z)
    path(p, HX + 3, z)
  }
}

function gate(p: Plan): void {
  const cx = pathX(GATE_Z)
  const t = p.top(cx, GATE_Z)
  const y0 = t + 1

  for (const sx of [-2, 2]) {
    p.fill(cx + sx, y0, GATE_Z, cx + sx, y0 + 3, GATE_Z, post())
    p.set(cx + sx, t, GATE_Z, PLINTH)
  }

  p.fill(cx - 3, y0 + 4, GATE_Z, cx + 3, y0 + 4, GATE_Z, beam(Axis.X))

  for (let x = cx - 3; x <= cx + 3; x++) {
    p.set(x, y0 + 4, GATE_Z - 1, stairs(ROOF_STAIRS, Dir.S, false))
    p.set(x, y0 + 4, GATE_Z + 1, stairs(ROOF_STAIRS, Dir.N, false))
    p.set(x, y0 + 5, GATE_Z, slab(ROOF_SLAB, false))
  }

  p.set(cx, y0 + 3, GATE_Z, LANTERN_HANGING)
  p.set(cx - 3, y0, GATE_Z + 1, bs(B.FIREFLY_BUSH))
  p.set(cx + 3, y0, GATE_Z - 1, bs(B.FLOWERING_AZALEA_PLANT))
}

function pond(p: Plan): void {
  const cx = -24
  const cz = 21

  for (let x = -36; x <= -12; x++) {
    for (let z = 12; z <= 32; z++) {
      const dx = (x - cx) / 8.5
      const dz = (z - cz) / 6.0
      const wob = 0.12 * Math.sin(x * 0.9 + z * 0.4) + 0.1 * Math.cos(z * 1.3 - x * 0.2)
      const d = Math.sqrt(dx * dx + dz * dz) + wob

      if (d > 1.18 || p.get(x, GROUND, z) === bs(B.DIRT_PATH)) {continue}

      if (d > 1.0) {
        const h = hash(x, z, 31) % 10
        p.set(x, GROUND, z, h < 3 ? bs(B.MOSS) : h < 5 ? bs(B.MUD) : bs(B.GRASS))

        if (h === 9) {
          p.set(x, FLOOR, z, bs(B.MOSSY_COBBLE))
        }

        continue
      }

      const depth = d < 0.55 ? 3 : d < 0.85 ? 2 : 1
      p.set(x, GROUND - depth, z, (hash(x, z, 33) & 3) === 0 ? bs(B.GRAVEL) : bs(B.SAND))

      for (let y = GROUND - depth + 1; y <= GROUND; y++) {
        p.set(x, y, z, bs(B.WATER))
      }

      p.set(x, FLOOR, z, bs(B.AIR))
      const h = hash(x, z, 35) % 100

      if (h < 9 && d < 0.95) {
        p.set(x, FLOOR, z, bs(B.LILY_PAD))
      } else if (h < 13 && depth >= 2) {
        p.set(x, GROUND - depth + 1, z, bs(B.SEAGRASS))
      }
    }
  }

  for (let x = -19; x <= -15; x++) {
    for (let z = 20; z <= 21; z++) {
      p.set(x, FLOOR, z, slab(B.SPRUCE_SLAB, false))
    }
  }

  p.set(-19, FLOOR, 19, bs(B.SPRUCE_FENCE))
  p.set(-19, FLOOR + 1, 19, LANTERN)
  p.set(-16, FLOOR, 23, bs(B.FIREFLY_BUSH))
  p.set(-28, FLOOR, 13, bs(B.FIREFLY_BUSH))
  p.set(-34, FLOOR, 23, bs(B.FIREFLY_BUSH))
}

// ------------------------------------------------------------------ trees

interface TreeKind {
  log: number
  leaves: number
  accent: number | null
  trunk: number
  rx: number
  ry: number
}

const KINDS: TreeKind[] = [
  { log: B.BIRCH_LOG, leaves: B.BIRCH_LEAVES, accent: null, trunk: 7, rx: 2.3, ry: 3.4 }, // BIRCH
  { log: B.POPLAR_LOG, leaves: B.YELLOW_POPLAR_LEAVES, accent: B.ORANGE_POPLAR_LEAVES, trunk: 4, rx: 2.3, ry: 5.6 }, // POPLAR
  { log: B.OAK_LOG, leaves: B.AZALEA_LEAVES, accent: B.FLOWERING_AZALEA_LEAVES, trunk: 4, rx: 3.6, ry: 2.3 }, // AZALEA
  { log: B.DARK_OAK_LOG, leaves: B.OAK_LEAVES, accent: null, trunk: 6, rx: 4.2, ry: 2.8 }, // OAK
  { log: B.CHERRY_LOG, leaves: B.CHERRY_LEAVES, accent: null, trunk: 4, rx: 3.4, ry: 2.3 }, // CHERRY
  { log: B.SPRUCE_LOG, leaves: B.SPRUCE_LEAVES, accent: null, trunk: 11, rx: 3.3, ry: 0 }, // SPRUCE
]

function tree(p: Plan, x: number, z: number, k: TreeKind, seed: number): void {
  if (k === KINDS[5]) {
    spruce(p, x, z, seed)

    return
  }

  const trunk = k.trunk + (hash(x, z, seed) % 3)
  const base = p.top(x, z) + 1

  for (let y = base; y < base + trunk; y++) {
    p.set(x, y, z, log(k.log, Axis.Y))
  }

  const top = base + trunk
  const lobes: number[][] = [[0, k.ry * 0.45, 0, k.rx, k.ry]]
  const narrow = k === KINDS[1] || k === KINDS[0]
  const branches = k === KINDS[1] ? 0 : narrow ? 2 : 3 + (hash(x, z, seed + 3) % 2)
  const a0 = rnd(x, z, seed + 4) * Math.PI * 2

  for (let i = 0; i < branches; i++) {
    const ang = a0 + (i * Math.PI * 2) / branches + (rnd(x + i, z, seed + 5) - 0.5) * 0.8
    const reach = narrow ? k.rx * 0.55 : k.rx * (0.75 + rnd(x, z + i, seed + 6) * 0.35)
    const bx = Math.cos(ang) * reach
    const bz = Math.sin(ang) * reach
    const by = -k.ry * (narrow ? 0.9 : 0.35) - rnd(x - i, z, seed + 7) * 1.2
    lobes.push([bx, by, bz, k.rx * (narrow ? 0.7 : 0.62), k.ry * (narrow ? 0.6 : 0.62)])

    if (!narrow) {
      const steps = Math.ceil(reach)

      for (let t = 1; t <= steps; t++) {
        const f = t / steps
        const lx = x + Math.round(bx * f * 0.8)
        const lz = z + Math.round(bz * f * 0.8)
        const ly = Math.round(top + by * 0.5 - 1 + f)
        const ax = Math.abs(bx) > Math.abs(bz) ? Axis.X : Axis.Z

        if (p.isAir(lx, ly, lz)) {
          p.set(lx, ly, lz, log(k.log, ax))
        }
      }
    }
  }

  for (const l of lobes) {
    const cx = x + 0.5 + l[0]
    const cy = top + l[1]
    const cz = z + 0.5 + l[2]
    const r = Math.ceil(l[3]) + 1
    const ry = Math.ceil(l[4]) + 1

    for (let ix = Math.floor(cx) - r; ix <= Math.floor(cx) + r; ix++) {
      for (let iz = Math.floor(cz) - r; iz <= Math.floor(cz) + r; iz++) {
        for (let iy = Math.floor(cy) - ry; iy <= Math.floor(cy) + ry; iy++) {
          if (iy <= base + 1 || iy <= p.top(ix, iz) + 1) {continue}
          const ex = (ix + 0.5 - cx) / l[3]
          const ey = (iy + 0.5 - cy) / l[4]
          const ez = (iz + 0.5 - cz) / l[3]
          const d = ex * ex + ey * ey + ez * ez
          const jitter = (rnd(ix * 7 + iy, iz * 13 - iy, seed) - 0.5) * (k === KINDS[1] ? 0.25 : 0.55)

          if (d + jitter > 1.0 || !p.isAir(ix, iy, iz)) {continue}
          const leaf = k.accent !== null && rnd(ix * 3 + iy, iz + iy * 13, seed + 1) < 0.35 ? k.accent : k.leaves
          p.set(ix, iy, iz, bs(leaf))
        }
      }
    }
  }

  litter(p, x, z, Math.ceil(k.rx), seed)
}

function spruce(p: Plan, x: number, z: number, seed: number): void {
  const base = p.top(x, z) + 1
  const h = 11 + (hash(x, z, seed) % 5)

  for (let y = base; y < base + h - 1; y++) {
    p.set(x, y, z, log(B.SPRUCE_LOG, Axis.Y))
  }

  const crownStart = base + 3
  const maxR = 3.3 + rnd(x, z, seed + 2) * 0.8

  for (let y = crownStart; y <= base + h; y++) {
    const f = (y - crownStart) / (base + h - crownStart)
    let r = maxR * (1 - f) + 0.6

    if (((y - crownStart) & 1) === 1) {
      r *= 0.72
    }

    const ri = Math.ceil(r)

    for (let dx = -ri; dx <= ri; dx++) {
      for (let dz = -ri; dz <= ri; dz++) {
        const d = Math.sqrt(dx * dx + dz * dz) + (rnd(x + dx, z + dz + y, seed) - 0.5) * 0.5

        if (d > r || !p.isAir(x + dx, y, z + dz) || y <= p.top(x + dx, z + dz) + 1) {continue}
        p.set(x + dx, y, z + dz, bs(B.SPRUCE_LEAVES))
      }
    }
  }

  p.set(x, base + h + 1, z, bs(B.SPRUCE_LEAVES))
}

function litter(p: Plan, x: number, z: number, lr: number, seed: number): void {
  for (let dx = -lr; dx <= lr; dx++) {
    for (let dz = -lr; dz <= lr; dz++) {
      if ((dx !== 0 || dz !== 0) && meadowAt(p, x + dx, z + dz) && rnd(x + dx, z + dz, seed + 7) < 0.4) {
        const t = p.top(x + dx, z + dz)
        p.set(x + dx, t + 1, z + dz, flowerBed(B.LEAF_LITTER, MC_2D[hash(dx, dz, seed) & 3], 1 + (hash(x + dx, z + dz, seed) % 4)))
      }
    }
  }
}

const CAMERA_SPOTS = [
  [27, 42],
  [22, 37],
  [18, 46],
  [15, 43],
]

function trees(p: Plan): void {
  const placed: number[][] = []

  const spots: Array<[number, number, number]> = [
    [-30, -18, 1],
    [-18, -21, 0],
    [-5, -23, 3],
    [9, -21, 1],
    [22, -19, 0],
    [35, -15, 2],
    [-39, 0, 2],
    [-41, 14, 0],
    [-35, 32, 1],
    [-25, 41, 4],
    [-12, 45, 0],
    [-31, 8, 0],
    [39, -3, 1],
    [42, 12, 0],
    [37, 25, 3],
    [3, 52, 1],
    [29, -7, 0],
  ]

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i]

    if (meadowAt(p, s[0], s[1])) {
      tree(p, s[0], s[1], KINDS[s[2]], 100 + i)
      placed.push([s[0], s[1]])
    }
  }

  ring(p, placed, 3, 6.5, 0, 300)
  ring(p, placed, 9, 8.5, 3, 400)
}

function ring(p: Plan, placed: number[][], inset: number, step: number, phase: number, seed: number): void {
  const x0 = SITE[0] + inset
  const x1 = SITE[3] - inset
  const z0 = SITE[2] + inset
  const z1 = SITE[5] - inset
  const pts: number[][] = []

  for (let x = x0 + phase; x <= x1; x += step) {
    pts.push([Math.round(x), z0])
    pts.push([Math.round(x), z1])
  }

  for (let z = z0 + step / 2 + phase; z <= z1 - step / 2; z += step) {
    pts.push([x0, Math.round(z)])
    pts.push([x1, Math.round(z)])
  }

  const mix = [KINDS[5], KINDS[3], KINDS[5], KINDS[0], KINDS[3], KINDS[1], KINDS[5], KINDS[3]]
  let n = 0

  for (const q of pts) {
    let jx = q[0] + Math.round((rnd(q[0], q[1], seed) - 0.5) * 3.0)
    let jz = q[1] + Math.round((rnd(q[1], q[0], seed + 1) - 0.5) * 3.0)
    jx = Math.max(SITE[0] + 2, Math.min(SITE[3] - 2, jx))
    jz = Math.max(SITE[2] + 2, Math.min(SITE[5] - 2, jz))

    if (flatDistance(jx, jz) < 2.5 && edge(jx, jz) > 4) {continue}
    let crowded = false

    for (const c of CAMERA_SPOTS) {
      if (Math.hypot(c[0] - jx, c[1] - jz) < 8) {crowded = true}
    }

    for (const o of placed) {
      if (Math.hypot(o[0] - jx, o[1] - jz) < step * 0.7) {
        crowded = true

        break
      }
    }

    if (crowded || !meadowAt(p, jx, jz)) {continue}
    const k = mix[(hash(jx, jz, seed + 2) + n++) % mix.length]
    tree(p, jx, jz, k, seed + n)
    placed.push([jx, jz])
  }
}

// ------------------------------------------------------------------ front garden

function garden(p: Plan): void {
  const x0 = 6
  const x1 = 20
  const z0 = 31
  const z1 = 43
  const cx = 13
  const cz = 37

  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const isEdge = x === x0 || x === x1 || z === z0 || z === z1
      const walk = Math.abs(x - cx) <= 0 || Math.abs(z - cz) <= 0

      if (isEdge) {
        const isGate = Math.abs(z - cz) <= 0 && x === x0

        if (isGate) {
          p.set(x, GROUND, z, bs(B.GRAVEL))
        } else if (meadowAt(p, x, z)) {
          p.set(x, FLOOR, z, bs(B.AZALEA_LEAVES))
        }

        continue
      }

      if (walk) {
        p.set(x, GROUND, z, bs(B.GRAVEL))
        p.set(x, FLOOR, z, AIR)

        continue
      }

      const rim = x === x0 + 1 || x === x1 - 1 || z === z0 + 1 || z === z1 - 1 || Math.abs(x - cx) === 1 || Math.abs(z - cz) === 1
      p.set(x, GROUND, z, bs(B.GRASS))
      const h = hash(x, z, 61) % 9

      if (rim) {
        switch (h % 4) {
          case 0:
            p.set(x, FLOOR, z, bs(B.ALLIUM))

            break

          case 1:
            p.set(x, FLOOR, z, bs(B.AZURE_BLUET))

            break

          case 2:
            p.set(x, FLOOR, z, bs(B.LILY_OF_THE_VALLEY))

            break

          default:
            p.set(x, FLOOR, z, flowerBed(B.PINK_PETALS, MC_2D[h & 3], 4))
        }
      } else {
        const tall = [B.PEONY, B.LILAC, B.ROSE_BUSH][h % 3]
        p.set(x, FLOOR, z, bs(tall))
        p.set(x, FLOOR + 1, z, upper(tall))
      }
    }
  }

  p.set(cx + 1, FLOOR, cz + 1, stairs(B.SPRUCE_STAIRS, Dir.S, false))
  p.set(cx - 1, FLOOR, cz + 1, stairs(B.SPRUCE_STAIRS, Dir.S, false))
  p.set(cx + 1, FLOOR, cz - 1, bs(B.SPRUCE_FENCE))
  p.set(cx + 1, FLOOR + 1, cz - 1, LANTERN)
  p.set(x1 + 1, FLOOR, z0 + 3, bs(B.FIREFLY_BUSH))
  p.set(x1 + 1, FLOOR, z1 - 2, bs(B.FIREFLY_BUSH))
  p.set(x0 + 4, FLOOR, z1 + 1, bs(B.FIREFLY_BUSH))
}

// ------------------------------------------------------------------ planting + meadow

function clamp1(d: number): number {
  return d > 0 ? d - 1 : d < 0 ? d + 1 : 0
}

function near(dx: number, dz: number): boolean {
  return octFoot(clamp1(clamp1(dx)), clamp1(clamp1(dz)))
}

function foundationPlanting(p: Plan): void {
  for (let x = -HX - 1; x <= HX + 1; x++) {
    const z = HZN - 1

    if (meadowAt(p, x, z) && hash(x, z, 41) % 5 !== 0) {
      p.set(x, FLOOR, z, bs(hash(x, z, 42) % 3 === 0 ? B.FLOWERING_AZALEA_LEAVES : B.AZALEA_LEAVES))
    }
  }

  for (let z = HZN - 1; z <= HZS + 5; z++) {
    for (const x of [-HX - 1, HX + 1]) {
      if (meadowAt(p, x, z) && hash(x, z, 43) % 4 !== 0) {
        p.set(x, FLOOR, z, bs(hash(x, z, 44) % 3 === 0 ? B.FLOWERING_AZALEA_LEAVES : B.AZALEA_LEAVES))
      }
    }
  }

  for (let dx = -11; dx <= 11; dx++) {
    for (let dz = -11; dz <= 11; dz++) {
      const x = AX + dx
      const z = AZ + dz

      if (octFoot(dx, dz) || (!octFoot(clamp1(dx), clamp1(dz)) && !near(dx, dz))) {
        continue
      }

      if (meadowAt(p, x, z)) {
        const h = hash(x, z, 47) % 6

        switch (h) {
          case 0:
            p.set(x, FLOOR, z, bs(B.ALLIUM))

            break

          case 1:
            p.set(x, FLOOR, z, bs(B.OXEYE_DAISY))

            break

          case 2:
            p.set(x, FLOOR, z, flowerBed(B.PINK_PETALS, Dir.N, 3))

            break

          case 3:
            p.set(x, FLOOR, z, bs(B.AZURE_BLUET))

            break

          case 4:
            p.set(x, FLOOR, z, bs(B.FERN))

            break

          default:
            p.set(x, FLOOR, z, flowerBed(B.WILDFLOWERS, Dir.E, 4))
        }
      }
    }
  }
}

function meadow(p: Plan): void {
  for (let x = p.minX; x <= p.maxX; x++) {
    for (let z = p.minZ; z <= p.maxZ; z++) {
      if (!meadowAt(p, x, z)) {continue}
      const t = p.top(x, z)
      const r = rnd(x, z, 51)
      const patch = Math.sin(x * 0.21 + Math.cos(z * 0.17) * 2.0) + Math.cos(z * 0.23 - x * 0.07)
      const hill = t > GROUND + 1
      let s = -1

      if (r < 0.26) {
        s = hill && r < 0.08 ? bs(B.FERN) : bs(B.SHORT_GRASS)
      } else if (r < 0.3) {
        if (p.isAir(x, t + 2, z)) {
          p.set(x, t + 2, z, upper(hill ? B.LARGE_FERN : B.TALL_GRASS))
          s = bs(hill ? B.LARGE_FERN : B.TALL_GRASS)
        }
      } else if (r < 0.36 && patch > 0.9) {
        s = flowerBed(B.WILDFLOWERS, MC_2D[hash(x, z, 52) & 3], 1 + (hash(x, z, 53) % 4))
      } else if (r < 0.4 && patch < -1.1 && !hill) {
        s = bs([B.POPPY, B.CORNFLOWER, B.DANDELION, B.OXEYE_DAISY, B.LILY_OF_THE_VALLEY][hash(x, z, 54) % 5])
      } else if (r < (hill ? 0.43 : 0.405)) {
        s = bs(B.BUSH)
      }

      if (s >= 0) {
        p.set(x, t + 1, z, s)
      }
    }
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

// ================================================================== entry

/** Build the complete studio plan (hall + atrium + dome + landscape) for `cast` agent ids. */
export function buildStudioPlan(cast: string[]): Plan {
  const p = new Plan(SITE[0], SITE[1], SITE[2], SITE[3], SITE[4], SITE[5], GROUND, y =>
    y > GROUND ? AIR : y === GROUND ? bs(B.GRASS) : y >= GROUND - 3 ? bs(B.DIRT) : bs(B.STONE),
  )

  ground(p)
  hallShell(p)
  hallRoof(p)
  atriumShell(p)
  dome(p)
  floors(p)
  desks(p, cast)
  library(p)
  workshop(p)
  lounge(p)
  meeting(p)
  atrium(p)
  hallLighting(p)
  exterior(p)
  cameras(p)
  p.anchor('entrance', AX, FEET, AZ + 7, 180, 0)
  p.anchor('spawn', AX + 0.5, FEET, AZ + 7.5, 180, 0)
  p.settleGrass()

  return p
}
