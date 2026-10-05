import type { ComponentType } from 'react'
import type * as THREE from 'three'

import type { AvatarState } from '../director/store'
import type { AvatarId } from '../protocol'

export interface AvatarPalette {
  primary: string
  accent: string
  glow: string
  /** Card accent text color (architecture §8.2). */
  ink: string
}

/**
 * The named sub-groups a Body exposes so the shared `<Rig>` can drive motion
 * without knowing the geometry (architecture §8.2). Bodies set these from
 * ref callbacks; the rig nudges them each frame.
 */
export interface AvatarRigHandle {
  head: THREE.Object3D | null
  eyes: THREE.Object3D | null
  accent: THREE.Object3D | null
  registerHead: (object: THREE.Object3D | null) => void
  registerEyes: (object: THREE.Object3D | null) => void
  registerAccent: (object: THREE.Object3D | null) => void
}

export interface AvatarBodyProps {
  rig: AvatarRigHandle
  state: AvatarState
}

export interface AvatarDefinition {
  id: AvatarId
  displayName: string
  tagline: string
  palette: AvatarPalette
  /** World units; the rig rests the body's feet on the perch line. */
  height: number
  Body: ComponentType<AvatarBodyProps>
}
