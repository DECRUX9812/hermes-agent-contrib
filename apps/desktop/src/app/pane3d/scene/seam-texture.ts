/**
 * The emergence seam's alpha falloff (§8.4).
 *
 * The seam is a thin additive plane whose width blooms from 1.6 units to 0
 * over 450 ms. A flat plane with hard ends reads as a bright rectangular bar,
 * not as light on the window edge. This module generates the alpha profile in
 * code — no image assets, nothing fetched — so the ends fall smoothly to zero
 * and the bar reads as a bloom.
 *
 * The profile is pure data; `createSeamTexture` only paints and samples it.
 * Keeping the shape here lets it be asserted without a WebGL context.
 */

import * as THREE from 'three'

export const SEAM_TEXTURE_WIDTH = 256
export const SEAM_TEXTURE_HEIGHT = 16
/** Below 1 widens the bright core; the ends still reach exactly 0. */
export const SEAM_FALLOFF_GAMMA = 0.75
/** Fraction of the strip's height spent fading into its top and bottom edges. */
export const SEAM_VERTICAL_EDGE = 0.22

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Hermite ease, flat at both ends: used so the thin axis keeps a solid core. */
function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0))

  return t * t * (3 - 2 * t)
}

/**
 * Alpha at normalized texture coords: 0 on every edge, 1 at the centre.
 *
 * The raised cosine across the length keeps the ends soft without a visible
 * step. Written as `(1 - cos 2πx)/2` rather than `sin²(πx)` because it is
 * *exactly* 0 at the ends instead of 1e-24.
 *
 * The thin axis uses a flat-topped ease instead of the same cosine: the strip
 * is only ~3 px tall on screen, so a full-height cosine would be sampled almost
 * entirely in its dark half and dim the seam by ~2×.
 */
export function seamAlphaAt(u: number, v: number): number {
  const across = (1 - Math.cos(2 * Math.PI * clamp01(u))) / 2
  const up = smoothstep(0, SEAM_VERTICAL_EDGE, clamp01(v)) * smoothstep(0, SEAM_VERTICAL_EDGE, 1 - clamp01(v))

  return clamp01(across ** SEAM_FALLOFF_GAMMA * up)
}

/** Row-major alpha values (0..255) for the seam's gradient texture. */
export function seamAlphaProfile(width = SEAM_TEXTURE_WIDTH, height = SEAM_TEXTURE_HEIGHT): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height)
  const spanX = Math.max(1, width - 1)
  const spanY = Math.max(1, height - 1)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = Math.round(255 * seamAlphaAt(x / spanX, y / spanY))
    }
  }

  return out
}

/** White RGB with the generated alpha — the material's color tints it. */
export function createSeamTexture(): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas')

  canvas.width = SEAM_TEXTURE_WIDTH
  canvas.height = SEAM_TEXTURE_HEIGHT
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return null
  }

  const alpha = seamAlphaProfile()
  const image = ctx.createImageData(SEAM_TEXTURE_WIDTH, SEAM_TEXTURE_HEIGHT)

  for (let i = 0; i < alpha.length; i += 1) {
    image.data[i * 4] = 255
    image.data[i * 4 + 1] = 255
    image.data[i * 4 + 2] = 255
    image.data[i * 4 + 3] = alpha[i]
  }

  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)

  // Never mip this texture. The strip is ~3 px tall on screen, so the vertical
  // minification picks a coarse mip level for the whole sample and averages the
  // long falloff into a flat bar with ~5 px ends — the exact hard-ended look
  // this profile exists to remove (measured: the drawn seam matched mip level 4
  // instead of the texture). The gradient is smooth, so plain bilinear sampling
  // has nothing to alias.
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.colorSpace = THREE.SRGBColorSpace

  return texture
}
