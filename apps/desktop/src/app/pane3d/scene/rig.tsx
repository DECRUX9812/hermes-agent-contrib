import { useFrame } from '@react-three/fiber'
import { damp } from 'maath/easing'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import type { AvatarDefinition, AvatarRigHandle } from '../avatars/types'
import { bowPitch, facingPose } from '../director/room'
import { getBowStart, getFacingTarget } from '../director/room-live'
import { type AvatarState, pane3dRuntime } from '../director/store'

import {
  CELEBRATE_MS,
  type ChoreographyPhase,
  choreographyPose,
  EMERGE_MS,
  HIDE_MS,
  NOTIFY_LEAN,
  notifyGlowPulse,
  perchPose,
  type PerchTween,
  type Pose,
  REDUCED_MS,
  SEAM_OPACITY,
  SHADOW_OPACITY
} from './choreography'
import { ContactShadow, EmergenceSeam } from './emergence'
import { getPointerGaze } from './pointer-gaze'
import { avatarFrames, setAvatarRoot, setEdgeObject, type SlotTarget } from './projection'

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

const BREATH_HZ = 0.22
const TAU = Math.PI * 2
/** Below this the perch target has not really moved — do not restart the tween. */
const PERCH_EPSILON = 1e-4
/**
 * How long an anchor change stamp may still clock a re-perch. Only a guard
 * against attributing a long-past anchor change to a later slot change; it must
 * comfortably exceed one frame even at 2 fps.
 */
const ANCHOR_STAMP_WINDOW_MS = 2_000

function phaseDuration(phase: ChoreographyPhase, reducedMotion: boolean): number {
  if (phase === 'celebrating') {
    return CELEBRATE_MS
  }

  if (reducedMotion) {
    return REDUCED_MS
  }

  return phase === 'emerging' ? EMERGE_MS : HIDE_MS
}

/** Which choreography a machine state starts (reduced motion never celebrates). */
function phaseForState(state: AvatarState, reducedMotion: boolean): ChoreographyPhase {
  if (state === 'emerging' || state === 'hiding') {
    return state
  }

  if (state === 'celebrating') {
    return reducedMotion ? 'rest' : 'celebrating'
  }

  return 'rest'
}

/** The machine event each phase reports once its pose is clamped at the end. */
const COMPLETION: Record<ChoreographyPhase, RigCompletionEvent | null> = {
  celebrating: 'CELEBRATED',
  emerging: 'EMERGED',
  hiding: 'HIDDEN',
  rest: null
}

/**
 * Emergence and hide own the y offset: the pose springs from the perch line, so
 * the base perch y is pinned to the target and any re-perch is deferred. Rest
 * and celebrate leave y to the re-perch tween.
 */
function phaseOwnsY(phase: ChoreographyPhase): boolean {
  return phase === 'emerging' || phase === 'hiding'
}

type Motion = {
  phase: ChoreographyPhase
  lastState: AvatarState | null
  startedAt: number
  x: number
  /** Applied base perch y; the pure pose adds its choreographed offset on top. */
  baseY: number
  /** Time-based re-perch when the anchor/slot target moves (VAL-ANCHOR-002). */
  perch: PerchTween
  /** Last `pane3dRuntime.anchorChangedAt` this rig has consumed. */
  lastAnchorChangedAt: number
  lastFade: number
  yaw: number
  /** Facing: a pure tween toward the AvatarRoom's target yaw (§8.6). */
  yawFrom: number
  yawTo: number
  yawStartedAt: number
  /** Greeting bow pitch, 0..10° — a pure envelope over BOW_MS (§8.6). */
  bow: number
  gazeX: number
  gazeY: number
  lean: number
  widen: number
  headTilt: number
  spin: number
  spinSpeed: number
  counted: boolean
}

function createMotion(target: SlotTarget): Motion {
  return {
    baseY: target.y,
    bow: 0,
    counted: false,
    gazeX: 0,
    gazeY: 0,
    headTilt: 0,
    lastAnchorChangedAt: pane3dRuntime.anchorChangedAt,
    lastFade: 1,
    lastState: null,
    lean: 0,
    perch: { fromX: target.x, fromY: target.y, startedAt: 0, toX: target.x, toY: target.y },
    phase: 'rest',
    spin: 0,
    spinSpeed: 0.02,
    startedAt: 0,
    widen: 1,
    x: target.x,
    yaw: 0,
    yawFrom: 0,
    yawStartedAt: 0,
    yawTo: 0
  }
}

/**
 * The shared rig: EVERY avatar motion lives here (architecture §8.2/§8.4).
 * Bodies are pure geometry; the rig owns breathing, gaze, facing, lean, the
 * state cues and the emergence/hide/celebrate choreography, and reports
 * animation completion so the machine can advance.
 *
 * The choreographed pose comes from the pure `scene/choreography.ts` (a
 * function of elapsed ms, clamped at the end) and is applied directly. Ambient
 * cues (breathing, gaze, lean) are damped loops and never gate completion.
 */
export function Rig({ definition, onAnimationEnd, reducedMotion, startedAt, state, target }: RigProps) {
  const root = useRef<THREE.Group>(null)
  const seam = useRef<THREE.Mesh>(null)
  const shadow = useRef<THREE.Mesh>(null)
  const motion = useRef<Motion>(createMotion(target))

  const handle = useMemo<AvatarRigHandle>(
    () => ({
      accent: null,
      accentCue: null,
      eyes: null,
      head: null,
      registerAccent: object => {
        handle.accent = object
      },
      registerAccentCue: cue => {
        handle.accentCue = cue
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

  // The seam + contact shadow group is a sibling of the body, so it registers
  // separately: its rects join the hit regions (setShape would otherwise clip
  // the shadow off) without inflating the body box the handle is sized from.
  const attachEdge = useCallback((object: THREE.Group | null) => setEdgeObject(definition.id, object), [definition.id])

  const endRef = useRef(onAnimationEnd)
  endRef.current = onAnimationEnd

  /**
   * The completion reporter. The frame loop owns the VISUALS, but a frame is not
   * guaranteed to land anywhere near the deadline — a software GL pane renders
   * at ~5 fps, so a 250 ms fade would otherwise report at 400–700 ms. The
   * deadline timer reports at the animation's own duration, and both paths
   * funnel through the same idempotent `dispatch` (a repeated event is a
   * machine no-op). §8.1 wants completion from the rig, not a fixed cycle.
   *
   * Because every pose is clamped to its endpoint, the visible avatar already
   * stands (or has already sunk) when this fires.
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
    const notifying = state === 'notifying'
    const thinking = state === 'thinking'

    // A state change starts the matching choreography. Detected in the frame
    // loop (not an effect) so the animation clock and the phase always agree.
    if (state !== m.lastState) {
      m.lastState = state
      // Anchor to the transition, not to this frame: a late frame must not
      // stretch a 250 ms fade into 500 ms of wall clock (§8.4).
      m.startedAt = startedAt > 0 ? startedAt : now
      m.phase = phaseForState(state, reducedMotion)

      // A gesture owns y: the pose springs relative to the perch line, so pin any
      // in-flight re-perch to the target first — no half-done tween to snap back from.
      if (phaseOwnsY(m.phase)) {
        m.perch.fromY = target.y
        m.perch.toY = target.y
      }
    }

    if (!m.counted && rootObject.children.length > 0) {
      countMeshes(rootObject, definition.id)
      m.counted = true
    }

    // A moved anchor or slot starts a time-based re-perch. It is a PURE function
    // of elapsed ms, not a damped step: a `damp` accumulates per frame, so with
    // dt clamped to 0.05 s it runs at roughly half speed on the 10–18 fps
    // software-GL pane and missed the ~1.5 s bound (VAL-ANCHOR-002).
    const gesturing = phaseOwnsY(m.phase)
    const anchorStamp = pane3dRuntime.anchorChangedAt

    const targetChanged =
      Math.abs(target.x - m.perch.toX) > PERCH_EPSILON || Math.abs(target.y - m.perch.toY) > PERCH_EPSILON

    if (targetChanged) {
      // An anchor change is stamped at the IPC, so measure the tween from when
      // the host window really moved — a slow frame can land hundreds of ms
      // later and would otherwise stretch the re-perch. A slot change (an
      // avatar joined the row) has no stamp and measures from this frame.
      const freshStamp = anchorStamp > m.lastAnchorChangedAt && now - anchorStamp <= ANCHOR_STAMP_WINDOW_MS
      m.lastAnchorChangedAt = Math.max(m.lastAnchorChangedAt, anchorStamp)
      m.perch = {
        // While a gesture owns y, it is pinned to the target, so start the y
        // tween there too (a no-op) and the gesture's end cannot jump.
        fromX: m.x,
        fromY: gesturing ? target.y : m.baseY,
        startedAt: freshStamp ? anchorStamp : now,
        toX: target.x,
        toY: target.y
      }
    }

    const perch = perchPose(m.perch, now - m.perch.startedAt)

    m.x = perch.x
    m.baseY = perch.y

    // The choreographed pose is a pure function of elapsed ms — never damped
    // toward a moving target — so it is already at its endpoint whenever either
    // the deadline timer or the frame check below reports completion.
    const pose = choreographyPose({
      elapsedMs: now - m.startedAt,
      height: definition.height,
      perchY: target.perchY,
      phase: m.phase,
      reducedMotion,
      restY: target.y
    })

    // Gaze follows the pointer over the handle, else eases to neutral (§8.4).
    const pointer = getPointerGaze(definition.id)

    damp(m, 'gazeX', pointer.active ? pointer.x : 0, 0.16, dt)
    damp(m, 'gazeY', pointer.active ? pointer.y : 0, 0.16, dt)

    // Facing (§8.6): the AvatarRoom publishes a target yaw (the nearest pair
    // turns toward each other, everyone else faces the user). The turn is a
    // PURE function of elapsed ms — a damped step would run at half speed on
    // this software-GL pane and miss the 2 s "back to the user" bound.
    const yawTarget = getFacingTarget(definition.id)

    if (reducedMotion) {
      m.yaw = yawTarget
      m.yawFrom = yawTarget
      m.yawTo = yawTarget
      m.yawStartedAt = now
    } else {
      if (Math.abs(yawTarget - m.yawTo) > 1e-4) {
        m.yawFrom = m.yaw
        m.yawTo = yawTarget
        m.yawStartedAt = now
      }

      m.yaw = facingPose(m.yawFrom, m.yawTo, now - m.yawStartedAt)
    }

    // The greeting bow is a one-shot envelope over BOW_MS, driven by a real
    // event (a completed emergence) — never a loop (§8.6).
    const bowStart = getBowStart(definition.id)

    m.bow = bowStart === null ? 0 : bowPitch(now - bowStart, reducedMotion)

    // Idle cues: breathing is the only looping motion (§8.4).
    const breathing = state === 'idle' || listening || thinking || state === 'responding' || state === 'notifying'
    const breath = breathing ? Math.sin((now / 1000) * TAU * BREATH_HZ) : 0
    const drift = breathing ? 0.01 * breath : 0

    damp(m, 'lean', listening ? 0.1 : notifying ? NOTIFY_LEAN : 0, 0.25, dt)
    damp(m, 'widen', listening ? 1.08 : 1, 0.25, dt)

    // The notification moment adds ONE glow pulse on top of the celebrate pose
    // (§8.5); `notifying` is a rest phase, so the pulse is its own envelope.
    const glowPulse = Math.max(pose.accentPulse, notifying ? notifyGlowPulse(now - m.startedAt, reducedMotion) : 0)

    // Responding nods are one per token-burst signal from the task executor
    // (pane3d-task-executor); the rig must not schedule them on a loop.
    rootObject.position.set(m.x, m.baseY + pose.yOffset + drift, 0)
    rootObject.rotation.x = -m.lean - m.bow
    rootObject.rotation.y = m.yaw
    rootObject.rotation.z = pose.rotationZ
    rootObject.scale.set(pose.scale, pose.scale * (1 + 0.012 * breath), pose.scale)

    // The avatar's own accent cue: Muse's halo speeds to 0.3 rev/s thinking.
    // At rest it STOPS — §8.4 allows breathing and nothing else while idle, and
    // a slowly turning tilted torus swings the avatar's screen box by ~60 px.
    damp(m, 'spinSpeed', thinking ? 0.3 : 0, 0.4, dt)
    m.spin += m.spinSpeed * TAU * dt

    if (handle.accent) {
      handle.accent.rotation.y = m.spin
      handle.accent.scale.setScalar(1 + 0.12 * glowPulse)
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

    applyFade(rootObject, pose.fade, m)
    writeEdge(seam.current, shadow.current, pose)

    // The avatar's own accent cue (§8.4). It runs after applyFade so a cue that
    // scales a material's opacity can include the emergence fade itself; it is
    // an ambient cue and never gates completion.
    handle.accentCue?.({
      dt,
      elapsedMs: now - m.startedAt,
      fade: pose.fade,
      gazeX: m.gazeX,
      gazeY: m.gazeY,
      pulse: glowPulse,
      state
    })

    const frame = avatarFrames[definition.id]

    frame.yawDeg = THREE.MathUtils.radToDeg(m.yaw)
    frame.bowDeg = THREE.MathUtils.radToDeg(m.bow)
    frame.gaze = { x: m.gazeX, y: m.gazeY }

    // Frame-side completion is idempotent with the deadline timer; it only
    // fires once the pose is clamped at its endpoint, so it never cuts a motion.
    const completion = COMPLETION[m.phase]

    if (completion && now - m.startedAt >= phaseDuration(m.phase, reducedMotion)) {
      m.phase = 'rest'
      onAnimationEnd(completion)
    }
  }, -1)

  return (
    <>
      <group ref={attachRoot}>
        <definition.Body rig={handle} state={state} />
      </group>
      <group position={[target.x, target.perchY, 0]} ref={attachEdge}>
        <EmergenceSeam color={definition.palette.glow} ref={seam} />
        <ContactShadow ref={shadow} scale={definition.height} />
      </group>
    </>
  )
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

function applyFade(root: THREE.Object3D, fade: number, m: Motion): void {
  if (fade >= 0.999 && m.lastFade >= 0.999) {
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

        material.opacity = base * fade
      }
    })
  })
  m.lastFade = fade
}

function writeEdge(seam: THREE.Mesh | null, shadow: THREE.Mesh | null, pose: Pose): void {
  if (seam) {
    const material = seam.material as THREE.MeshBasicMaterial

    material.opacity = SEAM_OPACITY * pose.seam
    // The plane geometry is SEAM_WIDTH wide, so the envelope is the width fraction.
    seam.scale.x = Math.max(0.001, pose.seam)
  }

  if (shadow) {
    ;(shadow.material as THREE.MeshBasicMaterial).opacity = SHADOW_OPACITY * pose.shadow
  }
}
