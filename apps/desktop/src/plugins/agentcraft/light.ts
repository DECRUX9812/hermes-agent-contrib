/**
 * Minecraft-style dual-channel light: a sky channel (straight-down stays 15 in
 * open air, horizontal/up steps cost 1) and a block channel (BFS falloff from
 * emissive blocks). Computed over the plan's dense cell box plus a 1-block
 * halo via "outside" = open sky.
 */

import { B, bsId, emittedLight, isOpaque, lightLoss, occludes as occludesState } from './blocks'
import type { Plan } from './plan'

export interface LightField {
  sky: Uint8Array
  block: Uint8Array
  skyAt(x: number, y: number, z: number): number
  blockAt(x: number, y: number, z: number): number
}

const NB = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

export function computeLight(p: Plan): LightField {
  const { minX, minY, minZ, sx, sy, sz } = p
  const sky = new Uint8Array(sx * sy * sz)
  const block = new Uint8Array(sx * sy * sz)
  const index = (x: number, y: number, z: number) => ((y - minY) * sz + (z - minZ)) * sx + (x - minX)

  // -------------------------------------------------------------- sky seeding
  // A column sees the sky until the first opaque block; then that cell and
  // everything under it starts dark (later lateral BFS fills interiors).
  const queueX: number[] = []
  const queueY: number[] = []
  const queueZ: number[] = []

  for (let x = minX; x <= p.maxX; x++) {
    for (let z = minZ; z <= p.maxZ; z++) {
      let open = true

      for (let y = p.maxY; y >= minY; y--) {
        const s = p.cells[index(x, y, z)]

        if (isOpaque(s)) {
          open = false

          continue
        }

        if (open) {
          const i = index(x, y, z)
          sky[i] = 15
          queueX.push(x)
          queueY.push(y)
          queueZ.push(z)
        }
      }
    }
  }

  // -------------------------------------------------------------- sky BFS
  let head = 0

  while (head < queueX.length) {
    const x = queueX[head]
    const y = queueY[head]
    const z = queueZ[head]
    head++
    const v = sky[index(x, y, z)]

    for (const [dx, dy, dz] of NB) {
      const nx = x + dx
      const ny = y + dy
      const nz = z + dz

      if (nx < minX || nx > p.maxX || ny < minY || ny > p.maxY || nz < minZ || nz > p.maxZ) {continue}
      const ni = index(nx, ny, nz)
      const s = p.cells[ni]
      const loss = lightLoss(s)

      if (loss === 0) {continue}
      // straight down keeps 15 only while unobstructed; sideways/down lose 1
      const spread = v - loss

      if (spread > sky[ni]) {
        sky[ni] = spread
        queueX.push(nx)
        queueY.push(ny)
        queueZ.push(nz)
      }
    }
  }

  // -------------------------------------------------------------- block BFS
  let bh = 0
  const bqx: number[] = []
  const bqy: number[] = []
  const bqz: number[] = []

  for (let y = minY; y <= p.maxY; y++) {
    for (let z = minZ; z <= p.maxZ; z++) {
      for (let x = minX; x <= p.maxX; x++) {
        const i = index(x, y, z)
        const lv = emittedLight(p.cells[i])

        if (lv > 0) {
          block[i] = lv
          bqx.push(x)
          bqy.push(y)
          bqz.push(z)
        }
      }
    }
  }

  while (bh < bqx.length) {
    const x = bqx[bh]
    const y = bqy[bh]
    const z = bqz[bh]
    bh++
    const v = block[index(x, y, z)]

    if (v <= 1) {continue}

    for (const [dx, dy, dz] of NB) {
      const nx = x + dx
      const ny = y + dy
      const nz = z + dz

      if (nx < minX || nx > p.maxX || ny < minY || ny > p.maxY || nz < minZ || nz > p.maxZ) {continue}
      const ni = index(nx, ny, nz)
      const s = p.cells[ni]
      const loss = lightLoss(s)

      if (loss === 0) {continue}
      const spread = v - loss

      if (spread > block[ni]) {
        block[ni] = spread
        bqx.push(nx)
        bqy.push(ny)
        bqz.push(nz)
      }
    }
  }

  return {
    sky,
    block,
    skyAt(x, y, z) {
      if (x < minX || x > p.maxX || y < minY || y > p.maxY || z < minZ || z > p.maxZ) {return 15}

      return sky[index(x, y, z)]
    },
    blockAt(x, y, z) {
      if (x < minX || x > p.maxX || y < minY || y > p.maxY || z < minZ || z > p.maxZ) {return 0}

      return block[index(x, y, z)]
    },
  }
}

/**
 * Per-vertex smooth light: MC averages the light of the 4 cells touching a
 * vertex on the lit side of a face. `lightAt` = combined channels (sky×day +
 * block) so meshes get one scalar per vertex; AO is computed separately.
 */
export function smoothLight(field: LightField, x: number, y: number, z: number, nx: number, ny: number, nz: number, cx: number, cy: number): { sky: number; block: number } {
  // the cell the face points into
  const bx = x + nx
  const by = y + ny
  const bz = z + nz
  const s: number[] = []
  const b: number[] = []
  // the 3 neighbour cells adjacent to this corner on the face plane + the cell itself
  const cells: Array<[number, number, number]> = [[bx, by, bz]]

  if (nx !== 0) {
    cells.push([bx, by + cy, bz], [bx, by, bz + cx], [bx, by + cy, bz + cx])
  } else if (ny !== 0) {
    cells.push([bx + cx, by, bz], [bx, by, bz + cy], [bx + cx, by, bz + cy])
  } else {
    cells.push([bx + cx, by, bz], [bx, by + cy, bz], [bx + cx, by + cy, bz])
  }

  for (const [cx0, cy0, cz0] of cells) {
    s.push(field.skyAt(cx0, cy0, cz0))
    b.push(field.blockAt(cx0, cy0, cz0))
  }

  return { sky: Math.max(...s), block: Math.max(...b) }
}

/** AO 0-3 (Minecraft corner rule) — 0 = darkest. */
export function aoAt(p: Plan, x: number, y: number, z: number, nx: number, ny: number, nz: number, cx: number, cy: number): number {
  const bx = x + nx
  const by = y + ny
  const bz = z + nz
  let s1 = 0
  let s2 = 0
  let c = 0

  const occ = (ax: number, ay: number, az: number) => {
    const id = bsId(p.get(ax, ay, az))

    return id !== B.AIR && occludesState(id)
  }

  if (nx !== 0) {
    s1 = occ(bx, by + cy, bz) ? 1 : 0
    s2 = occ(bx, by, bz + cx) ? 1 : 0
    c = occ(bx, by + cy, bz + cx) ? 1 : 0
  } else if (ny !== 0) {
    s1 = occ(bx + cx, by, bz) ? 1 : 0
    s2 = occ(bx, by, bz + cy) ? 1 : 0
    c = occ(bx + cx, by, bz + cy) ? 1 : 0
  } else {
    s1 = occ(bx + cx, by, bz) ? 1 : 0
    s2 = occ(bx, by + cy, bz) ? 1 : 0
    c = occ(bx + cx, by + cy, bz) ? 1 : 0
  }

  if (s1 && s2) {return 0}

  return 3 - (s1 + s2 + c)
}
