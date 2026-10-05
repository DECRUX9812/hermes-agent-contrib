/**
 * The pane's light rig (architecture §8.3): a warm key from upper-right-front, a
 * cool rim from back-left and a hemisphere fill.
 *
 * Local lights only — the art direction bans `<Environment preset>` (it fetches
 * an HDR from a CDN) and real-time shadow maps.
 */
export function PaneLights() {
  return (
    <>
      <directionalLight color="#fff1e0" intensity={2.2} position={[2.6, 3.2, 2.8]} />
      <directionalLight color="#9db4ff" intensity={1.2} position={[-3.2, 1.4, -3.4]} />
      <hemisphereLight color="#ffffff" groundColor="#3b3560" intensity={0.7} />
    </>
  )
}
