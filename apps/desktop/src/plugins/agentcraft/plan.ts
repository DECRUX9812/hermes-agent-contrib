/**
 * Plan — the whole desired contents of the HQ site box, built in memory before
 * meshing (a straight port of `Plan.java`'s cell store + top heightmap +
 * bindings; the world-diff machinery it feeds on the server is not needed for
 * a renderer). Cells are packed block states (`bs()`), stored dense.
 */

import { B, bs, bsId, isOpaque } from './blocks'

export interface Anchor {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
}

export class Plan {
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  readonly sx: number
  readonly sy: number
  readonly sz: number
  readonly cells: Uint16Array
  readonly topMap: Int16Array
  readonly bindings = new Map<number, string>()
  readonly anchors = new Map<string, Anchor>()

  constructor(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, groundTop: number, ground: (y: number) => number) {
    this.minX = minX
    this.minY = minY
    this.minZ = minZ
    this.maxX = maxX
    this.maxY = maxY
    this.maxZ = maxZ
    this.sx = maxX - minX + 1
    this.sy = maxY - minY + 1
    this.sz = maxZ - minZ + 1
    this.cells = new Uint16Array(this.sx * this.sy * this.sz)
    this.topMap = new Int16Array(this.sx * this.sz).fill(groundTop)

    for (let y = minY; y <= maxY; y++) {
      const g = ground(y)

      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          this.cells[this.index(x, y, z)] = g
        }
      }
    }
  }

  index(x: number, y: number, z: number): number {
    return ((y - this.minY) * this.sz + (z - this.minZ)) * this.sx + (x - this.minX)
  }

  in(x: number, y: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY && z >= this.minZ && z <= this.maxZ
  }

  inXZ(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ
  }

  get(x: number, y: number, z: number): number {
    return this.in(x, y, z) ? this.cells[this.index(x, y, z)] : bs(B.AIR)
  }

  isAir(x: number, y: number, z: number): boolean {
    return bsId(this.get(x, y, z)) === B.AIR
  }

  set(x: number, y: number, z: number, state: number): void {
    if (this.in(x, y, z)) {
      this.cells[this.index(x, y, z)] = state
    }
  }

  setIfAir(x: number, y: number, z: number, state: number): void {
    if (this.isAir(x, y, z)) {
      this.set(x, y, z, state)
    }
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number): void {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
          this.set(x, y, z, state)
        }
      }
    }
  }

  /** Ground top (the grass block's y) of column (x, z); outside: the meadow default. */
  top(x: number, z: number): number {
    return this.inXZ(x, z) ? this.topMap[(z - this.minZ) * this.sx + (x - this.minX)] : 64
  }

  setTop(x: number, z: number, y: number): void {
    if (this.inXZ(x, z)) {
      this.topMap[(z - this.minZ) * this.sx + (x - this.minX)] = y
    }
  }

  /** Binding of a station block (lamp / monitor / podium ...) at (x, y, z). */
  bind(x: number, y: number, z: number, binding: string): void {
    this.bindings.set(this.index(x, y, z), binding)
  }

  anchor(name: string, x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    this.anchors.set(name, { x, y, z, yaw, pitch })
  }

  /** A camera anchor: eye position looking at a target; yaw/pitch resolved at use. */
  cameraLookAt(name: string, ex: number, ey: number, ez: number, tx: number, ty: number, tz: number): void {
    const dx = tx - ex
    const dz = tz - ez
    const dy = ty - ey
    const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI
    const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI
    this.anchors.set(`cam:${name}`, { x: ex, y: ey, z: ez, yaw, pitch })
  }

  /**
   * Vanilla's grass rule applied to the plan: grass under a solid block decays to
   * dirt; dirt under open sky is grown over to grass, so the meadow never looks
   * half-settled (port of `Plan.settleGrass`).
   */
  settleGrass(): void {
    const grass = bs(B.GRASS)
    const dirt = bs(B.DIRT)

    for (let y = this.minY; y < this.maxY; y++) {
      for (let z = this.minZ; z <= this.maxZ; z++) {
        for (let x = this.minX; x <= this.maxX; x++) {
          const i = this.index(x, y, z)
          const s = this.cells[i]
          const isGrass = s === grass

          if (!isGrass && s !== dirt) {continue}
          const above = this.cells[this.index(x, y + 1, z)]
          const lives = !isOpaque(above)

          if (isGrass && !lives) {this.cells[i] = dirt}
          else if (!isGrass && lives) {this.cells[i] = grass}
        }
      }
    }
  }
}
