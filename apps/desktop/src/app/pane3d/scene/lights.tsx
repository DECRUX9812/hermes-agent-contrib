import { Environment, Lightformer } from '@react-three/drei'

/**
 * The pane's light rig (architecture §8.3): a warm key from upper-right-front, a
 * cool rim from back-left and a hemisphere fill.
 *
 * The `<Environment>` is local — two Lightformers plus a rose bounce floor
 * rendered into a 64 px cubemap. Without it `MeshPhysicalMaterial` has nothing
 * to reflect, so Muse's iridescence and clearcoat read as flat grey paint.
 * Never `<Environment preset>`: that fetches an HDR from a CDN. Same for shadow
 * maps — the contact shadow is a painted plane, not a light.
 */
export function PaneLights() {
  return (
    <>
      <directionalLight color="#fff1e0" intensity={2.2} position={[2.6, 3.2, 2.8]} />
      <directionalLight color="#9db4ff" intensity={1.2} position={[-3.2, 1.4, -3.4]} />
      <hemisphereLight color="#ffffff" groundColor="#3b3560" intensity={0.7} />
      <Environment background={false} resolution={64}>
        <Lightformer color="#fff1e0" intensity={2.4} position={[2.6, 3.2, 2.8]} scale={[7, 7, 1]} />
        <Lightformer color="#9db4ff" intensity={1.6} position={[-3.2, 1.4, -3.4]} scale={[7, 7, 1]} />
        <Lightformer color="#ffc6e8" intensity={0.9} position={[0, -3, 1.6]} scale={[9, 5, 1]} />
      </Environment>
    </>
  )
}
