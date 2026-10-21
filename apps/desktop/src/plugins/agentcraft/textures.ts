/**
 * Texture atlas: a 16×16-per-tile canvas atlas built from two sources —
 *   `ac:*` tiles load the MIT-licensed AgentCraft PNGs bundled under
 *   `../assets/block/` (the studio's custom blocks and lamps);
 *   everything else is generated procedurally in the Minecraft style
 *   (palette-ramps + per-pixel jitter noise, flat banding, sparse details)
 *   because vanilla Minecraft textures are copyrighted and can't be copied.
 */

import paletteJson from './assets/palette.json'

export interface Palette {
  colors: Record<string, string>
  ramps: Record<string, { base: number; tones: string[] }>
  status: Record<string, string>
}

export const PALETTE = paletteJson as unknown as Palette

export function hex(c: string): [number, number, number] {
  if (typeof c !== 'string' || !c.startsWith('#')) {
     
    console.error('bad palette color', JSON.stringify(c), new Error('trace').stack)
    throw new Error(`bad palette color: ${JSON.stringify(c)}`)
  }

  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]
}

function rgb(c: string): [number, number, number, number] {
  const [r, g, b] = hex(c)

  return [r, g, b, 255]
}

export function mix(a: [number, number, number, number], b: [number, number, number, number], t: number): [number, number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
}

function tone(ramp: string, i: number): [number, number, number, number] {
  const tones = PALETTE.ramps[ramp].tones

  return rgb(tones[Math.max(0, Math.min(tones.length - 1, i))])
}

/** Deterministic per-pixel RNG (mulberry32 seeded per tile). */
export function makeRand(seed: number): () => number {
  let s = seed >>> 0

  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Pixel = [number, number, number, number]
export type Painter = (put: (x: number, y: number, c: Pixel) => void, rand: () => number) => void

const TILE = 16

/** Ordered ramp noise fill — the workhorse MC look: base tone + jitter. */
function noiseFill(ramp: string, seed: number, jitter = 1): Painter {
  return (put, rand) => {
    const tones = PALETTE.ramps[ramp].tones
    const base = PALETTE.ramps[ramp].base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const j = Math.round((rand() - 0.5) * 2 * jitter)
        put(x, y, rgb(tones[Math.max(0, Math.min(tones.length - 1, base + j))]))
      }
    }
  }
}

/** Horizontal planks: 4 rows of 4px, per-row tone jitter, seam + occasional knot. */
function planks(ramp: string, seed: number): Painter {
  return (put, rand) => {
    const tones = PALETTE.ramps[ramp].tones.map(rgb)
    const base = PALETTE.ramps[ramp].base
    const dark = tones[Math.min(tones.length - 1, base + 1)]
    const darker = tones[tones.length - 1]

    for (let row = 0; row < 4; row++) {
      const rowShift = Math.round((rand() - 0.5) * 1.4)
      // staggered vertical joint positions per row
      const joint = 3 + Math.floor(rand() * 10)

      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < TILE; x++) {
          let t = base + rowShift + (rand() < 0.12 ? -1 : 0)

          if (y === 3) {t = tones.length - 1} // row seam

          if (x === joint && y < 3) {t = tones.length - 1} // board joint

          // knot
          if (x === (joint + 5) % 16 && y === 1) {t = base + 1}
          put(x, row * 4 + y, tones[Math.max(0, Math.min(tones.length - 1, t))])
        }
      }
    }
  }
}

/** Bark side: vertical streaks of a dark ramp on a mid tone. */
function bark(ramp: string, seed: number, stripeEvery = 4): Painter {
  return (put, rand) => {
    const tones = PALETTE.ramps[ramp].tones.map(rgb)
    const base = PALETTE.ramps[ramp].base

    for (let x = 0; x < TILE; x++) {
      const stripe = rand() < 0.55 ? 1 : 0
      const colShift = Math.round((rand() - 0.5) * 1.2)

      for (let y = 0; y < TILE; y++) {
        let t = base + colShift + (rand() < 0.18 ? -1 : 0)

        if (stripe === 1 && x % stripeEvery === 0) {t = tones.length - 1}
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  }
}

/** Log end cap: concentric rings. */
function logTop(ramp: string): Painter {
  return put => {
    const tones = PALETTE.ramps[ramp].tones.map(rgb)
    const base = PALETTE.ramps[ramp].base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const dx = x - 7.5
        const dy = y - 7.5
        const r = Math.sqrt(dx * dx + dy * dy)
        const ring = Math.floor(r) % 2 === 0
        const edge = Math.max(Math.abs(dx), Math.abs(dy)) > 6
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, edge ? tones.length - 2 : ring ? base + 1 : base))])
      }
    }
  }
}

/** Dense leaves: noisy ramp fill with alpha holes (cutout) + darker speckles. */
function leaves(ramp: string, seed: number, holes = 0.24, extra?: string): Painter {
  return (put, rand) => {
    const tones = PALETTE.ramps[ramp].tones.map(rgb)
    const base = PALETTE.ramps[ramp].base
    const accent = extra ? rgb(PALETTE.colors[extra] ?? extra) : null

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = rand()

        if (v < holes) {
          put(x, y, [0, 0, 0, 0])

          continue
        }

        const t = base + (v < 0.45 ? -1 : v > 0.9 ? 1 : 0)

        if (accent && rand() < 0.08) {
          put(x, y, accent)

          continue
        }

        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  }
}

/** Wool/carpet: flat tone with gentle cloth noise. */
function cloth(ramp: string, seed: number): Painter {
  return noiseFill(ramp, seed, 0.6)
}

/** Brick courses: 2×4 brick grid with mortar lines (mud bricks style). */
function bricks(ramp: string, seed: number, bw = 4, bh = 4, mortar = -1): Painter {
  return (put, rand) => {
    const tones = PALETTE.ramps[ramp].tones.map(rgb)
    const base = PALETTE.ramps[ramp].base
    const mortarC = tones[mortar]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const row = Math.floor(y / bh)
        const xx = (x + (row % 2) * (bw / 2)) % 16
        const isMortar = y % bh === bh - 1 || xx % bw === bw - 1

        if (isMortar) {
          put(x, y, mortarC)
        } else {
          const t = base + (rand() < 0.2 ? -1 : 0) + (rand() < 0.08 ? 1 : 0)
          put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
        }
      }
    }
  }
}

/** Stone-ish speckle. */
function speckle(ramp: string, seed: number, spotChance = 0.15): Painter {
  return (put, rand) => {
    const tones = PALETTE.ramps[ramp].tones.map(rgb)
    const base = PALETTE.ramps[ramp].base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const t = base + (rand() < spotChance ? -1 : 0) + (rand() < 0.06 ? 1 : 0)
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  }
}

/** Cobble: blobby stones w/ dark joints + optional moss. */
function cobble(ramp: string, seed: number, mossy: boolean): Painter {
  return (put, rand) => {
    const tones = PALETTE.ramps[ramp].tones.map(rgb)
    const moss = PALETTE.ramps.sage.tones.map(rgb)
    const mossBase = PALETTE.ramps.sage.base
    const dark = tones[tones.length - 1]

    // cellular-ish: carve dark channels
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = Math.sin(x * 0.8 + rand() * 0.6) * Math.cos(y * 0.9 + rand() * 0.6)

        if (v < -0.35) {
          put(x, y, dark)
        } else {
          const t = PALETTE.ramps[ramp].base + (rand() < 0.25 ? -1 : 0) + (rand() < 0.1 ? 1 : 0)
          const c = tones[Math.max(0, Math.min(tones.length - 1, t))]
          put(x, y, mossy && rand() < 0.35 ? moss[Math.min(moss.length - 1, mossBase + (rand() < 0.5 ? -1 : 0))] : c)
        }
      }
    }
  }
}

/** Cross-billboard flower/grass textures: transparent bg + painted pixels. */
function flower(petals: [number, number, number, number], stem: [number, number, number, number], kind: 'single' | 'double' | 'ball' | 'bells' | 'spray' | 'grass' | 'fern' | 'tallgrass' | 'bushy', seed: number): Painter {
  return (put, rand) => {
    const darkStem: Pixel = [stem[0] * 0.7, stem[1] * 0.7, stem[2] * 0.7, 255]
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {for (let x = 0; x < TILE; x++) {put(x, y, clear)}}

    const stemCol = (y0: number, y1: number, x: number) => {
      for (let y = y0; y <= y1; y++) {put(x, y, stem)}
    }

    if (kind === 'grass') {
      for (let i = 0; i < 7; i++) {
        const x = 1 + Math.floor(rand() * 14)
        const h = 4 + Math.floor(rand() * 8)

        for (let y = TILE - 1; y > TILE - h; y--) {put(x, y, rand() < 0.3 ? darkStem : stem)}
      }

      return
    }

    if (kind === 'tallgrass') {
      for (let i = 0; i < 9; i++) {
        const x = Math.floor(rand() * 15)
        const h = 8 + Math.floor(rand() * 8)

        for (let y = TILE - 1; y > TILE - h; y--) {put(x, y, rand() < 0.35 ? darkStem : stem)}
      }

      return
    }

    if (kind === 'fern') {
      for (let i = -3; i <= 3; i++) {
        const x = 8 + i
        const h = 6 + Math.floor((3 - Math.abs(i)) * 2.4)

        for (let y = TILE - 1; y > TILE - h; y--) {
          put(x, y, stem)

          if (y % 3 === 0 && i !== 0) {put(x + (i > 0 ? -1 : 1) * (i > 0 ? 0 : -0), y, stem)}
        }
      }

      // fronds
      for (let s = -1; s <= 1; s += 2) {
        for (let y = 0; y < 8; y++) {
          const x = 8 + s * Math.floor(y / 3)

          if (x >= 0 && x < 16) {put(x, TILE - 6 + y - 4, darkStem)}
        }
      }

      return
    }

    if (kind === 'bushy') {
      for (let y = 6; y < 16; y++) {
        for (let x = 2; x < 14; x++) {
          const dx = (x - 8) / 6
          const dy = (y - 11) / 5

          if (dx * dx + dy * dy < 1 && rand() < 0.85) {put(x, y, rand() < 0.3 ? darkStem : stem)}
        }
      }

      return
    }

    // stems
    stemCol(6, 15, 8)

    if (kind === 'double') {stemCol(5, 15, 9)}
    // leaves
    put(7, 11, stem)
    put(9, 9, stem)

    if (kind === 'single') {
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          if ((dx === 0 || dx === 3) && (dy === 0 || dy === 3) && rand() < 0.7) {continue}
          put(6 + dx, 2 + dy, dy === 1 && dx === 1 ? [petals[0] * 1.15, petals[1] * 1.15, petals[2] * 1.15, 255] : petals)
        }
      }

      put(7, 3, [petals[0] * 1.2, petals[1] * 1.2, petals[2] * 1.2, 255])
    } else if (kind === 'ball') {
      for (let y = 1; y < 7; y++) {
        for (let x = 4; x < 12; x++) {
          const dx = x - 7.5
          const dy = y - 3.5

          if (dx * dx + dy * dy < 9) {put(x, y, petals)}
        }
      }
    } else if (kind === 'bells') {
      for (const [bx, by] of [
        [6, 3],
        [9, 4],
        [7, 6],
        [10, 7],
        [6, 8],
      ] as const) {
        put(bx, by, petals)
        put(bx, by + 1, petals)
      }
    } else if (kind === 'spray') {
      for (let i = 0; i < 8; i++) {
        const x = 3 + Math.floor(rand() * 10)
        const y = 1 + Math.floor(rand() * 7)
        put(x, y, petals)

        if (rand() < 0.5) {put(x, y + 1, petals)}
      }
    }
  }
}

/** Diagonal two-quad cross plants share these plant painters. */

// ------------------------------------------------------------------ painter table

export const PAINTERS: Record<string, Painter> = {
  stone: speckle('stone', 11, 0.2),
  dirt: speckle('clay_leather', 12, 0.25),
  grass_top: (put, rand) => {
    const tones = PALETTE.ramps.sage.tones.map(rgb)
    const base = PALETTE.ramps.sage.base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const t = base + (rand() < 0.3 ? -1 : 0) + (rand() < 0.1 ? 1 : 0)
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  },
  grass_side: (put, rand) => {
    const dirt = PALETTE.ramps.clay_leather.tones.map(rgb)
    const green = PALETTE.ramps.sage.tones.map(rgb)
    const dBase = PALETTE.ramps.clay_leather.base
    const gBase = PALETTE.ramps.sage.base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const isTop = y < 3 + (rand() < 0.4 ? 1 : 0)
        const c = isTop ? green : dirt
        const b = isTop ? gBase : dBase
        const t = b + (rand() < 0.25 ? -1 : 0)
        put(x, y, c[Math.max(0, Math.min(c.length - 1, t))])
      }
    }
  },
  dirt_path: (put, rand) => {
    const tones = PALETTE.ramps.clay_leather.tones.map(rgb)
    const base = PALETTE.ramps.clay_leather.base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const t = base + (rand() < 0.3 ? -1 : 0) + (rand() < 0.12 ? 1 : 0)
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  },
  dirt_path_side: (put, rand) => {
    const dirt = PALETTE.ramps.clay_leather.tones.map(rgb)
    const dBase = PALETTE.ramps.clay_leather.base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const t = dBase + (rand() < 0.25 ? -1 : 0)
        put(x, y, dirt[Math.max(0, Math.min(dirt.length - 1, y === 0 ? dBase + 1 : t))])
      }
    }
  },
  gravel: (put, rand) => {
    const stone = PALETTE.ramps.stone.tones.map(rgb)
    const ink = PALETTE.ramps.ink.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = rand()
        put(x, y, v < 0.12 ? ink[1] : stone[Math.floor(rand() * stone.length)])
      }
    }
  },
  sand: (put, rand) => {
    const tones = PALETTE.ramps.paper.tones.map(rgb)
    const base = PALETTE.ramps.paper.base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const t = base + (rand() < 0.2 ? -1 : 0)
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  },
  mud: speckle('clay_leather', 19, 0.1),
  water: (put, rand) => {
    const tones = PALETTE.ramps.teal.tones.map(rgb)
    const base = PALETTE.ramps.teal.base

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const wave = Math.sin((x + y) * 0.8) > 0.6
        const c = mix(tones[base], tones[base + 1], wave ? 0.5 : rand() * 0.2)
        put(x, y, [c[0], c[1], c[2], 190])
      }
    }
  },
  moss: (put, rand) => {
    const tones = PALETTE.ramps.sage.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, tones[Math.floor(rand() * 3)])
      }
    }
  },
  mossy_cobble: cobble('stone', 21, true),
  mud_bricks: bricks('clay_leather', 22, 4, 4, 0),

  birch_planks: planks('birch', 30),
  dark_oak_planks: planks('walnut', 31),
  pale_oak_planks: planks('plaster', 32),
  spruce_planks: planks('oak', 33),

  stripped_dark_oak_log: (put, rand) => {
    const tones = PALETTE.ramps.walnut.tones.map(rgb)

    for (let x = 0; x < TILE; x++) {
      const stripe = x % 5 === 0 ? 1 : 0

      for (let y = 0; y < TILE; y++) {
        const t = PALETTE.ramps.walnut.base + stripe + (rand() < 0.1 ? -1 : 0)
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  },
  stripped_dark_oak_log_top: logTop('walnut'),
  birch_log: bark('birch', 41, 3),
  birch_log_top: logTop('birch'),
  oak_log: bark('oak', 42, 4),
  oak_log_top: logTop('oak'),
  dark_oak_log: bark('walnut', 43, 4),
  dark_oak_log_top: logTop('walnut'),
  spruce_log: bark('clay_leather', 44, 4),
  spruce_log_top: logTop('clay_leather'),
  cherry_log: bark('walnut', 45, 4),
  cherry_log_top: logTop('walnut'),
  poplar_log: bark('oak', 46, 3),
  poplar_log_top: logTop('oak'),

  glass: (put, rand) => {
    const frame = rgb(PALETTE.ramps.glass.tones[3])
    const clear: Pixel = [0, 0, 0, 0]
    const glint = rgb(PALETTE.ramps.glass.tones[0])

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1
        const streak = x + y === 9 || (x + y === 10 && x < 5)
        put(x, y, edge ? frame : streak ? glint : clear)
      }
    }
  },
  bookshelf: (put, rand) => {
    const shelf = PALETTE.ramps.oak.tones.map(rgb)
    const bookCols = [PALETTE.colors.clay, PALETTE.colors.teal, PALETTE.colors.brass, PALETTE.colors.sage, PALETTE.colors.clay_dark, PALETTE.colors.cream].map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (y === 0 || y === 7 || y === 8 || y === 15) {
          put(x, y, shelf[PALETTE.ramps.oak.base])

          continue
        }

        const shelfRow = y < 8 ? 0 : 1
        const bookW = 2
        const col = bookCols[Math.floor((x / bookW + shelfRow * 3) % bookCols.length)]
        put(x, y, x % bookW === bookW - 1 ? shelf[shelf.length - 1] : col)
      }
    }
  },
  chiseled_bookshelf: (put, rand) => {
    const bg = PALETTE.ramps.walnut.tones.map(rgb)
    const bookCols = [PALETTE.colors.clay, PALETTE.colors.teal, PALETTE.colors.brass, PALETTE.colors.sage].map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const slotX = Math.floor(x / 5)
        const slotY = Math.floor(y / 5)
        const inner = x % 5 > 0 && x % 5 < 4 && y % 5 > 0 && y % 5 < 4
        put(x, y, inner && rand() < 0.8 ? bookCols[(slotX + slotY * 3) % bookCols.length] : bg[3])
      }
    }
  },
  chiseled_bookshelf_side: noiseFill('walnut', 52, 0.5),
  barrel_top: (put, rand) => {
    const tones = PALETTE.ramps.walnut.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const edge = x < 2 || y < 2 || x > 13 || y > 13
        put(x, y, tones[edge ? 4 : 3])
      }
    }

    put(7, 7, tones[5])
    put(8, 7, tones[5])
    put(7, 8, tones[5])
    put(8, 8, tones[5])
  },
  barrel_side: (put, rand) => {
    const tones = PALETTE.ramps.walnut.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const band = y < 2 || y > 13
        const t = band ? 4 : 3 + (rand() < 0.15 ? -1 : 0)
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  },
  lectern: (put, rand) => {
    const tones = PALETTE.ramps.oak.tones.map(rgb)
    const paper = rgb(PALETTE.colors.paper)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, y < 5 && x > 2 && x < 13 ? paper : tones[2])
      }
    }
  },
  brewing_stand: (put, rand) => {
    const metal = PALETTE.ramps.graphite.tones.map(rgb)
    const teal = rgb(PALETTE.colors.teal)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, y < 4 && x > 5 && x < 10 ? teal : metal[1])
      }
    }
  },
  lantern: (put, rand) => {
    const glow = PALETTE.ramps.glow.tones.map(rgb)
    const frame = rgb(PALETTE.colors.walnut)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const edge = x < 3 || x > 12 || y < 3 || y > 13
        const cap = y < 5 && x > 4 && x < 11

        if (edge && !cap) {
          put(x, y, x < 2 || x > 13 || y > 12 ? frame : clear)

          continue
        }

        const c = glow[Math.floor(rand() * 3)]
        put(x, y, cap ? frame : c)
      }
    }
  },
  iron_chain: (put, rand) => {
    const c = rgb('#8A8A8A')
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const link = Math.floor(y / 4) % 2 === 0
        const inX = link ? x >= 6 && x <= 9 : x >= 7 && x <= 8
        put(x, y, inX ? c : clear)
      }
    }
  },
  copper_chain: (put, rand) => {
    const tones = PALETTE.ramps.copper.tones.map(rgb)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const link = Math.floor(y / 4) % 2 === 0
        const inX = link ? x >= 6 && x <= 9 : x >= 7 && x <= 8
        put(x, y, inX ? tones[2] : clear)
      }
    }
  },
  candle: (put, rand) => {
    const wax = rgb(PALETTE.colors.cream)
    const flame = rgb(PALETTE.ramps.glow.tones[0])
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, clear)
      }
    }

    const sticks = [
      [4, 8],
      [8, 5],
      [11, 9],
    ]

    for (const [sx, sh] of sticks) {
      for (let y = TILE - 1; y >= TILE - sh; y--) {
        put(sx, y, wax)
        put(sx + 1, y, wax)
      }

      put(sx, TILE - sh - 1, flame)
      put(sx + 1, TILE - sh - 1, flame)
    }
  },
  bell: (put, rand) => {
    const tones = PALETTE.ramps.brass.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const t = y < 3 ? 0 : y > 12 ? 4 : 2
        put(x, y, tones[t])
      }
    }
  },
  copper_bulb: (put, rand) => {
    const tones = PALETTE.ramps.copper.tones.map(rgb)
    const glow = rgb(PALETTE.ramps.glow.tones[1])

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const dx = x - 7.5
        const dy = y - 7.5
        const r = Math.sqrt(dx * dx + dy * dy)
        put(x, y, r < 4 ? glow : tones[r < 6 ? 2 : 3])
      }
    }
  },
  copper_rod: (put, rand) => {
    const c = rgb(PALETTE.colors.clay)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, x >= 7 && x <= 8 ? c : clear)
      }
    }
  },
  campfire: (put, rand) => {
    const log = rgb(PALETTE.colors.walnut)
    const fire = PALETTE.ramps.clay.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (y > 11) {
          put(x, y, log)
        } else if (y > 4 && x > 3 && x < 13) {
          put(x, y, fire[Math.floor(rand() * 3)])
        } else {
          put(x, y, [0, 0, 0, 0])
        }
      }
    }
  },
  spruce_trapdoor: (put, rand) => {
    const tones = PALETTE.ramps.oak.tones.map(rgb)
    const dark = tones[4]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const hole = x > 3 && x < 12 && y > 3 && y < 12 && (x % 4 !== 0 || y % 4 !== 0)
        put(x, y, hole && x > 4 && x < 11 && y > 4 && y < 11 ? [0, 0, 0, 0] : tones[x % 5 === 0 || y % 5 === 0 ? 4 : 2])
      }
    }

    void dark
  },
  lily_pad: (put, rand) => {
    const tones = PALETTE.ramps.sage.tones.map(rgb)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const dx = x - 7.5
        const dy = y - 7.5
        const r = Math.sqrt(dx * dx + dy * dy)
        const notch = x > 10 && y > 5 && y < 11
        put(x, y, r < 7.5 && !notch ? tones[Math.floor(rand() * 3)] : clear)
      }
    }
  },
  seagrass: (put, rand) => {
    const tones = PALETTE.ramps.teal.tones.map(rgb)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, clear)
      }
    }

    for (let i = 0; i < 4; i++) {
      const x = 2 + i * 4
      const h = 8 + Math.floor(rand() * 8)

      for (let y = TILE - 1; y > TILE - h; y--) {
        put(x + (y % 3 === 0 ? 1 : 0), y, tones[1 + (i % 2)])
      }
    }
  },

  wool_brown: cloth('clay_leather', 60),
  wool_white: cloth('cream', 61),
  wool_light_gray: cloth('stone', 62),

  oak_leaves: leaves('sage', 70),
  birch_leaves: leaves('sage', 71, 0.24),
  spruce_leaves: leaves('sage', 72, 0.18),
  cherry_leaves: (put, rand) => {
    leaves('sage', 73, 0.2)(put, rand)
    // pink blossom speckle over the green
  },
  azalea_leaves: leaves('sage', 74, 0.16),
  flowering_azalea_leaves: (put, rand) => {
    leaves('sage', 75, 0.16)(put, rand)
  },
  yellow_poplar_leaves: (put, rand) => {
    const tones = PALETTE.ramps.brass.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = rand()

        if (v < 0.22) {
          put(x, y, [0, 0, 0, 0])

          continue
        }

        put(x, y, tones[Math.min(tones.length - 1, 2 + (v < 0.4 ? -1 : v > 0.9 ? 1 : 0))])
      }
    }
  },
  orange_poplar_leaves: (put, rand) => {
    const tones = PALETTE.ramps.clay.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = rand()

        if (v < 0.22) {
          put(x, y, [0, 0, 0, 0])

          continue
        }

        put(x, y, tones[Math.min(tones.length - 1, 1 + (v < 0.4 ? -1 : v > 0.9 ? 1 : 0))])
      }
    }
  },

  short_grass: flower(rgb(PALETTE.ramps.sage.tones[2]), rgb(PALETTE.ramps.sage.tones[2]), 'grass', 80),
  tall_grass: flower(rgb(PALETTE.ramps.sage.tones[1]), rgb(PALETTE.ramps.sage.tones[2]), 'tallgrass', 81),
  fern: flower(rgb(PALETTE.ramps.sage.tones[2]), rgb(PALETTE.ramps.sage.tones[2]), 'fern', 82),
  large_fern: flower(rgb(PALETTE.ramps.sage.tones[3]), rgb(PALETTE.ramps.sage.tones[3]), 'tallgrass', 83),
  bush: (put, rand) => {
    const tones = PALETTE.ramps.sage.tones.map(rgb)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const dx = x - 7.5
        const dy = y - 10
        const r = Math.sqrt(dx * dx * 0.8 + dy * dy)
        put(x, y, r < 6 && rand() < 0.9 ? tones[1 + Math.floor(rand() * 3)] : clear)
      }
    }
  },
  azalea_plant: (put, rand) => {
    const pot = PALETTE.ramps.terracotta.tones.map(rgb)
    const leaf = PALETTE.ramps.sage.tones.map(rgb)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (y > 10 && x > 4 && x < 12) {
          put(x, y, pot[1])
        } else if (y >= 3 && y <= 10 && x > 3 && x < 13) {
          const dx = (x - 8) / 4.5
          const dy = (y - 6) / 4
          put(x, y, dx * dx + dy * dy < 1 ? leaf[1 + Math.floor(rand() * 2)] : clear)
        } else {
          put(x, y, clear)
        }
      }
    }
  },
  flowering_azalea_plant: (put, rand) => {
    PAINTERS.azalea_plant(put, rand)
    const pink = rgb(PALETTE.colors.clay)

    for (let i = 0; i < 6; i++) {
      const x = 4 + Math.floor(rand() * 8)
      const y = 3 + Math.floor(rand() * 7)
      put(x, y, pink)
    }
  },
  poppy: flower(rgb(PALETTE.colors.clay), rgb(PALETTE.ramps.sage.tones[2]), 'single', 90),
  dandelion: flower(rgb(PALETTE.ramps.brass.tones[1]), rgb(PALETTE.ramps.sage.tones[2]), 'ball', 91),
  cornflower: flower(rgb(PALETTE.colors.teal), rgb(PALETTE.ramps.sage.tones[2]), 'single', 92),
  oxeye_daisy: flower(rgb(PALETTE.colors.cream), rgb(PALETTE.ramps.sage.tones[2]), 'single', 93),
  azure_bluet: flower(rgb(PALETTE.colors.paper), rgb(PALETTE.ramps.sage.tones[2]), 'double', 94),
  lily_of_the_valley: flower(rgb(PALETTE.colors.cream), rgb(PALETTE.ramps.sage.tones[2]), 'bells', 95),
  allium: flower(rgb(PALETTE.colors.clay_dark), rgb(PALETTE.ramps.sage.tones[2]), 'ball', 96),
  peony: flower(rgb(PALETTE.colors.clay), rgb(PALETTE.ramps.sage.tones[2]), 'double', 97),
  lilac: flower(rgb(PALETTE.colors.clay), rgb(PALETTE.ramps.sage.tones[2]), 'spray', 98),
  rose_bush: flower(rgb(PALETTE.status.error), rgb(PALETTE.ramps.sage.tones[3]), 'spray', 99),
  pink_petals: (put, rand) => {
    const petal = rgb(PALETTE.colors.clay)
    const light = rgb('#EC9776')
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, clear)
      }
    }

    for (let i = 0; i < 8; i++) {
      const x = 1 + Math.floor(rand() * 13)
      const y = 9 + Math.floor(rand() * 6)
      put(x, y, rand() < 0.5 ? petal : light)
      put(x + 1, y, petal)
      put(x, y + 1, petal)
      put(x + 1, y + 1, rand() < 0.6 ? petal : light)
    }
  },
  wildflowers: (put, rand) => {
    const cols = [rgb(PALETTE.colors.clay), rgb(PALETTE.colors.cream), rgb(PALETTE.ramps.brass.tones[1])]
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, clear)
      }
    }

    for (let i = 0; i < 7; i++) {
      const x = 1 + Math.floor(rand() * 13)
      const y = 10 + Math.floor(rand() * 5)
      const c = cols[Math.floor(rand() * cols.length)]
      put(x, y, c)
      put(x + 1, y, c)
    }
  },
  leaf_litter: (put, rand) => {
    const cols = PALETTE.ramps.oak.tones.map(rgb)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, clear)
      }
    }

    for (let i = 0; i < 10; i++) {
      const x = Math.floor(rand() * 14)
      const y = 11 + Math.floor(rand() * 4)
      put(x, y, cols[2 + Math.floor(rand() * 3)])

      if (rand() < 0.5) {put(x + 1, y, cols[3])}
    }
  },
  firefly_bush: (put, rand) => {
    PAINTERS.bush(put, rand)
    const glow = rgb(PALETTE.ramps.glow.tones[1])

    for (let i = 0; i < 4; i++) {
      put(3 + Math.floor(rand() * 10), 7 + Math.floor(rand() * 8), glow)
    }
  },

  flowerpot: (put, rand) => {
    const pot = PALETTE.ramps.terracotta.tones.map(rgb)
    const clear: Pixel = [0, 0, 0, 0]

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, clear)
      }
    }

    // a terracotta pot, wider rim than base
    for (let y = 6; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const rim = y < 9
        const w = rim ? 11 : 9

        if (x < 8 - w / 2 || x > 7 + w / 2) {continue}
        const t = rim ? 2 : y > 13 ? 3 : 1
        put(x, y, pot[Math.max(0, Math.min(pot.length - 1, t + (rand() < 0.15 ? -1 : 0)))])
      }
    }
  },
  flame: (put, rand) => {
    const clear: Pixel = [0, 0, 0, 0]
    const c1 = rgb('#F8D892')
    const c2 = rgb('#EC9776')
    const c3 = rgb('#C2413B')

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        put(x, y, clear)
      }
    }

    // teardrop flame centred bottom
    for (let y = 4; y < 14; y++) {
      const f = (14 - y) / 10
      const w = 1 + 3 * (1 - f)

      for (let x = 8 - Math.round(w); x <= 7 + Math.round(w); x++) {
        if (rand() < 0.12) {continue}
        put(x, y, f > 0.6 ? c1 : f > 0.3 ? c2 : c3)
      }
    }
  },

  copper_block: (put, rand) => {
    const tones = PALETTE.ramps.copper.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const t = 2 + (rand() < 0.12 ? -1 : 0) + (rand() < 0.08 ? 1 : 0)
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  },
  cut_copper: (put, rand) => {
    const tones = PALETTE.ramps.copper.tones.map(rgb)

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const tile = (Math.floor(x / 8) + Math.floor(y / 8)) % 2
        const seam = x % 8 === 7 || y % 8 === 7
        const t = seam ? 4 : 2 + tile + (rand() < 0.1 ? -1 : 0)
        put(x, y, tones[Math.max(0, Math.min(tones.length - 1, t))])
      }
    }
  },
}

// ------------------------------------------------------------------ atlas

export const AC_BLOCKS = [
  'plaster_panel',
  'plaster_frame',
  'walnut_panel',
  'walnut_trim',
  'terracotta_tile',
  'oak_parquet',
  'glow_panel',
  'monitor_back',
  'monitor_frame',
  'monitor_screen_on',
  'monitor_side',
  'task_board_back',
  'task_board_frame',
  'task_board_surface',
  'decision_podium_front',
  'decision_podium_base',
  'decision_podium_column',
  'decision_podium_top',
  'merge_station_front',
  'merge_station_side',
  'merge_station_top',
  'memory_archive_front',
  'memory_archive_side',
  'memory_archive_top',
  'memory_catalog_front',
  'console_front',
  'console_side',
  'console_top',
  'status_lamp_idle',
  'status_lamp_thinking',
  'status_lamp_working',
  'status_lamp_waiting',
  'status_lamp_error',
  'status_lamp_done',
  'status_lamp_off',
]

export const AC_LAMP_TILE: Record<number, string> = {
  0: 'ac:status_lamp_off',
  1: 'ac:status_lamp_idle',
  2: 'ac:status_lamp_thinking',
  3: 'ac:status_lamp_working',
  4: 'ac:status_lamp_waiting',
  5: 'ac:status_lamp_error',
  6: 'ac:status_lamp_done',
}

export const LAMP_EMISSIVE_TILE: Record<number, string> = {
  1: 'ac:status_lamp_idle_emissive',
  2: 'ac:status_lamp_thinking_emissive',
  3: 'ac:status_lamp_working_emissive',
  4: 'ac:status_lamp_waiting_emissive',
  5: 'ac:status_lamp_error_emissive',
  6: 'ac:status_lamp_done_emissive',
}

export const AC_EXTRA = [
  'status_lamp_idle_emissive',
  'status_lamp_thinking_emissive',
  'status_lamp_working_emissive',
  'status_lamp_waiting_emissive',
  'status_lamp_error_emissive',
  'status_lamp_done_emissive',
  'status_lamp_cap',
  'decision_podium_front_lit',
  'decision_podium_top_lit',
  'monitor_screen_off',
]

const blockUrls: Record<string, string> = import.meta.glob('./assets/block/*.png', { eager: true, query: '?url', import: 'default' })
const vanillaUrls: Record<string, string> = import.meta.glob('./assets/vanilla/*.png', { eager: true, query: '?url', import: 'default' })

function acUrl(name: string): string | null {
  const key = `./assets/block/${name}.png`

  return blockUrls[key] ?? null
}

function vanillaUrl(name: string): string | null {
  const key = `./assets/vanilla/${name}.png`

  return vanillaUrls[key] ?? null
}

export interface Atlas {
  canvas: HTMLCanvasElement
  /** uv rect per tile key: [u0, v0, u1, v1] */
  uv: Map<string, [number, number, number, number]>
}

/**
 * Build the atlas: every PAINTERS tile + every AC block PNG. Returns a canvas
 * + uv rects keyed by tile name; async because PNGs decode off-thread.
 */
export async function buildAtlas(): Promise<Atlas> {
  const keys = [...Object.keys(PAINTERS), ...AC_BLOCKS.map(n => `ac:${n}`), ...AC_EXTRA.map(n => `ac:${n}`)]
  const cols = Math.ceil(Math.sqrt(keys.length))
  const rows = Math.ceil(keys.length / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * TILE
  canvas.height = rows * TILE
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const uv = new Map<string, [number, number, number, number]>()

  const jobs: Promise<void>[] = []
  keys.forEach((key, i) => {
    const tx = (i % cols) * TILE
    const ty = Math.floor(i / cols) * TILE
    uv.set(key, [tx / canvas.width, ty / canvas.height, (tx + TILE) / canvas.width, (ty + TILE) / canvas.height])

    const url = key.startsWith('ac:') ? acUrl(key.slice(3)) : vanillaUrl(key)

    if (url) {
      jobs.push(
        new Promise<void>(resolve => {
          const img = new Image()

          img.onload = () => {
            ctx.drawImage(img, tx, ty, TILE, TILE)
            resolve()
          }

          img.onerror = () => resolve()
          img.src = url
        }),
      )

      return
    }

    const img = ctx.createImageData(TILE, TILE)
    const painter = PAINTERS[key]
    painter((x, y, c) => {
      const o = (y * TILE + x) * 4
      img.data[o] = c[0]
      img.data[o + 1] = c[1]
      img.data[o + 2] = c[2]
      img.data[o + 3] = c[3]
    }, makeRand(key.length * 31 + 7))
    ctx.putImageData(img, tx, ty)
  })
  await Promise.all(jobs)

  return { canvas, uv }
}
