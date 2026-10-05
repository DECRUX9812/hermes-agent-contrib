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
 * The rig-owned inputs an avatar's own accent cue is a pure function of
 * (architecture §8.4). The rig owns WHEN a cue runs and how its clock advances;
 * the body decides which of its parts the cue moves.
 */
export interface AvatarAccentInput {
  state: AvatarState
  /** Damped pointer gaze, -1..1 (positive = screen-right / up). */
  gazeX: number
  gazeY: number
  /** Milliseconds since the current state began (anchored to `changedAt`). */
  elapsedMs: number
  /** 0..1 celebrate glow pulse. */
  pulse: number
  /** The rig's emergence fade 0..1 (reduced motion fades a body in). */
  fade: number
  /** Frame delta in seconds, clamped to 0.05. */
  dt: number
}

/** The avatar's own accent cue — one per body, called by the rig each frame. */
export type AvatarAccentCue = (input: AvatarAccentInput) => void

/**
 * The named sub-groups a Body exposes so the shared `<Rig>` can drive motion
 * without knowing the geometry (architecture §8.2). Bodies set these from
 * ref callbacks; the rig nudges them each frame.
 *
 * `accent` is the generic rotating accent: the rig spins it only while thinking
 * and pulses its scale while celebrating. A body whose accent cue is not a spin
 * (Hermes' wing fold, Grok's scanning visor, OpenCode's cursor) leaves `accent`
 * null and registers an `accentCue` instead — the rig still owns when it runs.
 */
export interface AvatarRigHandle {
  head: THREE.Object3D | null
  eyes: THREE.Object3D | null
  accent: THREE.Object3D | null
  accentCue: AvatarAccentCue | null
  registerHead: (object: THREE.Object3D | null) => void
  registerEyes: (object: THREE.Object3D | null) => void
  registerAccent: (object: THREE.Object3D | null) => void
  registerAccentCue: (cue: AvatarAccentCue | null) => void
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
  /**
   * World-space silhouette width (the projected body box), used by the perch
   * layout so slots never overlap (VAL-ROOM-003). Defaults to
   * `height * AVATAR_WIDTH_RATIO` when omitted; set it for a body whose
   * silhouette is much wider or narrower than that, such as Muse's halo or
   * Hermes' wings.
   */
  width?: number
  Body: ComponentType<AvatarBodyProps>
}
