import { describe, expect, it } from 'vitest'

import { drawScene, type Scene } from './render'
import type { FadeBuckets, Palette, SimNode } from './types'

/**
 * The canvas is the one part of find-on-map a component test cannot see, so this
 * drives drawScene with a recording 2D context and asserts the search ring is
 * actually stroked — and that it is absent when there is no search. It is the
 * regression guard for "the counter says 3 hits but nothing is drawn".
 */

type Stroke = { style: string; width: number }

const makeCtx = () => {
  const strokes: Stroke[] = []
  const target: Record<string, unknown> = { lineWidth: 1, strokeStyle: '' }

  const ctx = new Proxy(target, {
    get(obj, prop: string) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => {} })
      }

      if (prop === 'createPattern') {
        return () => null
      }

      if (prop === 'getImageData') {
        return () => ({ data: new Uint8ClampedArray(4) })
      }

      if (prop === 'measureText') {
        return () => ({ width: 10 })
      }

      if (prop === 'stroke') {
        return () => strokes.push({ style: String(obj.strokeStyle), width: Number(obj.lineWidth) })
      }

      if (prop in obj) {
        return obj[prop]
      }

      return () => undefined
    },
    set(obj, prop: string, value) {
      obj[prop] = value

      return true
    }
  })

  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes }
}

const palette: Palette = {
  bandInk: { b: 9, g: 8, r: 7 },
  base: { b: 255, g: 255, r: 255 },
  bg: { b: 0, g: 0, r: 0 },
  c: { lineAlpha: 0.2, lineDash: 0, lineDashed: false, lineWidth: 1, ringAlpha: 0.2, ringDash: 0, ringDashed: false, ringWidth: 1 },
  chipBg: 'rgba(0,0,0,0.5)',
  darkTheme: true,
  inkInv: 'rgba(0,0,0,1)',
  memoryInk: { b: 30, g: 20, r: 10 },
  // A colour nothing else in the scene uses, so the search ring is findable.
  primary: { b: 3, g: 2, r: 1 },
  skillInk: { b: 60, g: 50, r: 40 }
}

const node = (id: string, x: number, y: number): SimNode => ({
  category: 'test',
  createdBy: null,
  id,
  kind: 'memory',
  label: id,
  outerRingIndex: 0,
  pinned: false,
  rec: 1,
  state: 'used',
  timestamp: 1,
  tr: 60,
  useCount: 1,
  x,
  y
})

const fades: FadeBuckets = {
  appear: new Map(),
  labels: new Map(),
  links: new Map(),
  nodes: new Map(),
  rings: new Map()
}

const scene = (matchIds?: Set<string>): Scene => {
  const nodes = [node('a', 40, 40), node('b', -40, -40)]

  return {
    adjacency: new Map(),
    byId: new Map(nodes.map(n => [n.id, n])),
    ctx: makeCtx().ctx,
    dpr: 1,
    fades,
    focusId: null,
    hoverId: null,
    hoverLink: null,
    hoverRing: null,
    links: [],
    matchIds,
    memById: new Map(),
    nodes,
    palette,
    reveal: 1,
    rings: [{ label: null, r: 100, ratio: 1 }],
    selectedRing: null,
    size: { h: 400, w: 400 },
    vp: { k: 1, x: 200, y: 200 }
  }
}

const searchStrokes = (strokes: Stroke[]) => strokes.filter(s => s.style.includes('rgba(1,2,3'))

describe('drawScene — find-on-map rings', () => {
  it('draws one accent ring per matching node', () => {
    const { ctx, strokes } = makeCtx()
    const s = { ...scene(new Set(['a'])), ctx }

    drawScene(s)

    const rings = searchStrokes(strokes)

    expect(rings).toHaveLength(1)
    expect(rings[0].style).toBe('rgba(1,2,3,0.9)')
    // Outside the focus ring (r + 4), so a hit that is also selected still reads.
    expect(rings[0].width).toBe(1.2)
  })

  it('rings every hit, not just the first', () => {
    const { ctx, strokes } = makeCtx()
    const s = { ...scene(new Set(['a', 'b'])), ctx }

    drawScene(s)

    expect(searchStrokes(strokes)).toHaveLength(2)
  })

  it('draws nothing extra when there is no search', () => {
    const empty = makeCtx()
    drawScene({ ...scene(), ctx: empty.ctx })
    expect(searchStrokes(empty.strokes)).toHaveLength(0)

    const cleared = makeCtx()
    drawScene({ ...scene(new Set()), ctx: cleared.ctx })
    expect(searchStrokes(cleared.strokes)).toHaveLength(0)
  })

  it('does not ring a node that has not been revealed yet', () => {
    const { ctx, strokes } = makeCtx()
    // Scrub back before the nodes exist: a hit cannot be drawn on an empty map.
    drawScene({ ...scene(new Set(['a', 'b'])), ctx, reveal: 0 })

    expect(searchStrokes(strokes)).toHaveLength(0)
  })
})
