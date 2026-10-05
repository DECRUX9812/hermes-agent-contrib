import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'

import { listAvatars } from '../avatars/registry'
import type { AvatarRigHandle } from '../avatars/types'

import { ContactShadow, EmergenceSeam } from './emergence'
import {
  beginPrewarm,
  completePrewarm,
  planPrewarm,
  PREWARM_OFFSCREEN_Y,
  type PrewarmPlan,
  setPrewarmPlan,
  settlePrewarm
} from './prewarm'

/**
 * No avatar is driven during pre-warm; the callbacks exist only to satisfy the
 * body contract, and the refs are never read.
 */
const IDLE_RIG: AvatarRigHandle = {
  accent: null,
  accentCue: null,
  eyes: null,
  head: null,
  registerAccent: () => undefined,
  registerAccentCue: () => undefined,
  registerEyes: () => undefined,
  registerHead: () => undefined
}

function setCulling(root: THREE.Object3D | null, culled: boolean): void {
  root?.traverse(object => {
    if ((object as THREE.Mesh).isMesh) {
      ;(object as THREE.Mesh).frustumCulled = culled
    }
  })
}

/**
 * Warms the renderer's program cache before the pane says `ready` (see
 * `scene/prewarm.ts`). Every registered body — plus the seam and contact shadow
 * that are drawn with one — is committed to the scene off-screen, drawn once,
 * and KEPT mounted: the cache is refcounted, so unmounting them would dispose
 * their materials and release the very programs we just linked.
 *
 * The warm-up has to be a real DRAW TO THE CANVAS, neither `gl.compile` nor a
 * render into a target:
 *
 * - three keys a program by the renderer's clipping state, and only `setProgram`
 *   writes that during a draw. Compiling alone linked the avatars' one-plane
 *   programs under a zero-plane key, so the first emergence recompiled anyway.
 * - three also keys it by tone mapping and output color space, and both are read
 *   off the CURRENT render target: into an offscreen target a material compiles
 *   without `TONE_MAPPING`, so the emergence — which draws to the canvas —
 *   compiled a second, tone-mapped program.
 *
 * None of the warm-up is visible: the bodies sit far below the camera frustum
 * with culling off for exactly this one draw, so the rasterizer discards every
 * fragment, and culling is restored the moment the pass is done. The pane's own
 * first frame repaints the canvas right after. Kept bodies never draw again, and
 * nothing in `$avatars` knows they exist, so `frameloop='demand'` still stops
 * when the pane is idle.
 *
 * The pass runs from a passive effect on purpose: three keys a program by the
 * scene's lights and environment, and drei's `<Environment>` writes
 * `scene.environment` from a layout effect. Warming any earlier would link the
 * wrong programs and the stall would come back.
 */
export function ShaderPrewarm() {
  const gl = useThree(state => state.gl)
  const scene = useThree(state => state.scene)
  const camera = useThree(state => state.camera)
  const group = useRef<THREE.Group>(null)
  const definitions = useMemo(() => listAvatars(), [])
  const [plan, setPlan] = useState<PrewarmPlan>(() => planPrewarm(definitions))

  useEffect(() => {
    if (plan.stage === 'warm') {
      settlePrewarm()

      return
    }

    if (plan.stage === 'pending') {
      setPlan(setPrewarmPlan(beginPrewarm(plan)))

      return
    }

    // The warm-up must not be able to strand the pane without a `ready`:
    // restore culling and settle whatever the draw does.
    try {
      setCulling(group.current, false)
      gl.render(scene, camera)
    } finally {
      setCulling(group.current, true)
      setPlan(setPrewarmPlan(completePrewarm(plan)))
    }
  }, [camera, gl, plan, scene])

  return (
    <group position={[0, PREWARM_OFFSCREEN_Y, 0]} ref={group}>
      {definitions.map(definition => (
        <definition.Body key={definition.id} rig={IDLE_RIG} state="idle" />
      ))}
      {/* Drawn with the first body, so their programs belong to the same warm-up. */}
      <EmergenceSeam color="#ffffff" />
      <ContactShadow />
    </group>
  )
}
