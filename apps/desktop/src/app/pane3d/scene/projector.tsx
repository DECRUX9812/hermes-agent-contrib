import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'

import { avatarFrames, boundingScreenRect, getAvatarRoots, writeHandleRect } from './projection'

/**
 * Projects every registered avatar's world box to pane-local CSS px once per
 * frame and writes the result straight into the DOM handle and the snapshot
 * frame (architecture §12). No React state is touched, so the overlay never
 * re-renders while an avatar moves.
 */
export function Projector() {
  const { camera, size } = useThree()

  const scratch = useMemo(
    () => ({ box: new THREE.Box3(), corner: new THREE.Vector3(), points: [] as { x: number; y: number }[] }),
    []
  )

  useFrame(() => {
    camera.updateMatrixWorld()

    getAvatarRoots().forEach((root, id) => {
      const { box, corner, points } = scratch

      box.setFromObject(root)

      if (box.isEmpty()) {
        avatarFrames[id].screenRect = null
        writeHandleRect(id, null)

        return
      }

      points.length = 0

      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            corner.set(x, y, z).project(camera)
            points.push({
              x: (corner.x * 0.5 + 0.5) * size.width,
              y: (1 - (corner.y * 0.5 + 0.5)) * size.height
            })
          }
        }
      }

      const rect = boundingScreenRect(points)

      avatarFrames[id].screenRect = rect
      writeHandleRect(id, rect)
    })
  })

  return null
}
