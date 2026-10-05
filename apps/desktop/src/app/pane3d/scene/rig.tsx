import { useFrame } from '@react-three/fiber'
import { damp } from 'maath/easing'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { AvatarDefinition, AvatarRigHandle } from '../avatars/types'
import type { AvatarState } from '../director/store'

import { ContactShadow, EmergenceSeam } from './emergence'
import { getPointerGaze } from './pointer-gaze'
import { avatarFrames, setAvatarRoot, type SlotTarget } from './projection'

export type RigCompletionEvent = 'EMERGED' | 'CELEBRATED' | 'HIDDEN'

export interface RigProps {
  definition: AvatarDefinition
  state: AvatarState
  /** `performance.now()` when the director entered `state`; anchors the clock. */
  startedAt: number
  target: SlotTarget
  reducedMotion: boolean
  onAnimationEnd: (event: RigCompletionEvent) => void
}

const EMERGE_MS = 700
const HIDE_MS = 500
const CELEBRATE_MS = 900
const REDUCED_MS = 250
const BREATH_HZ = 0.22
const TAU = Math.PI * 2
const EMERGE_OMEGA = 11
const EMERGE_ZETA = 0.72

/** Critically-ish damped spring step with a single ~4% overshoot (§8.4). */
function springProgress(elapsedMs: number, durationMs: number): number {
  if (elapsedMs <= 0) {
    return 0
  }

  if (elapsedMs >= durationMs) {
    return 1
  }

  const t = elapsedMs / 1000
  const damped = EMERGE_OMEGA * Math.sqrt(1 - EMERGE_ZETA * EMERGE_ZETA)
  const decay = Math.exp(-EMERGE_ZETA * EMERGE_OMEGA * t)

  return 1 - decay * (Math.cos(damped * t) + ((EMERGE_ZETA * EMERGE_OMEGA) / damped) * Math.sin(damped * t))
}

type Motion = {
  phase: 'rest' | 'emerging' | 'hiding' | 'celebrating'
  lastState: AvatarState | null
  startedAt: number
  x: number
  y: number
  scale: number
  fade: number
  lastFade: number
  yaw: number
  gazeX: number
  gazeY: number
  lean: number
  widen: number
  headTilt: number
  spin: number
  spinSpeed: number
  nod: number
  nodAt: number
  counted: boolean
}

function createMotion(target: SlotTarget): Motion {
  return {
    counted: false,
    fade: 1,
    gazeX: 0,
    gazeY: 0,
    headTilt: 0,
    lastFade: 1,
    lastState: null,
    lean: 0,
    nod: 0,
    nodAt: 0,
    phase: 'rest',
    scale: 1,
    spin: 0,
    spinSpeed: 0.02,
    startedAt: 0,
    widen: 1,
    x: target.x,
    y: target.y,
    yaw: 0
  }
}

/**
 * The shared rig: EVERY avatar motion lives here (architecture §8.2/§8.4).
 * Bodies are pure geometry; the rig owns breathing, gaze, facing, lean, the
 * state cues and the emergence/hide/celebrate choreography, and reports
 * animation completion so the machine can advance.
 */
export function Rig({ definition, onAnimationEnd, reducedMotion, startedAt, state, target }: RigProps) {
  const root = useRef<THREE.Group>(null)
  const seam = useRef<THREE.Mesh>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const motion = useRef<Motion>(createMotion(target))

  const handle = useMemo<AvatarRigHandle>(
    () => ({
      accent: null,
      eyes: null,
      head: null,
      registerAccent: object => {
        handle.accent = object
      },
      registerEyes: object => {
        handle.eyes = object
      },
      registerHead: object => {
        handle.head = object
      }
    }),
    []
  )

  // Stable ref callbacks: an inline arrow would be detached and re-attached on
  // every render, and a detach clears this avatar's frame (mesh count, rect) for
  // good. `setAvatarRoot` only resets on a real unmount.
  const attachRoot = useCallback(
    (object: THREE.Group | null) => {
      root.current = object
      setAvatarRoot(definition.id, object)
    },
    [definition.id]
  )

  const endRef = useRef(onAnimationEnd)

  endRef.current = onAnimationEnd

  /**
   * The completion reporter. The frame loop owns the VISUALS, but a frame is not
   * guaranteed to land anywhere near the deadline — a software GL pane renders
   * at ~5 fps, so a 250 ms fade would otherwise report at 400–700 ms. The
   * deadline timer reports at the animation's own duration, and both paths
   * funnel through the same idempotent `dispatch` (a repeated event is a
   * machine no-op). §8.1 wants completion from the rig, not a fixed cycle.
   */
  useEffect(() => {
    if (state !== 'emerging' && state !== 'hiding' && state !== 'celebrating') {
      return undefined
    }

    if (state === 'celebrating' && reducedMotion) {
      // Reduced motion never plays the gesture: settle on the next commit.
      endRef.current('CELEBRATED')

      return undefined
    }

    const duration =
      state === 'celebrating' ? CELEBRATE_MS : reducedMotion ? REDUCED_MS : state === 'emerging' ? EMERGE_MS : HIDE_MS

    const event: RigCompletionEvent = state === 'emerging' ? 'EMERGED' : state === 'hiding' ? 'HIDDEN' : 'CELEBRATED'
    const remaining = Math.max(0, duration - (performance.now() - startedAt))
    const timer = setTimeout(() => endRef.current(event), remaining)

    return () => clearTimeout(timer)
  }, [reducedMotion, startedAt, state])

  // Priority -1: motion must run BEFORE the Projector (priority 0) in the same
  // frame. A Rig mounts later than the Projector, and equal priorities run in
  // mount order — so without this the Projector reads the previous frame's
  // transform and, on the mount frame, projects the brand-new group still
  // sitting at the world origin (dead centre of the screen). Negative priority
  // does not take over the render loop; only a positive one does.
  useFrame((_, rawDelta) => {
    const rootObject = root.current
    const m = motion.current

    if (!rootObject) {
      return
    }

    const dt = Math.min(rawDelta, 0.05)
    const now = performance.now()
    const listening = state === 'listening'
    const thinking = state === 'thinking'

    // A state change starts the matching choreography. Detected in the frame
    // loop (not an effect) so the animation clock and the phase always agree.
    if (state !== m.lastState) {
      m.lastState = state
      // Anchor to the transition, not to this frame: a late frame must not
      // stretch a 250 ms fade into 500 ms of wall clock (§8.4).
      m.startedAt = startedAt > 0 ? startedAt : now

      if (state === 'emerging') {
        m.phase = 'emerging'
        m.y = target.perchY - definition.height / 2 - 0.04
        m.scale = reducedMotion ? 1 : 0.85
        m.fade = reducedMotion ? 0 : 1
        m.lastFade = m.fade
      } else if (state === 'hiding') {
        m.phase = 'hiding'
      } else if (state === 'celebrating' && reducedMotion) {
        m.phase = 'rest'
      } else if (state === 'celebrating') {
        m.phase = 'celebrating'
      } else {
        m.phase = 'rest'
      }
    }

    if (!m.counted && rootObject.children.length > 0) {
      countMeshes(rootObject, definition.id)
      m.counted = true
    }

    // Gaze follows the pointer over the handle, else eases to neutral (§8.4).
    const pointer = getPointerGaze(definition.id)

    damp(m, 'gazeX', pointer.active ? pointer.x : 0, 0.16, dt)
    damp(m, 'gazeY', pointer.active ? pointer.y : 0, 0.16, dt)
    damp(m, 'yaw', 0, 0.3, dt)

    let yTarget = target.y
    let fadeTarget = 1
    let seamTarget = 0
    let shadowTarget = 1
    let scaleTarget = 1

    if (m.phase === 'emerging') {
      const elapsed = now - m.startedAt
      const duration = reducedMotion ? REDUCED_MS : EMERGE_MS
      const progress = reducedMotion ? Math.min(1, elapsed / duration) : springProgress(elapsed, duration)

      yTarget = THREE.MathUtils.lerp(target.perchY - definition.height / 2 - 0.04, target.y, progress)
      scaleTarget = reducedMotion ? 1 : THREE.MathUtils.lerp(0.85, 1, progress)
      fadeTarget = reducedMotion ? progress : 1
      seamTarget = reducedMotion ? 0 : Math.max(0, 1 - progress * 2)
      shadowTarget = progress

      if (elapsed >= duration) {
        m.phase = 'rest'
        onAnimationEnd('EMERGED')
      }
    } else if (m.phase === 'hiding') {
      const elapsed = now - m.startedAt
      const duration = reducedMotion ? REDUCED_MS : HIDE_MS
      const raw = Math.min(1, elapsed / duration)
      const eased = raw * raw * (3 - 2 * raw)

      yTarget = THREE.MathUtils.lerp(target.y, target.perchY - definition.height / 2 - 0.04, eased)
      fadeTarget = reducedMotion ? 1 - raw : 1
      seamTarget = reducedMotion ? 0 : Math.min(1, raw * 2)
      shadowTarget = 1 - raw

      if (elapsed >= duration) {
        m.phase = 'rest'
        onAnimationEnd('HIDDEN')
      }
    } else if (m.phase === 'celebrating') {
      const elapsed = now - m.startedAt
      const progress = Math.min(1, elapsed / CELEBRATE_MS)

      yTarget = target.y + 0.08 * Math.sin(Math.PI * progress)

      if (elapsed >= CELEBRATE_MS) {
        m.phase = 'rest'
        onAnimationEnd('CELEBRATED')
      }
    }

    // Position: the spring owns y during emergence, damp everywhere else.
    damp(m, 'x', target.x, 0.22, dt)

    if (m.phase === 'emerging') {
      m.y = yTarget
      m.scale = scaleTarget
    } else {
      damp(m, 'y', yTarget, 0.16, dt)
      damp(m, 'scale', 1, 0.2, dt)
    }

    if (m.phase === 'emerging' && reducedMotion) {
      m.fade = fadeTarget
    } else {
      damp(m, 'fade', fadeTarget, 0.12, dt)
    }

    // Idle cues: breathing is the only looping motion (§8.4).
    const breathing = state === 'idle' || listening || thinking || state === 'responding' || state === 'notifying'
    const breath = breathing ? Math.sin((now / 1000) * TAU * BREATH_HZ) : 0
    const drift = breathing ? 0.01 * breath : 0

    damp(m, 'lean', listening ? 0.1 : 0, 0.25, dt)
    damp(m, 'widen', listening ? 1.08 : 1, 0.25, dt)

    // Responding: one small nod per burst, never faster than 2/s.
    if (state === 'responding' && !reducedMotion) {
      if (now - m.nodAt > 500) {
        m.nodAt = now
        m.nod = 1
      }

      m.nod = Math.max(0, m.nod - dt * 6)
    } else {
      m.nod = 0
    }

    rootObject.position.set(m.x, m.y + drift, 0)
    rootObject.rotation.x = -m.lean + m.nod * 0.05
    rootObject.rotation.y = m.yaw
    rootObject.rotation.z = 0
    rootObject.scale.set(m.scale, m.scale * (1 + 0.012 * breath), m.scale)

    // The avatar's own accent cue: Muse's halo speeds to 0.3 rev/s thinking.
    // At rest it STOPS — §8.4 allows breathing and nothing else while idle, and
    // a slowly turning tilted torus swings the avatar's screen box by ~60 px.
    damp(m, 'spinSpeed', thinking ? 0.3 : 0, 0.4, dt)
    m.spin += m.spinSpeed * TAU * dt

    if (handle.accent) {
      handle.accent.rotation.y = m.spin
      handle.accent.scale.setScalar(m.phase === 'celebrating' ? 1 + 0.12 * glowPulse(now, m.startedAt) : 1)
    }

    if (handle.head) {
      damp(m, 'headTilt', thinking ? (4 * Math.PI) / 180 : 0, 0.4, dt)
      handle.head.rotation.y = m.gazeX * 0.22
      handle.head.rotation.x = -m.gazeY * 0.12
      handle.head.rotation.z = m.headTilt
    }

    if (handle.eyes) {
      handle.eyes.rotation.y = m.gazeX * 0.3
      handle.eyes.rotation.x = -m.gazeY * 0.18
      handle.eyes.scale.setScalar(m.widen)
    }

    applyFade(rootObject, m)
    writeEdge(seam.current, shadow.current, seamTarget, shadowTarget)

    const frame = avatarFrames[definition.id]

    frame.yawDeg = THREE.MathUtils.radToDeg(m.yaw)
    frame.gaze = { x: m.gazeX, y: m.gazeY }
  }, -1)

  return (
    <>
      <group ref={attachRoot}>
        <definition.Body rig={handle} state={state} />
      </group>
      <group position={[target.x, target.perchY, 0]}>
        <EmergenceSeam color={definition.palette.glow} ref={seam} />
        <ContactShadow ref={shadow} scale={definition.height} />
      </group>
    </>
  )
}

function glowPulse(now: number, startedAt: number): number {
  return Math.sin(Math.PI * Math.min(1, (now - startedAt) / CELEBRATE_MS))
}

function countMeshes(root: THREE.Object3D, id: AvatarDefinition['id']): void {
  let meshCount = 0
  const types = new Set<string>()

  root.traverse(object => {
    const mesh = object as THREE.Mesh

    if (!mesh.isMesh) {
      return
    }

    meshCount += 1
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

    materials.forEach(material => {
      if (material) {
        types.add(material.type)
      }
    })
  })

  const frame = avatarFrames[id]

  frame.meshCount = meshCount
  frame.materialTypes = [...types]
}

function applyFade(root: THREE.Object3D, m: Motion): void {
  if (m.fade >= 0.999 && m.lastFade >= 0.999) {
    return
  }

  root.traverse(object => {
    const mesh = object as THREE.Mesh

    if (!mesh.isMesh) {
      return
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

    materials.forEach(material => {
      if (material?.transparent) {
        const base = (material.userData?.baseOpacity as number | undefined) ?? 1

        material.opacity = base * m.fade
      }
    })
  })
  m.lastFade = m.fade
}

function writeEdge(seam: THREE.Mesh | null, shadow: THREE.Mesh | null, seamTarget: number, shadowTarget: number): void {
  if (seam) {
    const material = seam.material as THREE.MeshBasicMaterial

    material.opacity = 0.9 * seamTarget
    seam.scale.x = Math.max(0.001, seamTarget)
  }

  if (shadow) {
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = 0.34 * shadowTarget
  }
}
