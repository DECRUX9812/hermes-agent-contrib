/**
 * Voxel mesher: turns the Plan's dense cells into textured geometry in the
 * Minecraft style — culled faces, sub-block shapes (stairs, slabs, panes,
 * lanterns, candles, beds of petals, crossed foliage), per-vertex baked light
 * (sky + block channels) and corner AO. Geometry is emitted into three layers:
 * `opaque`, `cutout` (alpha-tested foliage/panes), `translucent` (water).
 *
 * Bound dynamic cells (status lamps, signal bulbs, monitor screens, the task
 * board) are emitted separately so a state change rebuilds just that cell.
 */

import {
  Axis,
  B,
  type BlockDef,
  bsId,
  bsMeta,
  defOf,
  DEFS,
  Dir,
  lampStatus,
  M_ALT,
  M_AMT,
  M_AXIS,
  M_DIR,
  M_TOP,
  occludes,
} from './blocks'
import { aoAt, type LightField, smoothLight } from './light'
import type { Plan } from './plan'
import { AC_LAMP_TILE, type Atlas, LAMP_EMISSIVE_TILE } from './textures'

export interface Quad {
  /** 4 corners, each [x,y,z] in cell-local 0..16 units */
  p: [number, number, number][]
  /** face normal (-1/0/1 per axis) */
  n: [number, number, number]
  /** uv in cell-local fraction [0..1] (u,v per corner) */
  uv: [number, number][]
  tile: string
  /** cull against the cell neighbour in the normal direction */
  boundary?: boolean
  /** emissive face (full-bright layer) */
  emissive?: boolean
  /** water top rows shrink */
  still?: boolean
}

export interface MeshData {
  /** interleaved: pos3 uv2 light3 → 8 floats per vertex, 4 per quad; index quad→2 tris */
  opaque: number[]
  cutout: number[]
  translucent: number[]
  emissive: number[]
  idx: number[]
  idxCounts: { opaque: number; cutout: number; translucent: number; emissive: number }
}

const FACE_SHADE = [0.8, 0.8, 1.0, 0.55, 0.85, 0.85] // +x -x +y -y +z -z (E W U D S N)

const FACE_N: Array<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

/** Order of face directions in meta terms: E=1 W=3 U=- D=- S=2 N=0 mapping to Dir enum. */
const FACE_DIR = [1, 3, -1, -1, 2, 0]

interface Sink {
  out: number[]
  idx: number[]
}

function texFor(def: BlockDef, face: number, meta: number): string {
  const t = def.tex
  const dir = meta & M_DIR

  if (def.shape === 'log' || def.shape === 'chain' || def.shape === 'rod') {
    const axis = meta & M_AXIS
    const faceAxis = face === 0 || face === 1 ? Axis.X : face === 2 || face === 3 ? Axis.Y : Axis.Z

    return faceAxis === axis ? (t.end ?? t.all ?? '') : (t.side ?? t.all ?? '')
  }

  if (def.shape === 'screen' || def.shape === 'facing' || def.shape === 'lectern' || def.shape === 'bell') {
    if (FACE_DIR[face] === dir && t.front) {return t.front}

    if (FACE_DIR[face] === ((dir + 2) & 3) && t.back) {return t.back}

    if (face === 2 && t.top) {return t.top}

    if (face === 3 && t.bottom) {return t.bottom}

    return t.side ?? t.all ?? ''
  }

  if (face === 2) {return t.top ?? t.all ?? ''}

  if (face === 3) {return t.bottom ?? t.all ?? ''}

  return t.side ?? t.all ?? ''
}

class Builder {
  opaque: number[] = []
  cutout: number[] = []
  translucent: number[] = []
  emissive: number[] = []
  idxO: number[] = []
  idxC: number[] = []
  idxT: number[] = []
  idxE: number[] = []

  constructor(
    private p: Plan,
    private light: LightField,
    private atlas: Atlas,
    private dynamic: Map<number, { x: number; y: number; z: number }>,
  ) {}

  quad(sink: number[], idxSink: number[], x: number, y: number, z: number, q: Quad): void {
    const rect = this.atlas.uv.get(q.tile)

    if (!rect) {return}
    const [u0, v0, u1, v1] = rect
    const base = sink.length / 8
    const [nx, ny, nz] = q.n
    const faceIdx = nx > 0 ? 0 : nx < 0 ? 1 : ny > 0 ? 2 : ny < 0 ? 3 : nz > 0 ? 4 : 5
    const shade = FACE_SHADE[faceIdx]

    for (let v = 0; v < 4; v++) {
      const [px, py, pz] = q.p[v]
      // corner offsets on the face plane (-1|+1)
      const cy = ny === 0 ? (py >= 8 ? 1 : -1) : nz !== 0 ? (px >= 8 ? 1 : -1) : pz >= 8 ? 1 : -1
      const cx = nx !== 0 ? (pz >= 8 ? 1 : -1) : ny !== 0 ? (px >= 8 ? 1 : -1) : px >= 8 ? 1 : -1
      const l = smoothLight(this.light, x, y, z, nx, ny, nz, cx, cy)
      const ao = aoAt(this.p, x, y, z, nx, ny, nz, cx, cy)
      const aoF = (0.45 + 0.55 * (ao / 3)) * shade
      sink.push(
        x + px / 16,
        y + py / 16,
        z + pz / 16,
        u0 + (u1 - u0) * q.uv[v][0],
        v0 + (v1 - v0) * q.uv[v][1],
        l.sky / 15,
        l.block / 15,
        aoF,
      )
    }

    idxSink.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  sinkFor(def: BlockDef, emissive: boolean): [number[], number[]] {
    if (emissive || def.emissive) {return [this.emissive, this.idxE]}

    if (def.translucent) {return [this.translucent, this.idxT]}

    if (def.cutout) {return [this.cutout, this.idxC]}

    return [this.opaque, this.idxO]
  }

  /** Whether the neighbour cell in direction `face` hides this face. */
  culled(x: number, y: number, z: number, face: number, self: number, selfDef: BlockDef): boolean {
    const [nx, ny, nz] = FACE_N[face]
    const ns = this.p.get(x + nx, y + ny, z + nz)
    const nid = bsId(ns)

    if (nid === B.AIR) {return false}
    const ndef = defOf(nid)

    if (ndef.opaque) {return true}

    if (selfDef.shape === 'water' && ndef.shape === 'water') {return true}

    // same-type adjacency culls (panes link, leaves densify internally)
    if (nid === bsId(self) && (selfDef.cutout || selfDef.shape === 'pane')) {return selfDef.shape === 'cube'}

    return false
  }

  emit(x: number, y: number, z: number, state: number): void {
    const id = bsId(state)

    if (id === B.AIR || id === B.LIGHT) {return}
    const def = defOf(id)
    const meta = bsMeta(state)

    if (this.dynamic.size > 0) {
      const key = this.p.index(x, y, z)

      if (this.dynamic.has(key)) {return} // emitted by the dynamic pass
    }

    this.emitCell(x, y, z, state, def, meta)
  }

  emitCell(x: number, y: number, z: number, state: number, def: BlockDef, meta: number): void {
    const shape = def.shape
    const quads: Quad[] = []

    switch (shape) {
      case 'cube':

      case 'log':

      case 'screen':

      case 'facing':
        boxQuads(quads, 0, 0, 0, 16, 16, 16, def, meta, (f, d, m) => texFor(d, f, m))

        break
      case 'slab': {
        const top = (meta & M_TOP) !== 0
        boxQuads(quads, 0, top ? 8 : 0, 0, 16, top ? 16 : 8, 16, def, meta, (f, d, m) => texFor(d, f, m))

        break
      }

      case 'stairs': {
        stairQuads(quads, meta & M_DIR, (meta & M_TOP) !== 0, def, meta)

        break
      }

      case 'pane': {
        paneQuads(quads, x, y, z, this.p, def, meta)

        break
      }

      case 'fence': {
        fenceQuads(quads, x, y, z, this.p, def, meta)

        break
      }

      case 'carpet':
        boxQuads(quads, 0, 0, 0, 16, 1, 16, def, meta, (f, d, m) => texFor(d, f, m))

        break

      case 'path':
        boxQuads(quads, 0, 0, 0, 16, 15, 16, def, meta, (f, d, m) => texFor(d, f, m))

        break
      case 'lantern': {
        const hang = (meta & M_ALT) !== 0
        const y0 = hang ? 7 : 0
        boxQuads(quads, 5, y0, 5, 11, y0 + 7, 11, def, meta, (f, d, m) => texFor(d, f, m), true)
        boxQuads(quads, 6, y0 + 7, 6, 10, y0 + 9, 10, def, meta, (f, d, m) => texFor(d, f, m))

        if (hang) {boxQuads(quads, 7, 14, 7, 9, 16, 9, def, meta, (f, d, m) => texFor(d, f, m))}

        break
      }

      case 'chain': {
        const axis = meta & M_AXIS

        if (axis === Axis.Y) {boxQuads(quads, 6, 0, 6, 10, 16, 10, def, meta, (f, d, m) => texFor(d, f, m), true)}
        else if (axis === Axis.X) {boxQuads(quads, 0, 7, 6, 16, 11, 10, def, meta, (f, d, m) => texFor(d, f, m), true)}
        else {boxQuads(quads, 6, 7, 0, 10, 11, 16, def, meta, (f, d, m) => texFor(d, f, m), true)}

        break
      }

      case 'candle': {
        const n = ((meta & M_AMT) >> 4) + 1

        const spots: Array<[number, number, number]> = [
          [7, 0, 8],
          [4, 0, 5],
          [10, 0, 6],
          [6, 0, 11],
        ]

        for (let i = 0; i < n && i < spots.length; i++) {
          const [sx, , sz] = spots[i]
          const h = 7 - i
          boxQuads(quads, sx, 0, sz, sx + 2, h, sz + 2, def, meta, (f, d, m) => texFor(d, f, m))

          // flame
          const flame: Quad = {
            p: [
              [sx, h + 4, sz + 1],
              [sx + 2, h + 4, sz + 1],
              [sx + 2, h, sz + 1],
              [sx, h, sz + 1],
            ],
            n: [0, 0, 1],
            uv: [
              [0.4, 0],
              [0.6, 0],
              [0.6, 0.3],
              [0.4, 0.3],
            ],
            tile: 'flame',
            emissive: true,
          }

          quads.push(flame)
        }

        break
      }

      case 'bell': {
        const dir = meta & M_DIR
        const ox = dir === Dir.E ? 3 : dir === Dir.W ? -3 : 0
        const oz = dir === Dir.S ? 3 : dir === Dir.N ? -3 : 0
        boxQuads(quads, 5 + ox, 5, 5 + oz, 11 + ox, 12, 11 + oz, def, meta, (f, d, m) => texFor(d, f, m))

        break
      }

      case 'cross': {
        const upperHalf = (meta & M_ALT) !== 0
        crossQuads(quads, def, meta, upperHalf ? 'top' : 'bottom')

        break
      }

      case 'bedcover':
        boxQuads(quads, 0, 0, 0, 16, 2, 16, def, meta, (f, d, m) => texFor(d, f, m), true)

        break

      case 'water':
        boxQuads(quads, 0, 0, 0, 16, 14, 16, def, meta, (f, d, m) => texFor(d, f, m))

        break

      case 'lily':
        quads.push({
          p: [
            [2, 1.5, 2],
            [14, 1.5, 2],
            [14, 1.5, 14],
            [2, 1.5, 14],
          ],
          n: [0, 1, 0],
          uv: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
          tile: def.tex.all ?? '',
        })

        break
      case 'trapdoor': {
        const open = (meta & M_ALT) !== 0
        const top = (meta & M_TOP) !== 0

        if (!open) {
          boxQuads(quads, 0, top ? 13 : 0, 0, 16, top ? 16 : 3, 16, def, meta, (f, d, m) => texFor(d, f, m), true)
        } else {
          const dir = meta & M_DIR

          if (dir === Dir.N) {boxQuads(quads, 0, 0, 0, 16, 16, 3, def, meta, (f, d, m) => texFor(d, f, m), true)}
          else if (dir === Dir.S) {boxQuads(quads, 0, 0, 13, 16, 16, 16, def, meta, (f, d, m) => texFor(d, f, m), true)}
          else if (dir === Dir.W) {boxQuads(quads, 0, 0, 0, 3, 16, 16, def, meta, (f, d, m) => texFor(d, f, m), true)}
          else {boxQuads(quads, 13, 0, 0, 16, 16, 16, def, meta, (f, d, m) => texFor(d, f, m), true)}
        }

        break
      }

      case 'lamp': {
        // a small framed lamp cube; texture by lamp state
        const st = lampStatus(state)
        const tile = AC_LAMP_TILE[st] ?? 'ac:status_lamp_idle'
        const eTile = LAMP_EMISSIVE_TILE[st]
        boxQuads(quads, 3, 3, 3, 13, 13, 13, def, meta, () => tile)

        if (eTile) {
          boxQuads(quads, 3, 3, 3, 13, 13, 13, { ...def, tex: { all: eTile } }, meta, () => eTile, true, true)
        }

        break
      }

      case 'bulb': {
        const lit = (meta & M_TOP) !== 0
        boxQuads(quads, 2, 2, 2, 14, 14, 14, def, meta, () => (lit ? 'copper_bulb_lit' : 'copper_bulb'), lit)

        break
      }

      case 'rod':
        boxQuads(quads, 7, 0, 7, 9, 16, 9, def, meta, (f, d, m) => texFor(d, f, m), true)

        break

      case 'brewing':
        boxQuads(quads, 1, 0, 1, 15, 2, 15, def, meta, (f, d, m) => texFor(d, f, m))
        boxQuads(quads, 7, 2, 7, 9, 13, 9, def, meta, (f, d, m) => texFor(d, f, m))
        boxQuads(quads, 4, 12, 4, 12, 15, 12, def, meta, (f, d, m) => texFor(d, f, m))

        break

      case 'lectern':
        boxQuads(quads, 4, 0, 4, 12, 2, 12, def, meta, (f, d, m) => texFor(d, f, m))
        boxQuads(quads, 6, 2, 6, 10, 9, 10, def, meta, (f, d, m) => texFor(d, f, m))
        boxQuads(quads, 3, 9, 3, 13, 13, 13, def, meta, (f, d, m) => texFor(d, f, m))

        break

      case 'campfire':
        boxQuads(quads, 1, 0, 1, 15, 5, 15, def, meta, (f, d, m) => texFor(d, f, m), true, true)

        break

      case 'bushcube':
        boxQuads(quads, 2, 0, 2, 14, 13, 14, def, meta, (f, d, m) => texFor(d, f, m), true)

        break
      case 'potted': {
        boxQuads(quads, 5, 0, 5, 11, 6, 11, { ...def, tex: { all: 'flowerpot' } }, meta, () => 'flowerpot', true)
        const plantDef = { ...def }
        crossQuads(quads, plantDef, meta, 'full', 6, 10)

        break
      }

      case 'light':
        break
    }

    for (const q of quads) {
      const [nx, ny, nz] = q.n
      const faceIdx = nx > 0 ? 0 : nx < 0 ? 1 : ny > 0 ? 2 : ny < 0 ? 3 : nz > 0 ? 4 : 5

      const onBoundary =
        (nx > 0 && q.p.every(v => v[0] === 16)) ||
        (nx < 0 && q.p.every(v => v[0] === 0)) ||
        (ny > 0 && q.p.every(v => v[1] === 16)) ||
        (ny < 0 && q.p.every(v => v[1] === 0)) ||
        (nz > 0 && q.p.every(v => v[2] === 16)) ||
        (nz < 0 && q.p.every(v => v[2] === 0))

      if (onBoundary && this.culled(x, y, z, faceIdx, state, def)) {continue}
      const [sink, idx] = this.sinkFor(def, q.emissive === true)
      this.quad(sink, idx, x, y, z, q)
    }
  }
}

type TexPick = (face: number, def: BlockDef, meta: number) => string

/** Emit the 6 faces of an axis-aligned sub-box (pixel coords 0..16). */
function boxQuads(out: Quad[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, def: BlockDef, meta: number, pick: TexPick, cutoutUv = false, emissive = false): void {
  const faces: Array<{ f: number; c: [number, number, number][]; uvBase: [number, number] }> = [
    // +x (east): u=z, v=1-y
    {
      f: 0,
      c: [
        [x1, y0, z0],
        [x1, y0, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      uvBase: [z0 / 16, 1 - y1 / 16],
    },
    // -x (west)
    {
      f: 1,
      c: [
        [x0, y0, z1],
        [x0, y0, z0],
        [x0, y1, z0],
        [x0, y1, z1],
      ],
      uvBase: [1 - z1 / 16, 1 - y1 / 16],
    },
    // +y (up): u=x, v=z
    {
      f: 2,
      c: [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      uvBase: [x0 / 16, z0 / 16],
    },
    // -y (down)
    {
      f: 3,
      c: [
        [x0, y0, z1],
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
      ],
      uvBase: [x0 / 16, 1 - z1 / 16],
    },
    // +z (south): u=x, v=1-y
    {
      f: 4,
      c: [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      uvBase: [x0 / 16, 1 - y1 / 16],
    },
    // -z (north)
    {
      f: 5,
      c: [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
      uvBase: [1 - x1 / 16, 1 - y1 / 16],
    },
  ]

  for (const { f, c, uvBase } of faces) {
    const tile = pick(f, def, meta)

    if (!tile) {continue}
    // uv size from the box's extent along the face axes
    const us = (f === 0 || f === 1 ? z1 - z0 : x1 - x0) / 16
    const vs = f === 2 || f === 3 ? (z1 - z0) / 16 : (y1 - y0) / 16

    const uv: [number, number][] = [
      [uvBase[0], uvBase[1] + vs],
      [uvBase[0] + us, uvBase[1] + vs],
      [uvBase[0] + us, uvBase[1]],
      [uvBase[0], uvBase[1]],
    ]

    out.push({ p: c as [number, number, number][], n: FACE_N[f] as [number, number, number], uv, tile, emissive })
  }

  void cutoutUv
}

function stairQuads(out: Quad[], dir: number, top: boolean, def: BlockDef, meta: number): void {
  // canonical: facing = direction of ascent; high half sits on the facing side
  const pick: TexPick = (f, d, m) => texFor(d, f, m)

  if (!top) {
    boxQuads(out, 0, 0, 0, 16, 8, 16, def, meta, pick)

    if (dir === 0) {boxQuads(out, 0, 8, 0, 16, 16, 8, def, meta, pick)}
    else if (dir === 2) {boxQuads(out, 0, 8, 8, 16, 16, 16, def, meta, pick)}
    else if (dir === 1) {boxQuads(out, 8, 8, 0, 16, 16, 16, def, meta, pick)}
    else {boxQuads(out, 0, 8, 0, 8, 16, 16, def, meta, pick)}
  } else {
    boxQuads(out, 0, 8, 0, 16, 16, 16, def, meta, pick)

    if (dir === 0) {boxQuads(out, 0, 0, 0, 16, 8, 8, def, meta, pick)}
    else if (dir === 2) {boxQuads(out, 0, 0, 8, 16, 8, 16, def, meta, pick)}
    else if (dir === 1) {boxQuads(out, 8, 0, 0, 16, 8, 16, def, meta, pick)}
    else {boxQuads(out, 0, 0, 0, 8, 8, 16, def, meta, pick)}
  }
}

function paneQuads(out: Quad[], x: number, y: number, z: number, p: Plan, def: BlockDef, meta: number): void {
  // centre post + arms toward connectable neighbours
  const pick: TexPick = (f, d, m) => texFor(d, f, m)

  const conn = (dx: number, dz: number) => {
    const s = p.get(x + dx, y, z + dz)
    const id = bsId(s)

    return id === bsId(0) ? false : defOf(id).shape === 'pane' || occludes(s)
  }

  boxQuads(out, 7, 0, 7, 9, 16, 9, def, meta, pick, true)

  if (conn(0, -1)) {boxQuads(out, 7, 0, 0, 9, 16, 7, def, meta, pick, true)}

  if (conn(0, 1)) {boxQuads(out, 7, 0, 9, 9, 16, 16, def, meta, pick, true)}

  if (conn(-1, 0)) {boxQuads(out, 0, 0, 7, 7, 16, 9, def, meta, pick, true)}

  if (conn(1, 0)) {boxQuads(out, 9, 0, 7, 16, 16, 9, def, meta, pick, true)}
}

function fenceQuads(out: Quad[], x: number, y: number, z: number, p: Plan, def: BlockDef, meta: number): void {
  const pick: TexPick = (f, d, m) => texFor(d, f, m)

  const conn = (dx: number, dz: number) => {
    const s = p.get(x + dx, y, z + dz)

    return defOf(bsId(s)).shape === 'fence' || occludes(s)
  }

  boxQuads(out, 6, 0, 6, 10, 16, 10, def, meta, pick)

  for (const [dx, dz] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const) {
    if (!conn(dx, dz)) {continue}
    const ax0 = dx === 0 ? 6 : dx < 0 ? 0 : 6
    const ax1 = dx === 0 ? 10 : dx < 0 ? 10 : 16
    const az0 = dz === 0 ? 6 : dz < 0 ? 0 : 6
    const az1 = dz === 0 ? 10 : dz < 0 ? 10 : 16
    boxQuads(out, ax0, 9, az0, ax1, 15, az1, def, meta, pick)
  }
}

/** Two diagonal quads through the cell centre, both faces drawn. */
function crossQuads(out: Quad[], def: BlockDef, meta: number, half: 'full' | 'top' | 'bottom', y0 = 0, y1 = 16): void {
  const tile = def.tex.all ?? ''
  const v0 = half === 'bottom' ? 0.5 : 0
  const v1 = half === 'top' ? 0.5 : 1

  const quads: Array<{ p: [number, number, number][]; uv: [number, number][] }> = [
    {
      p: [
        [0.8, y1, 0.8],
        [15.2, y1, 15.2],
        [15.2, y0, 15.2],
        [0.8, y0, 0.8],
      ],
      uv: [
        [0, v0],
        [1, v0],
        [1, v1],
        [0, v1],
      ],
    },
    {
      p: [
        [0.8, y1, 15.2],
        [15.2, y1, 0.8],
        [15.2, y0, 0.8],
        [0.8, y0, 15.2],
      ],
      uv: [
        [0, v0],
        [1, v0],
        [1, v1],
        [0, v1],
      ],
    },
  ]

  for (const q of quads) {
    // emit both windings so the cross reads from every side
    out.push({ p: q.p, n: [0, 1, 0], uv: q.uv, tile })
    out.push({ p: [q.p[3], q.p[2], q.p[1], q.p[0]], n: [0, -1, 0], uv: q.uv, tile })
  }
}

// ================================================================== public API

/** Static world mesh + the set of bound dynamic cells (lamps, bulbs, screens). */
export interface WorldMesh {
  opaque: number[]
  cutout: number[]
  translucent: number[]
  emissive: number[]
  idx: number[][] // per-layer index buffers matching the order above
  lamps: Map<number, { x: number; y: number; z: number; binding: string }>
  bulbs: Map<number, { x: number; y: number; z: number }>
}

export function meshWorld(p: Plan, light: LightField, atlas: Atlas): WorldMesh {
  const dynamic = new Map<number, { x: number; y: number; z: number }>()
  const lamps = new Map<number, { x: number; y: number; z: number; binding: string }>()
  const bulbs = new Map<number, { x: number; y: number; z: number }>()

  for (const [key, binding] of p.bindings) {
    const x = (key % p.sx) + p.minX
    const z = (Math.floor(key / p.sx) % p.sz) + p.minZ
    const y = Math.floor(key / (p.sx * p.sz)) + p.minY
    const id = bsId(p.cells[key])
    const def = defOf(id)

    if (def.shape === 'lamp') {
      lamps.set(key, { x, y, z, binding })
      dynamic.set(key, { x, y, z })
    } else if (def.shape === 'bulb') {
      bulbs.set(key, { x, y, z })
      dynamic.set(key, { x, y, z })
    }
  }

  const b = new Builder(p, light, atlas, dynamic)

  for (let y = p.minY; y <= p.maxY; y++) {
    for (let z = p.minZ; z <= p.maxZ; z++) {
      for (let x = p.minX; x <= p.maxX; x++) {
        const s = p.get(x, y, z)

        if (bsId(s) === B.AIR) {continue}
        b.emit(x, y, z, s)
      }
    }
  }

  // quads were emitted into per-layer arrays with per-layer index buffers —
  // but Builder.quad writes into one shared sink; keep them consistent:
  return {
    opaque: b.opaque,
    cutout: b.cutout,
    translucent: b.translucent,
    emissive: b.emissive,
    idx: [b.idxO, b.idxC, b.idxT, b.idxE],
    lamps,
    bulbs,
  }
}

/** Rebuild one dynamic cell (lamp / bulb) into a small quad batch. */
export function meshCell(p: Plan, light: LightField, atlas: Atlas, x: number, y: number, z: number, state: number): { opaque: number[]; emissive: number[]; idxO: number[]; idxE: number[] } {
  const b = new Builder(p, light, atlas, new Map())
  const id = bsId(state)
  const def = defOf(id)
  b.emitCell(x, y, z, state, def, bsMeta(state))

  return { opaque: b.opaque, emissive: b.emissive, idxO: b.idxO, idxE: b.idxE }
}

/** Debug stats for tests: block-type census of the plan. */
export function census(p: Plan): Map<string, number> {
  const counts = new Map<string, number>()

  for (const s of p.cells) {
    const id = bsId(s)
    const key = DEFS[id]?.key ?? String(id)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return counts
}
