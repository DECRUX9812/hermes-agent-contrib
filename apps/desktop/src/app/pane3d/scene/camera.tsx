import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type * as THREE from 'three'

import { CAMERA_FOV, cameraDistance } from './projection'

/**
 * Places the perspective camera so 1 world unit is ~120 CSS px at the perch
 * line (architecture §8.3). Re-homed on resize; the fov stays 30.
 */
export function PaneCamera() {
  const camera = useThree(state => state.camera)
  const height = useThree(state => state.size.height)

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera

    perspective.fov = CAMERA_FOV
    perspective.position.set(0, 0, cameraDistance(height))
    perspective.lookAt(0, 0, 0)
    perspective.updateProjectionMatrix()
  }, [camera, height])

  return null
}
