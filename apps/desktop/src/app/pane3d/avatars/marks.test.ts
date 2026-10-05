import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { BRAND_MARKS, getMarkGeometry } from './marks'

const MARK_IDS = ['claude', 'opencode', 'x'] as const

describe('brand marks', () => {
  it('carries the salvaged vector paths for the three brand marks', () => {
    for (const id of MARK_IDS) {
      expect(BRAND_MARKS[id].viewBox, `${id} viewBox`).toBe(24)
      expect(BRAND_MARKS[id].d.length, `${id} path data`).toBeGreaterThan(20)
      expect(BRAND_MARKS[id].color, `${id} color`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('extrudes each mark into a centered, size-normalized, beveled slab', () => {
    for (const id of MARK_IDS) {
      const geometry = getMarkGeometry(id, { size: 1 })

      geometry.computeBoundingBox()
      const box = geometry.boundingBox

      expect(box, `${id} bounds`).not.toBeNull()

      const size = box!.getSize(new THREE.Vector3())
      const center = box!.getCenter(new THREE.Vector3())

      // Longest side is exactly the requested size; the slab has real depth.
      expect(Math.max(size.x, size.y), `${id} longest side`).toBeCloseTo(1, 4)
      expect(size.z, `${id} depth`).toBeGreaterThan(0.05)
      // Centered on the origin so a body can place it without offsets.
      expect(center.length(), `${id} centered`).toBeLessThan(1e-4)
      expect(geometry.getAttribute('position'), `${id} positions`).toBeDefined()
    }
  })

  it('memoizes geometry per (mark, size, depth, bevel)', () => {
    expect(getMarkGeometry('claude', { size: 0.3 })).toBe(getMarkGeometry('claude', { size: 0.3 }))
    expect(getMarkGeometry('claude', { size: 0.3 })).not.toBe(getMarkGeometry('claude', { size: 0.4 }))
    expect(getMarkGeometry('x', { size: 0.4 })).not.toBe(getMarkGeometry('claude', { size: 0.4 }))
  })
})
