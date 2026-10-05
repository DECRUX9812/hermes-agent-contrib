import { EMERGENCE_CLIPPING_PLANES } from '../scene/emergence'

import { registerAvatar } from './registry'
import type { AvatarBodyProps, AvatarDefinition } from './types'

/**
 * Muse — a luminous pearl (architecture §8.3). Real geometry only: an
 * iridescent sphere, a thin floating halo torus and two soft almond eyes. No
 * images, no textures, no blinking.
 */
const PEARL = '#f6e7ff'
const EYE = '#2a1740'
const HALO = '#ffb3d9'

function MuseBody({ rig }: AvatarBodyProps) {
  return (
    <>
      <mesh castShadow={false} userData={{ hitPart: true }}>
        <sphereGeometry args={[0.42, 48, 48]} />
        <meshPhysicalMaterial
          clearcoat={1}
          clearcoatRoughness={0.12}
          clippingPlanes={EMERGENCE_CLIPPING_PLANES}
          color={PEARL}
          iridescence={1}
          iridescenceIOR={1.35}
          metalness={0}
          roughness={0.15}
          sheen={0.6}
          sheenColor={HALO}
          transparent
        />
      </mesh>

      {/* Above the crown, not across the eyes: at eye height the ring reads as
          a belt and clips the gaze. */}
      <group position={[0, 0.24, 0]} ref={rig.registerAccent} userData={{ hitPart: true }}>
        <mesh rotation={[Math.PI / 2, 0, (12 * Math.PI) / 180]}>
          <torusGeometry args={[0.55, 0.018, 20, 96]} />
          <meshStandardMaterial
            clippingPlanes={EMERGENCE_CLIPPING_PLANES}
            color={HALO}
            emissive={HALO}
            emissiveIntensity={1.5}
            opacity={0.9}
            roughness={0.3}
            transparent
            userData={{ baseOpacity: 0.9 }}
          />
        </mesh>
      </group>

      <group position={[0, 0.06, 0.3]} ref={rig.registerHead} userData={{ hitPart: true }}>
        <group ref={rig.registerEyes}>
          <mesh position={[-0.135, 0.02, 0.06]} scale={[0.058, 0.092, 0.03]}>
            <sphereGeometry args={[1, 20, 20]} />
            <meshStandardMaterial
              clippingPlanes={EMERGENCE_CLIPPING_PLANES}
              color={EYE}
              emissive={EYE}
              emissiveIntensity={0.5}
              roughness={0.45}
              transparent
            />
          </mesh>
          <mesh position={[0.135, 0.02, 0.06]} scale={[0.058, 0.092, 0.03]}>
            <sphereGeometry args={[1, 20, 20]} />
            <meshStandardMaterial
              clippingPlanes={EMERGENCE_CLIPPING_PLANES}
              color={EYE}
              emissive={EYE}
              emissiveIntensity={0.5}
              roughness={0.45}
              transparent
            />
          </mesh>
        </group>
      </group>
    </>
  )
}

export const muse: AvatarDefinition = {
  Body: MuseBody,
  displayName: 'Muse',
  height: 1.1,
  id: 'muse',
  palette: { accent: '#ff8fc8', glow: '#ffc6e8', ink: '#2a1740', primary: '#e9d5ff' },
  tagline: 'Muse — your creative partner',
  // The tilted halo torus dominates the silhouette (0.55 r, 12° tilt).
  width: 1.35
}

registerAvatar(muse)
