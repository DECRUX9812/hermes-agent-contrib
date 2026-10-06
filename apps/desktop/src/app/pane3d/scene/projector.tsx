import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'

import { chartRuntime } from '../director/chart-state'
import type { ScreenRect } from '../protocol'

import {
  avatarFrames,
  boundingScreenRect,
  collectHitParts,
  getAvatarRoots,
  getChartRoot,
  getEdgeObjects,
  writeHandleRect
} from './projection'

/**
 * Projects every registered avatar once per frame, straight into the DOM
 * handle, the snapshot frame, and the hit-region source list. No React state is
 * touched, so the overlay never re-renders while an avatar moves.
 *
 * Two projections per avatar: the body root (handle position, `screenRect`,
 * perch math) and the per-part boxes the click-through shape is built from
 * (architecture §6). The parts are the outermost `userData.hitPart` objects, so
 * their union is the body's own box — silhouette-accurate rather than one fat
 * rect.
 */
export function Projector() {
  const { camera, size } = useThree()

  const scratch = useMemo(
    () => ({ box: new THREE.Box3(), corner: new THREE.Vector3(), points: [] as { x: number; y: number }[] }),
    []
  )

  useFrame(() => {
    camera.updateMatrixWorld()

    const { box, corner, points } = scratch

    const project = (object: THREE.Object3D): ScreenRect | null => {
      box.setFromObject(object)

      if (box.isEmpty()) {
        return null
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

      return boundingScreenRect(points)
    }

    getAvatarRoots().forEach((root, id) => {
      const frame = avatarFrames[id]
      const rect = project(root)

      frame.screenRect = rect
      writeHandleRect(id, rect)

      const hitRects: ScreenRect[] = []

      collectHitParts(root).forEach(part => {
        const partRect = project(part)

        if (partRect) {
          hitRects.push(partRect)
        }
      })

      // The seam and contact shadow hang below the perch line, so they are not
      // in the body root's box — but setShape would clip them without a region.
      const edge = getEdgeObjects().get(id)

      if (edge) {
        const edgeRect = project(edge)

        if (edgeRect) {
          hitRects.push(edgeRect)
        }
      }

      frame.hitRects = hitRects
    })

    // The chart's projected bounds join the same source list while it is
    // presented; on unmount the root is cleared and the rects go with it.
    const chart = getChartRoot()
    const chartRect = chart ? project(chart) : null

    chartRuntime.screenRect = chartRect
    chartRuntime.hitRects = chartRect ? [chartRect] : []
  })

  return null
}
