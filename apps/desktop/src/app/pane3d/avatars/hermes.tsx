import { useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'

import { EMERGENCE_CLIPPING_PLANES } from '../scene/emergence'

import { approach } from './accent'
import { registerAvatar } from './registry'
import type { AvatarAccentCue, AvatarBodyProps, AvatarDefinition } from './types'

/**
 * Hermes — the winged gold messenger (architecture §8.3): a polished ivory
 * capsule head, a gold metal visor band, two swept extruded wing fins at the
 * temples and a small gold orb antenna. Thinking folds the wings back 10°
 * (§8.4) — its own accent cue, not the generic accent spin.
 */
const IVORY = '#f3efe6'
const GOLD = '#d4a64a'
const ORB = '#ffe2a0'

const HEAD_HEIGHT = 1.08
/** Temple mount for the fins; the tip stays inside the slot width (~1.2 units). */
const WING_X = 0.29
const WING_SWEEP = 0.5
const WING_TILT = 0.12
const FOLD = (10 * Math.PI) / 180

function wingShape(sign: number): THREE.Shape {
  const shape = new THREE.Shape()

  shape.moveTo(0, -0.07)
  shape.lineTo(sign * 0.09, -0.05)
  shape.lineTo(sign * 0.36, 0.3)
  shape.lineTo(sign * 0.34, 0.36)
  shape.lineTo(sign * 0.07, 0.1)
  shape.lineTo(0, 0.07)
  shape.closePath()

  return shape
}

const wingGeometries = new Map<number, THREE.BufferGeometry>()

/** The wing's hinge is the shape origin, so the fin sweeps about the temple. */
function wingGeometry(sign: number): THREE.BufferGeometry {
  const cached = wingGeometries.get(sign)

  if (cached) {
    return cached
  }

  const geometry = new THREE.ExtrudeGeometry(wingShape(sign), {
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.012,
    bevelThickness: 0.014,
    curveSegments: 8,
    depth: 0.035
  })

  geometry.translate(0, 0, -0.0175)
  wingGeometries.set(sign, geometry)

  return geometry
}

function HermesBody({ rig }: AvatarBodyProps) {
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const fold = useRef(0)

  const cue = useCallback<AvatarAccentCue>(({ dt, state }) => {
    // Damped, like every ambient cue; it gates nothing (scene/choreography.ts
    // owns the poses that do).
    fold.current = approach(fold.current, state === 'thinking' ? FOLD : 0, dt, 0.12)

    if (right.current) {
      right.current.rotation.y = WING_SWEEP + fold.current
    }

    if (left.current) {
      left.current.rotation.y = -(WING_SWEEP + fold.current)
    }
  }, [])

  // Registered from an effect, not during render: the rig starts calling the
  // cue one frame after mount, and the JSX base pose is already the idle pose.
  useEffect(() => {
    rig.registerAccentCue(cue)

    return () => rig.registerAccentCue(null)
  }, [cue, rig])

  return (
    <group ref={rig.registerHead}>
      <mesh position={[0, -0.08, 0]} userData={{ hitPart: true }}>
        <capsuleGeometry args={[0.33, 0.26, 8, 32]} />
        <meshPhysicalMaterial
          clearcoat={0.7}
          clearcoatRoughness={0.25}
          clippingPlanes={EMERGENCE_CLIPPING_PLANES}
          color={IVORY}
          metalness={0.05}
          roughness={0.25}
          transparent
        />
      </mesh>

      {/* Visor band: a gold ring around the capsule just above eye height. */}
      <mesh position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]} userData={{ hitPart: true }}>
        <torusGeometry args={[0.34, 0.026, 16, 64]} />
        <meshStandardMaterial
          clippingPlanes={EMERGENCE_CLIPPING_PLANES}
          color={GOLD}
          emissive="#5a3f10"
          emissiveIntensity={0.6}
          metalness={1}
          roughness={0.3}
          transparent
        />
      </mesh>

      <group
        position={[WING_X, 0, -0.03]}
        ref={right}
        rotation={[0, WING_SWEEP, WING_TILT]}
        userData={{ hitPart: true }}
      >
        <mesh geometry={wingGeometry(1)}>
          <meshStandardMaterial
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={GOLD}
            emissive="#5a3f10"
            emissiveIntensity={0.5}
            metalness={1}
            roughness={0.32}
            transparent
          />
        </mesh>
      </group>

      <group
        position={[-WING_X, 0, -0.03]}
        ref={left}
        rotation={[0, -WING_SWEEP, -WING_TILT]}
        userData={{ hitPart: true }}
      >
        <mesh geometry={wingGeometry(-1)}>
          <meshStandardMaterial
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={GOLD}
            emissive="#5a3f10"
            emissiveIntensity={0.5}
            metalness={1}
            roughness={0.32}
            transparent
          />
        </mesh>
      </group>

      <group position={[0, 0.38, 0]} userData={{ hitPart: true }}>
        <mesh>
          <cylinderGeometry args={[0.012, 0.012, 0.12, 8]} />
          <meshStandardMaterial
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={GOLD}
            metalness={1}
            roughness={0.3}
            transparent
          />
        </mesh>
        <mesh position={[0, 0.085, 0]}>
          <sphereGeometry args={[0.075, 24, 24]} />
          <meshStandardMaterial
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={GOLD}
            emissive={ORB}
            emissiveIntensity={1.3}
            metalness={0.8}
            roughness={0.25}
            transparent
          />
        </mesh>
      </group>
    </group>
  )
}

export const hermes: AvatarDefinition = {
  Body: HermesBody,
  displayName: 'Hermes',
  height: HEAD_HEIGHT,
  id: 'hermes',
  palette: { accent: '#d4a64a', glow: '#ffe2a0', ink: '#8a6a22', primary: '#f3efe6' },
  tagline: 'Hermes — the winged messenger',
  // Wing tips reach ~±0.61 world units out from the temple mount.
  width: 1.22
}

registerAvatar(hermes)
