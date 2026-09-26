import type { StarmapLiveRef } from '@/store/starmap-live'

import { rgba } from './color'
import { TILT } from './constants'
import { clamp, fitScale, hash, nodeRadius } from './geometry'
import type { Palette, Ring, SimNode, Viewport } from './types'

// Live-mode overlay: per-frame activity drawn on the composite pass (never the
// cached static layer), so pulses + settle flashes animate without invalidating
// the scene. A node's id IS its skill name, which is how `live` keys resolve.

/** One settle flash: expanding ring, ~1.5s from ignition to fade. */
const SETTLE_MS = 1500
/** Busy pulse loop period — slow enough to read as breathing, not a blink. */
const PULSE_MS = 1800

export interface LiveOverlay {
  ctx: CanvasRenderingContext2D
  dpr: number
  /** node id → perf.now() the settle flash ignited (mutated as flashes expire). */
  fx: Map<string, number>
  /** skill name → the session currently attributed to it ("" entries skipped). */
  live: ReadonlyMap<string, StarmapLiveRef>
  nodes: readonly SimNode[]
  palette: Palette
  reveal: number
  rings: Ring[]
  /** Store-side skill → settle timestamp; entries newer than `settleSeen`
   *  ignite a flash in `fx`. */
  settleSeen: Map<string, number>
  settles: Readonly<Record<string, number>>
  size: { h: number; w: number }
  vp: Viewport
}

export function drawLiveOverlay({
  ctx,
  dpr,
  fx,
  live,
  nodes,
  palette,
  reveal,
  rings,
  settleSeen,
  settles,
  size,
  vp
}: LiveOverlay): void {
  const now = performance.now()

  // Fresh settle marks ignite a flash on that node.
  for (const [skill, settledAt] of Object.entries(settles)) {
    if ((settleSeen.get(skill) ?? 0) < settledAt) {
      settleSeen.set(skill, settledAt)
      fx.set(skill, now)
    }
  }

  const { primary } = palette
  const projX = (wx: number) => wx * vp.k + vp.x
  const projY = (wy: number) => wy * vp.k * TILT + vp.y
  const nodeK = fitScale(size.w, size.h, rings)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  for (const n of nodes) {
    // The scrubber still gates: an unrevealed node never pulses.
    if (n.rec > reveal + 1e-3) {
      continue
    }

    const ref = live.get(n.id)
    const settleStart = fx.get(n.id)

    if (!ref && settleStart == null) {
      continue
    }

    const sx = projX(n.x)
    const sy = projY(n.y)
    const r = nodeRadius(n) * nodeK
    // Per-node phase so two busy skills never pulse in lockstep.
    const phase = (hash(n.id) % 1000) / 1000

    if (ref?.busy) {
      // Sonar ping: a ring expanding out of the node on a loop + a breathing
      // under-ring so the node itself visibly works between pings.
      const p = (now / PULSE_MS + phase) % 1
      const pingR = r + 3 + p * (r * 1.4 + 14)
      const pingA = (1 - p) * (1 - p) * 0.5

      if (pingA > 0.01) {
        ctx.strokeStyle = rgba(primary, pingA)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(sx, sy, pingR, 0, Math.PI * 2)
        ctx.stroke()
      }

      const breathe = 0.28 + 0.2 * Math.sin((now / PULSE_MS + phase) * Math.PI * 2)
      ctx.strokeStyle = rgba(primary, breathe)
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(sx, sy, r + 2.5, 0, Math.PI * 2)
      ctx.stroke()
    } else if (ref?.needsInput) {
      // Waiting on the user: a steady double ring that blinks slowly — calm
      // (no motion outward) but hard to miss.
      const a = 0.4 + 0.25 * Math.sin(now / 1100 + phase * Math.PI * 2)

      ctx.strokeStyle = rgba(primary, a)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(sx, sy, r + 4, 0, Math.PI * 2)
      ctx.stroke()

      ctx.strokeStyle = rgba(primary, a * 0.4)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(sx, sy, r + 7.5, 0, Math.PI * 2)
      ctx.stroke()
    }

    if (settleStart != null) {
      const age = now - settleStart

      if (age < SETTLE_MS) {
        // One-shot landing flash: fast bright expansion that dies out.
        const p = clamp(age / SETTLE_MS, 0, 1)

        ctx.strokeStyle = rgba(primary, (1 - p) * 0.75)
        ctx.lineWidth = 2 - p
        ctx.beginPath()
        ctx.arc(sx, sy, r + 4 + p * (r * 2 + 26), 0, Math.PI * 2)
        ctx.stroke()
      } else {
        fx.delete(n.id)
      }
    }
  }
}
