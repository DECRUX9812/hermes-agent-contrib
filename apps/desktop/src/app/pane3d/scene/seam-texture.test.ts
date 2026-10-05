import { describe, expect, it } from 'vitest'

import { SEAM_TEXTURE_HEIGHT, SEAM_TEXTURE_WIDTH, seamAlphaAt, seamAlphaProfile } from './seam-texture'

const CENTRE_V = 0.5

describe('seamAlphaAt', () => {
  it('is zero on every edge and one at the centre', () => {
    expect(seamAlphaAt(0, CENTRE_V)).toBe(0)
    expect(seamAlphaAt(1, CENTRE_V)).toBe(0)
    expect(seamAlphaAt(0.5, 0)).toBe(0)
    expect(seamAlphaAt(0.5, 1)).toBe(0)
    expect(seamAlphaAt(0.5, 0.5)).toBe(1)
  })

  it('falls off smoothly from the centre to each end', () => {
    let previous = 0

    for (let u = 0; u <= 0.5; u += 0.05) {
      const alpha = seamAlphaAt(u, CENTRE_V)

      expect(alpha).toBeGreaterThanOrEqual(previous)
      previous = alpha
    }

    // A hard bar would keep alpha 1 right up to the edge; this one is well down
    // a quarter of the way in and still has body in the middle.
    expect(seamAlphaAt(0.25, CENTRE_V)).toBeLessThan(0.7)
    expect(seamAlphaAt(0.25, CENTRE_V)).toBeGreaterThan(0.4)
  })
})

describe('seamAlphaProfile', () => {
  const profile = seamAlphaProfile()
  const at = (x: number, y: number) => profile[y * SEAM_TEXTURE_WIDTH + x]
  const middle = Math.floor(SEAM_TEXTURE_HEIGHT / 2)

  it('is a full-size, horizontally symmetric RGBA alpha grid', () => {
    expect(profile).toHaveLength(SEAM_TEXTURE_WIDTH * SEAM_TEXTURE_HEIGHT)

    for (let x = 0; x < SEAM_TEXTURE_WIDTH; x += 1) {
      expect(at(x, middle)).toBe(at(SEAM_TEXTURE_WIDTH - 1 - x, middle))
    }

    expect(Math.max(...profile)).toBeLessThanOrEqual(255)
    expect(Math.min(...profile)).toBeGreaterThanOrEqual(0)
  })

  it('reaches full brightness in the middle and fades to nothing at the ends', () => {
    expect(at(Math.floor(SEAM_TEXTURE_WIDTH / 2), middle)).toBe(255)
    expect(at(0, middle)).toBe(0)
    expect(at(SEAM_TEXTURE_WIDTH - 1, middle)).toBe(0)

    // No hard rectangular end: the first and last few columns are near zero.
    for (const x of [1, 2, 3, SEAM_TEXTURE_WIDTH - 2, SEAM_TEXTURE_WIDTH - 4]) {
      expect(at(x, middle)).toBeLessThan(16)
    }
  })

  it('softens the strip top and bottom too', () => {
    expect(at(Math.floor(SEAM_TEXTURE_WIDTH / 2), 0)).toBe(0)
    expect(at(Math.floor(SEAM_TEXTURE_WIDTH / 2), SEAM_TEXTURE_HEIGHT - 1)).toBe(0)
    expect(at(Math.floor(SEAM_TEXTURE_WIDTH / 2), middle)).toBeGreaterThan(at(Math.floor(SEAM_TEXTURE_WIDTH / 2), 2))
  })
})
