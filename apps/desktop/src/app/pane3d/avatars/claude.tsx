import { EMERGENCE_CLIPPING_PLANES } from '../scene/emergence'

import { getMarkGeometry } from './marks'
import { registerAvatar } from './registry'
import type { AvatarBodyProps, AvatarDefinition } from './types'

/**
 * Claude — the terracotta friend (architecture §8.3): a soft clay capsule
 * crowned by the salvaged Claude spark, extruded in warm cream, plus two small
 * dark eyes. The spark is the generic accent, so the rig turns it — and only
 * while thinking (§8.4).
 */
const CLAY = '#d97757'
const CREAM = '#f4e9dc'
const EYE = '#2a1c14'

const HEIGHT = 1.23
/** Keeps the capsule and the crown spark centered on the body origin. */
const CONTENT_SHIFT = -0.035
const CAPSULE_Y = -0.11
const SPARK_Y = 0.5

function ClaudeBody({ rig }: AvatarBodyProps) {
  return (
    <group position={[0, CONTENT_SHIFT, 0]}>
      <group ref={rig.registerHead}>
        <mesh position={[0, CAPSULE_Y, 0]} userData={{ hitPart: true }}>
          <capsuleGeometry args={[0.36, 0.22, 8, 32]} />
          <meshPhysicalMaterial
            clearcoat={0.15}
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={CLAY}
            metalness={0}
            roughness={0.6}
            sheen={0.5}
            sheenColor="#ffb38a"
            transparent
          />
        </mesh>

        <group position={[0, CAPSULE_Y + 0.13, 0]} ref={rig.registerEyes} userData={{ hitPart: true }}>
          {[-0.11, 0.11].map(x => (
            <mesh key={x} position={[x, 0, 0.325]} scale={[0.055, 0.062, 0.03]}>
              <sphereGeometry args={[1, 20, 20]} />
              <meshStandardMaterial
                clippingPlanes={EMERGENCE_CLIPPING_PLANES}
                color={EYE}
                roughness={0.5}
                transparent
              />
            </mesh>
          ))}
        </group>

        <group position={[0, SPARK_Y, 0]} ref={rig.registerAccent} userData={{ hitPart: true }}>
          <mesh geometry={getMarkGeometry('claude', { bevel: 0.004, depth: 0.05, size: 0.3 })}>
            <meshStandardMaterial
              clippingPlanes={EMERGENCE_CLIPPING_PLANES}
              color={CREAM}
              emissive={CREAM}
              emissiveIntensity={0.35}
              roughness={0.45}
              transparent
            />
          </mesh>
        </group>
      </group>
    </group>
  )
}

export const claude: AvatarDefinition = {
  Body: ClaudeBody,
  displayName: 'Claude',
  height: HEIGHT,
  id: 'claude',
  palette: { accent: '#f4e9dc', glow: '#ffb38a', ink: '#b4532f', primary: '#d97757' },
  tagline: 'Claude — the terracotta friend',
  // Capsule r 0.36; the crown spark (0.3) is narrower.
  width: 0.74
}

registerAvatar(claude)
