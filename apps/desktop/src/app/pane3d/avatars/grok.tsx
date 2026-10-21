import { RoundedBox } from '@react-three/drei'
import { useCallback, useEffect, useRef } from 'react'
import type * as THREE from 'three'

import { EMERGENCE_CLIPPING_PLANES } from '../scene/emergence'

import { approach } from './accent'
import { getMarkGeometry } from './marks'
import { registerAvatar } from './registry'
import type { AvatarAccentCue, AvatarBodyProps, AvatarDefinition } from './types'

/**
 * Grok — the obsidian monolith (architecture §8.3): a rounded obsidian box with
 * the salvaged X mark extruded from `BRAND_MARKS.x` as an emissive slab, and a
 * single thin visor light beneath it. Thinking makes the visor scan; gaze
 * widens and shifts it (§8.4).
 */
const OBSIDIAN = '#0b0b0f'
const MARK = '#f5f5f7'
const VISOR = '#c7d2ff'

const HEIGHT = 0.95
const FACE_Z = 0.25
/** Proud of the box front face (half-depth 0.25) so the light is not embedded. */
const VISOR_Z = FACE_Z + 0.02
const VISOR_Y = -0.24
const SCAN_AMPLITUDE = 0.11
const SCAN_HZ = 0.55

function GrokBody({ rig }: AvatarBodyProps) {
  const visor = useRef<THREE.Group>(null)
  const scan = useRef(0)
  const narrow = useRef(1)

  const cue = useCallback<AvatarAccentCue>(({ dt, elapsedMs, gazeX, state }) => {
    const thinking = state === 'thinking'

    scan.current = approach(scan.current, thinking ? SCAN_AMPLITUDE : 0, dt, 0.14)
    narrow.current = approach(narrow.current, thinking ? 0.62 : 1, dt, 0.14)

    const group = visor.current

    if (!group) {
      return
    }

    // Gaze widens and leans the light toward the side it looks at; thinking
    // sweeps it across the face.
    group.position.x = scan.current * Math.sin((elapsedMs / 1000) * Math.PI * 2 * SCAN_HZ) + 0.055 * gazeX
    group.scale.x = narrow.current * (1 + 0.28 * gazeX)
  }, [])

  useEffect(() => {
    rig.registerAccentCue(cue)

    return () => rig.registerAccentCue(null)
  }, [cue, rig])

  return (
    <group ref={rig.registerHead}>
      <RoundedBox args={[0.7, HEIGHT, 0.5]} radius={0.12} smoothness={4} userData={{ hitPart: true }}>
        <meshPhysicalMaterial
          clearcoat={1}
          clearcoatRoughness={0.2}
          clippingPlanes={EMERGENCE_CLIPPING_PLANES}
          color={OBSIDIAN}
          metalness={0.2}
          roughness={0.35}
          transparent
        />
      </RoundedBox>

      <mesh
        geometry={getMarkGeometry('x', { bevel: 0.006, depth: 0.07, size: 0.4 })}
        position={[0, 0.07, FACE_Z + 0.035]}
        userData={{ hitPart: true }}
      >
        <meshStandardMaterial
          clippingPlanes={EMERGENCE_CLIPPING_PLANES}
          color={MARK}
          emissive={MARK}
          emissiveIntensity={2}
          metalness={0.1}
          roughness={0.4}
          transparent
        />
      </mesh>

      <group position={[0, VISOR_Y, VISOR_Z]} ref={visor} userData={{ hitPart: true }}>
        <mesh>
          <boxGeometry args={[0.34, 0.022, 0.03]} />
          <meshStandardMaterial
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={VISOR}
            emissive={VISOR}
            emissiveIntensity={1.6}
            metalness={0.2}
            roughness={0.3}
            transparent
          />
        </mesh>
      </group>
    </group>
  )
}

export const grok: AvatarDefinition = {
  Body: GrokBody,
  displayName: 'Grok',
  height: HEIGHT,
  id: 'grok',
  palette: { accent: '#f5f5f7', glow: '#c7d2ff', ink: '#c9cdd8', primary: '#111114' },
  tagline: 'Grok — the obsidian monolith',
  width: 0.7
}

registerAvatar(grok)
