import { forwardRef, useMemo } from 'react'
import * as THREE from 'three'

import { SEAM_WIDTH } from './choreography'

/**
 * The signature entrance (architecture §8.4): a shared horizontal clipping
 * plane at the perch edge, an additive light seam that blooms along it, and a
 * soft blob contact shadow. Avatars rise through the plane, so their lower half
 * is genuinely clipped rather than faded — they come OUT of the surface.
 *
 * One pane, one perch line, one plane: a module singleton keeps every body's
 * materials clipped by the same edge without threading a context through each
 * avatar definition.
 */
export const EMERGENCE_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
export const EMERGENCE_CLIPPING_PLANES: THREE.Plane[] = [EMERGENCE_PLANE]

/** Keeps world y >= perchY (three clips fragments where normal·p + c < 0). */
export function setEmergenceEdge(perchY: number): void {
  EMERGENCE_PLANE.constant = -perchY
}

/** Disable clipping entirely (reduced motion rises with a fade instead). */
export function clearEmergenceEdge(): void {
  EMERGENCE_PLANE.constant = 1e6
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')

  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)

    gradient.addColorStop(0, 'rgba(0,0,0,0.55)')
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.22)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }

  const texture = new THREE.CanvasTexture(canvas)

  texture.colorSpace = THREE.SRGBColorSpace

  return texture
}

/** Additive light seam along the perch edge; the rig drives width + opacity. */
export const EmergenceSeam = forwardRef<THREE.Mesh, { color: string }>(function EmergenceSeam({ color }, ref) {
  return (
    <mesh position={[0, 0, 0.02]} ref={ref} renderOrder={3}>
      <planeGeometry args={[SEAM_WIDTH, 0.035]} />
      <meshBasicMaterial
        blending={THREE.AdditiveBlending}
        color={color}
        depthWrite={false}
        opacity={0}
        toneMapped={false}
        transparent
      />
    </mesh>
  )
})

/** Soft blob contact shadow that settles as the avatar lands. */
export const ContactShadow = forwardRef<THREE.Mesh, { scale?: number }>(function ContactShadow({ scale = 1 }, ref) {
  const texture = useMemo(createContactShadowTexture, [])

  return (
    <mesh position={[0, -0.02, 0.015]} ref={ref} renderOrder={1}>
      <planeGeometry args={[0.95 * scale, 0.3 * scale]} />
      <meshBasicMaterial depthWrite={false} map={texture} opacity={0} transparent />
    </mesh>
  )
})
