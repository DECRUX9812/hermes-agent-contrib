import { describe, expect, it } from 'vitest'

import {
  CELEBRATE_MS,
  CELEBRATE_RISE,
  type ChoreographyInput,
  choreographyPose,
  EMERGE_MS,
  HIDE_MS,
  REDUCED_MS,
  REDUCED_RISE,
  SEAM_MS,
  SEAM_OPACITY,
  SEAM_WIDTH,
  springProgress
} from './choreography'

const HEIGHT = 1.14
const PERCH_Y = 3
const REST_Y = PERCH_Y + HEIGHT / 2

const base: Omit<ChoreographyInput, 'elapsedMs' | 'phase' | 'reducedMotion'> = {
  height: HEIGHT,
  perchY: PERCH_Y,
  restY: REST_Y
}

const pose = (input: Partial<ChoreographyInput> & Pick<ChoreographyInput, 'phase' | 'elapsedMs'>) =>
  choreographyPose({ ...base, reducedMotion: false, ...input })

/** World y of the avatar's crown — the part that must stay under the clip plane. */
const crownY = (yOffset: number) => REST_Y + yOffset + HEIGHT / 2

describe('choreographyPose — full-motion emergence (§8.4)', () => {
  it('starts fully below the edge and springs to the perch', () => {
    expect(crownY(pose({ elapsedMs: 0, phase: 'emerging' }).yOffset)).toBeLessThan(PERCH_Y)
    expect(pose({ elapsedMs: 0, phase: 'emerging' }).yOffset).toBeLessThan(0)

    const landed = pose({ elapsedMs: EMERGE_MS, phase: 'emerging' })
    expect(landed.yOffset).toBeCloseTo(0, 10)
    expect(landed.scale).toBeCloseTo(1, 10)
    expect(landed.shadow).toBeCloseTo(1, 10)
    expect(landed.fade).toBe(1)
  })

  it('keeps the seam width and opacity above zero at 250 ms and 400 ms, and at zero from 500 ms', () => {
    for (const elapsedMs of [250, 400]) {
      const { seam } = pose({ elapsedMs, phase: 'emerging' })

      expect(seam, `seam envelope at ${elapsedMs} ms`).toBeGreaterThan(0)
      expect(SEAM_WIDTH * seam, `seam width at ${elapsedMs} ms`).toBeGreaterThan(0)
      expect(SEAM_OPACITY * seam, `seam opacity at ${elapsedMs} ms`).toBeGreaterThan(0)
    }

    for (const elapsedMs of [SEAM_MS, 500, EMERGE_MS]) {
      expect(pose({ elapsedMs, phase: 'emerging' }).seam, `seam at ${elapsedMs} ms`).toBe(0)
    }
  })

  it('samples the sparse 0/200/500 ms frame timeline without leaving the avatar above the edge', () => {
    // Software GL may only land a handful of frames across the whole motion; the pose
    // must be a pure function of elapsed time, never of how often it was stepped.
    const yOffsets = [0, 200, 500].map(elapsedMs => pose({ elapsedMs, phase: 'emerging' }).yOffset)

    expect(yOffsets[0]).toBeLessThan(yOffsets[1])
    expect(yOffsets[1]).toBeLessThan(yOffsets[2])
    expect(crownY(yOffsets[0])).toBeLessThan(PERCH_Y) // starts under the edge…
    expect(crownY(yOffsets[2])).toBeGreaterThan(PERCH_Y) // …and is rising into view by 500 ms
  })
})

describe('choreographyPose — full-motion hide (§8.4)', () => {
  it('is fully below the perch line at the 500 ms deadline, however sparsely it was sampled', () => {
    const hideAt = (elapsedMs: number) => pose({ elapsedMs, phase: 'hiding' })

    // Only three frames run: 0, 200 and the deadline itself.
    expect(hideAt(0).yOffset).toBeCloseTo(0, 10)
    expect(crownY(hideAt(200).yOffset)).toBeLessThan(PERCH_Y + HEIGHT) // still partly visible mid-sink

    const deadline = hideAt(HIDE_MS)
    expect(deadline.yOffset).toBeLessThan(-HEIGHT) // the whole body is below the resting centre
    expect(crownY(deadline.yOffset)).toBeLessThan(PERCH_Y) // and under the perch line
    expect(hideAt(HIDE_MS + 300).yOffset).toBe(deadline.yOffset) // clamped past the deadline
  })

  it('sinks monotonically, with the contact shadow fading out', () => {
    let previous = Infinity

    for (let elapsedMs = 0; elapsedMs <= HIDE_MS; elapsedMs += 25) {
      const { shadow, yOffset } = pose({ elapsedMs, phase: 'hiding' })

      expect(yOffset).toBeLessThanOrEqual(previous)
      previous = yOffset
      expect(shadow).toBeGreaterThanOrEqual(0)
      expect(shadow).toBeLessThanOrEqual(1)
    }
  })
})

describe('choreographyPose — reduced motion (§8.4, VAL-EMERGE-005)', () => {
  it('rises exactly 0.1 units and fades 0 → 1 over 250 ms emergence', () => {
    const start = pose({ elapsedMs: 0, phase: 'emerging', reducedMotion: true })
    const end = pose({ elapsedMs: REDUCED_MS, phase: 'emerging', reducedMotion: true })

    expect(start.yOffset).toBeCloseTo(-REDUCED_RISE, 10)
    expect(end.yOffset).toBe(0)
    expect(end.yOffset - start.yOffset).toBeCloseTo(0.1, 10)
    expect(start.fade).toBe(0)
    expect(end.fade).toBe(1)
    expect(end.scale).toBe(1)
    expect(start.seam).toBe(0)
    expect(end.seam).toBe(0)
  })

  it('sinks exactly 0.1 units and fades 1 → 0 over 250 ms hiding', () => {
    const start = pose({ elapsedMs: 0, phase: 'hiding', reducedMotion: true })
    const end = pose({ elapsedMs: REDUCED_MS, phase: 'hiding', reducedMotion: true })

    expect(start.yOffset).toBe(0)
    expect(end.yOffset).toBeCloseTo(-REDUCED_RISE, 10)
    expect(end.fade).toBe(0)
    expect(start.fade).toBe(1)
    expect(end.scale).toBe(1)
  })

  it('never draws more than 0.1 units below the perch', () => {
    for (const phase of ['emerging', 'hiding'] as const) {
      for (let elapsedMs = 0; elapsedMs <= REDUCED_MS; elapsedMs += 10) {
        const { yOffset } = pose({ elapsedMs, phase, reducedMotion: true })

        expect(-yOffset).toBeLessThanOrEqual(REDUCED_RISE + 1e-9)
      }
    }
  })
})

describe('choreographyPose — celebration (§8.4)', () => {
  it('rises at most 0.08 with a single roll that returns to zero by 900 ms', () => {
    const frames = Array.from({ length: CELEBRATE_MS / 25 + 1 }, (_, index) =>
      pose({ elapsedMs: index * 25, phase: 'celebrating' })
    )

    const maxRise = Math.max(...frames.map(frame => frame.yOffset))
    expect(maxRise).toBeGreaterThan(0)
    expect(maxRise).toBeLessThanOrEqual(CELEBRATE_RISE + 1e-9)

    const rolls = frames.map(frame => frame.rotationZ)
    const peak = Math.max(...rolls)
    expect(peak).toBeGreaterThan(0) // a few degrees of roll, not zero
    expect(peak).toBeLessThan((10 * Math.PI) / 180)
    // One oscillation: a single positive hump, no second lobe.
    expect(Math.min(...rolls)).toBeGreaterThanOrEqual(0)
    expect(rolls.filter(roll => roll === peak)).toHaveLength(1)
    expect(frames[0].rotationZ).toBeCloseTo(0, 10)
    expect(frames[frames.length - 1].rotationZ).toBeCloseTo(0, 10)

    // A glow pulse rides the same gesture.
    expect(Math.max(...frames.map(frame => frame.accentPulse))).toBeGreaterThan(0.9)
    expect(frames[0].accentPulse).toBeCloseTo(0, 10)
    expect(frames[frames.length - 1].accentPulse).toBeCloseTo(0, 10)
  })

  it('is an immediate rest pose under reduced motion', () => {
    const poseAt = (elapsedMs: number) => pose({ elapsedMs, phase: 'celebrating', reducedMotion: true })

    expect(poseAt(0)).toEqual(poseAt(CELEBRATE_MS))
    expect(poseAt(0).yOffset).toBe(0)
    expect(poseAt(0).rotationZ).toBe(0)
    expect(poseAt(0).accentPulse).toBe(0)
  })
})

describe('choreographyPose — rest', () => {
  it('is the identity pose', () => {
    const rest = pose({ elapsedMs: 0, phase: 'rest' })

    expect(rest).toEqual(pose({ elapsedMs: 10_000, phase: 'rest' }))
    expect(rest).toEqual({ accentPulse: 0, fade: 1, rotationZ: 0, scale: 1, seam: 0, shadow: 1, yOffset: 0 })
  })
})

describe('springProgress', () => {
  it('is zero at the start, clamped to one at the deadline, with a single small overshoot', () => {
    expect(springProgress(0, EMERGE_MS)).toBe(0)
    expect(springProgress(EMERGE_MS, EMERGE_MS)).toBe(1)

    const samples = Array.from({ length: 200 }, (_, index) => springProgress((index / 200) * EMERGE_MS, EMERGE_MS))

    expect(Math.max(...samples)).toBeGreaterThan(1) // it overshoots…
    expect(Math.max(...samples)).toBeLessThan(1.1) // …by roughly 4%, never wildly
  })
})
