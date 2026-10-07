import { RoundedBox } from '@react-three/drei'
import { useCallback, useEffect, useRef } from 'react'
import type * as THREE from 'three'

import { EMERGENCE_CLIPPING_PLANES } from '../scene/emergence'

import { registerAvatar } from './registry'
import type { AvatarAccentCue, AvatarBodyProps, AvatarDefinition } from './types'

/**
 * OpenCode — the terminal cube (architecture §8.3): a brushed graphite rounded
 * cube whose front is an inset dark screen inside a graphite frame, carrying an
 * emissive `>_` built from real boxes. The underscore is steady while idle and
 * pulses only while thinking or responding (§8.4) — its opacity follows state.
 */
const GRAPHITE = '#2b2d31'
const SCREEN = '#0d0f12'
const GLYPH = '#e8e8f2'

const HEIGHT = 0.8
const FRAME_Z = 0.4
const SCREEN_HALF = 0.28
const RAIL = 0.05
const PULSE_HZ = 0.9

function OpenCodeBody({ rig }: AvatarBodyProps) {
  const underscore = useRef<THREE.Mesh>(null)

  const cue = useCallback<AvatarAccentCue>(({ elapsedMs, fade, state }) => {
    const mesh = underscore.current

    if (!mesh) {
      return
    }

    const material = mesh.material as THREE.MeshStandardMaterial
    const active = state === 'thinking' || state === 'responding'
    const pulse = active ? 0.45 + 0.55 * Math.abs(Math.sin((elapsedMs / 1000) * Math.PI * 2 * PULSE_HZ)) : 1

    material.opacity = fade * pulse
  }, [])

  useEffect(() => {
    rig.registerAccentCue(cue)

    return () => rig.registerAccentCue(null)
  }, [cue, rig])

  return (
    <group ref={rig.registerHead}>
      <RoundedBox args={[0.8, HEIGHT, 0.8]} radius={0.1} smoothness={4} userData={{ hitPart: true }}>
        <meshPhysicalMaterial
          clearcoat={0.4}
          clearcoatRoughness={0.5}
          clippingPlanes={EMERGENCE_CLIPPING_PLANES}
          color={GRAPHITE}
          metalness={0.15}
          roughness={0.55}
          transparent
        />
      </RoundedBox>

      <group userData={{ hitPart: true }}>
        {/* Inset screen: a dark plate flush with the face, 0.03 behind the frame. */}
        <mesh position={[0, 0, FRAME_Z - 0.02]}>
          <boxGeometry args={[SCREEN_HALF * 2, SCREEN_HALF * 2, 0.04]} />
          <meshStandardMaterial
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={SCREEN}
            metalness={0.1}
            roughness={0.5}
            transparent
          />
        </mesh>

        {/* Graphite frame rails, proud of the screen so it reads as inset. */}
        {[
          {
            position: [0, SCREEN_HALF + RAIL / 2, FRAME_Z + 0.005] as const,
            size: [SCREEN_HALF * 2 + RAIL * 2, RAIL, 0.06] as const
          },
          {
            position: [0, -(SCREEN_HALF + RAIL / 2), FRAME_Z + 0.005] as const,
            size: [SCREEN_HALF * 2 + RAIL * 2, RAIL, 0.06] as const
          },
          {
            position: [-(SCREEN_HALF + RAIL / 2), 0, FRAME_Z + 0.005] as const,
            size: [RAIL, SCREEN_HALF * 2 + RAIL * 2, 0.06] as const
          },
          {
            position: [SCREEN_HALF + RAIL / 2, 0, FRAME_Z + 0.005] as const,
            size: [RAIL, SCREEN_HALF * 2 + RAIL * 2, 0.06] as const
          }
        ].map((rail, index) => (
          <mesh key={index} position={rail.position}>
            <boxGeometry args={rail.size} />
            <meshStandardMaterial
              clippingPlanes={EMERGENCE_CLIPPING_PLANES}
              color={GRAPHITE}
              metalness={0.2}
              roughness={0.45}
              transparent
            />
          </mesh>
        ))}

        {/* `>_` — chevron of two thin boxes, underscore of one. */}
        <group position={[-0.157, -0.01, FRAME_Z + 0.03]}>
          <mesh position={[0.05, 0.05, 0]} rotation={[0, 0, -Math.PI / 4]}>
            <boxGeometry args={[0.16, 0.028, 0.02]} />
            <meshStandardMaterial
              clippingPlanes={EMERGENCE_CLIPPING_PLANES}
              color={GLYPH}
              emissive={GLYPH}
              emissiveIntensity={1.6}
              roughness={0.35}
              transparent
            />
          </mesh>
          <mesh position={[0.05, -0.05, 0]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.16, 0.028, 0.02]} />
            <meshStandardMaterial
              clippingPlanes={EMERGENCE_CLIPPING_PLANES}
              color={GLYPH}
              emissive={GLYPH}
              emissiveIntensity={1.6}
              roughness={0.35}
              transparent
            />
          </mesh>
          <mesh position={[0.25, -0.105, 0]} ref={underscore}>
            <boxGeometry args={[0.16, 0.03, 0.02]} />
            <meshStandardMaterial
              clippingPlanes={EMERGENCE_CLIPPING_PLANES}
              color={GLYPH}
              emissive={GLYPH}
              emissiveIntensity={1.6}
              roughness={0.35}
              transparent
              userData={{ baseOpacity: 1 }}
            />
          </mesh>
        </group>
      </group>
    </group>
  )
}

export const opencode: AvatarDefinition = {
  Body: OpenCodeBody,
  displayName: 'OpenCode',
  height: HEIGHT,
  id: 'opencode',
  palette: { accent: '#e8e8f2', glow: '#9fe3c1', ink: '#dfe3ea', primary: '#2b2d31' },
  tagline: 'OpenCode — the terminal cube',
  width: 0.8
}

registerAvatar(opencode)
