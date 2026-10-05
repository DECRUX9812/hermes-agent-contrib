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

  it('softens the strip top and bottom too, without dimming its core', () => {
    const centre = Math.floor(SEAM_TEXTURE_WIDTH / 2)

    expect(at(centre, 0)).toBe(0)
    expect(at(centre, SEAM_TEXTURE_HEIGHT - 1)).toBe(0)
    expect(at(centre, middle)).toBe(255)

    // The strip draws ~3 px tall, so only about three rows are ever sampled.
    // They have to stay bright: a full-height cosine would put the outer two at
    // ~0.3 and halve the seam's brightness on screen.
    const sampled = [1 / 6, 3 / 6, 5 / 6].map(v => at(centre, Math.round(v * (SEAM_TEXTURE_HEIGHT - 1))))

    for (const alpha of sampled) {
      expect(alpha).toBeGreaterThan(150)
    }
  })

  it('stays soft at the width the seam is actually drawn', () => {
    // 73 px is what the 1.6-unit seam measured on screen at 1920×1080 during a
    // held emergence — the resolution a viewer judges the ends at.
    const columns = 73

    const sampled = Array.from({ length: columns }, (_, i) =>
      at(Math.round((i * (SEAM_TEXTURE_WIDTH - 1)) / (columns - 1)), middle)
    )

    const peak = Math.max(...sampled)

    // Ends well below the core, with no flat plateau: a hard bar starts at full
    // brightness in its very first column (the old flat plane measured 219/255
    // one pixel in).
    expect(sampled[0]).toBeLessThan(peak * 0.25)
    expect(sampled[columns - 1]).toBeLessThan(peak * 0.25)
    expect(sampled[1]).toBeLessThan(peak * 0.4)
    expect(sampled[columns - 2]).toBeLessThan(peak * 0.4)
    expect(sampled[Math.floor(columns / 2)]).toBe(peak)
  })

  it('tapers as a fraction of the length, so the shape scales with the bloom width', () => {
    // The seam plane blooms from 1.6 units to 0; the texture stretches across
    // whatever width it is drawn at. A taper expressed as a fraction of the
    // length resamples to the same shape at any resolution — a fixed-pixel end
    // taper would harden as the seam narrowed. Sample two very different texture
    // widths and require the normalized profiles to agree.
    const sampleAtFraction = (width: number, u: number) =>
      seamAlphaProfile(width, SEAM_TEXTURE_HEIGHT)[middle * width + Math.round(u * (width - 1))]

    for (const u of [0, 0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 0.95]) {
      // Tolerance covers the texel rounding at each width; a fixed-pixel taper
      // would differ by tens of alpha units, not single digits.
      expect(sampleAtFraction(64, u), `alpha at u=${u}`).toBeCloseTo(sampleAtFraction(SEAM_TEXTURE_WIDTH, u), -1)
    }

    // The end taper, measured in texels, grows with the strip: 5% in is still
    // near zero at 64 texels and at 256.
    expect(sampleAtFraction(64, 0.05)).toBeLessThan(32)
    expect(sampleAtFraction(SEAM_TEXTURE_WIDTH, 0.05)).toBeLessThan(32)
  })
})
