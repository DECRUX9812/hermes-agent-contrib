/**
 * MarkMascot — a canonical brand mark as the whole character.
 *
 * The OpenClaw lobster is the reference: its canonical 120×120 vector is
 * extruded per-part so claws snap on their real hinges, antennae wiggle, and
 * the teal pupils track the pointer and blink — the same SMIL timings the
 * openclaw.ai hero uses (float 4s, antenna wiggle 2s, blink 3s, claw snap
 * staggered at the tail of each 4s loop), layered with the shared
 * MascotAction vocabulary (dance/wave/spin/jump/celebrate/sleep/point/talk/
 * walk) so it plays by the same room rules as every blob.
 */

import * as THREE from 'three'

import { buildMark, type MarkSpec } from './marks'
import type { MascotAction } from './mascot3d'

interface Anim {
  name: MascotAction
  t: number
  dur: number
  target?: { x: number; y: number }
}

/** minimal stage surface the mascot needs (avoids a circular import) */
export interface MarkStage {
  pointerPos(): { x: number; y: number }
  burst(x: number, y: number, color: THREE.Color): void
}

let _soft: THREE.CanvasTexture | null = null

function softTexture(): THREE.CanvasTexture {
  if (_soft) {return _soft}
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  _soft = new THREE.CanvasTexture(c)

  return _soft
}

export class MarkMascot {
  readonly id: string
  readonly name: string
  group = new THREE.Group()
  baseY = 0
  private anim: Anim = { name: 'idle', t: 0, dur: Infinity }
  private mark: THREE.Group
  private parts: Map<string, THREE.Group>
  private tint: THREE.Color
  private shadow: THREE.Mesh
  private halo: THREE.Mesh
  private phase: number
  private size = 95 // mark height in scene px — reads like the 80px blobs
  private speakAmount = 0
  private asleep = false
  private hoverOn = false
  private hoverT = 0
  private working = false
  private age = 0
  private nextBlink: number
  private blinkT = 0

  constructor(id: string, name: string, spec: MarkSpec, parent: THREE.Scene, private stage: MarkStage) {
    this.id = id
    this.name = name
    const built = buildMark(spec, this.size)
    this.mark = built.group
    this.parts = built.parts
    this.tint = built.tint
    this.phase = Math.random() * Math.PI * 2
    this.nextBlink = 1.5 + Math.random() * 3
    this.group.add(this.mark)

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.size * 1.35, this.size * 0.5),
      new THREE.MeshBasicMaterial({ map: softTexture(), color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    )
    this.shadow.position.set(0, this.size * 0.55, -30)
    this.group.add(this.shadow)

    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(this.size * 2.2, this.size * 2.2),
      new THREE.MeshBasicMaterial({ map: softTexture(), color: this.tint, transparent: true, opacity: 0, depthWrite: false }),
    )
    this.halo.position.set(0, 0, -40)
    this.group.add(this.halo)

    parent.add(this.group)
  }

  moveTo(x: number, y: number) {
    this.baseY = y
    this.group.userData.tx = x
    this.group.userData.ty = y
  }

  play(action: MascotAction, dur = 1.2, target?: { x: number; y: number }) {
    this.asleep = action === 'sleep'
    this.anim = { name: action, t: 0, dur, target }
  }

  setTalking(v: boolean) {
    this.speakAmount = v ? 1 : 0
  }

  setHover(v: boolean) {
    this.hoverOn = v
  }

  setWorking(v: boolean) {
    this.working = v
  }

  pointAt(x: number, y: number) {
    this.play('point', 1.6, { x, y })
  }

  /** pivot helpers — rotate a named part around its authored hinge */
  private rot(key: string, rad: number) {
    const p = this.parts.get(key)

    if (p) {p.rotation.z = rad}
  }

  update(dt: number) {
    const g = this.group
    const ud = g.userData as { tx?: number; ty?: number; vx?: number; vy?: number }
    let stretch = 0
    this.age += dt

    // damped spring toward drag target — identical gait to the blob mascots
    if (ud.tx !== undefined) {
      const dx = ud.tx - g.position.x
      const dy = ud.ty! - this.baseY
      const vx = (ud.vx ?? 0) + (dx * 90 - (ud.vx ?? 0) * 12) * dt
      const vy = (ud.vy ?? 0) + (dy * 90 - (ud.vy ?? 0) * 12) * dt
      g.position.x += vx * dt
      this.baseY += vy * dt
      ud.vx = vx
      ud.vy = vy
      const speed = Math.hypot(vx, vy)
      stretch = Math.min(0.22, speed / 2600)
      g.rotation.z = Math.max(-0.3, Math.min(0.3, -vx / 2400))
    }

    const a = this.anim
    a.t += dt
    const t = a.t
    const done = t >= a.dur
    const e = Math.min(1, t / 0.16)
    const ease = e * e * (3 - 2 * e)
    const dragLean = g.rotation.z
    g.rotation.set(0, 0, dragLean)
    let y = 0
    let sx = 1
    let sy = 1
    let clawL = 0
    let clawR = 0
    let antL = 0
    let antR = 0
    let tiltZ = 0

    /* Canonical hero loop — runs under EVERY action so the character never
       goes robotic: float 4s / antenna wiggle 2s / claw snap tail of 4s. */
    const floatT = (this.age % 4) / 4
    // canonical float: 0→-5→0 over the 4s loop (keyTimes 0/.5/1)
    const fk = 0.5 - Math.cos(floatT * Math.PI * 2) / 2
    y += -5 * (this.size / 120) * fk * ease // ≈ -4% of height at peak
    const wig = Math.sin((this.age % 2) / 2 * Math.PI * 2) * 0.052 // ±3°
    antL += wig
    antR += wig
    // canonical snap: rotate -8° during the 85–95% slice of each 4s loop
    const snapPhase = (p: number) => (p > 0.85 && p < 0.95 ? Math.sin(((p - 0.85) / 0.1) * Math.PI) : 0)
    clawL += -0.14 * snapPhase(floatT)
    clawR += -0.14 * snapPhase(((this.age + 0.2) % 4) / 4)

    const wob = Math.sin(this.age * 2.4 + this.phase)

    switch (a.name) {
      case 'idle':
        y += wob * 1.6
        sy = 1 + wob * 0.02
        sx = 1 - wob * 0.014
        g.rotation.x = wob * 0.03

        break

      case 'walk':
        y += Math.abs(Math.sin(this.age * 16)) * -3
        tiltZ = Math.sin(this.age * 8) * 0.06

        break
      case 'dance': {
        y += Math.abs(Math.sin(t * 7)) * -14
        g.rotation.z = Math.sin(t * 7) * 0.24
        g.rotation.y = Math.sin(t * 3.5) * 0.5
        clawL += -0.5 * Math.abs(Math.sin(t * 7))
        clawR += -0.5 * Math.abs(Math.sin(t * 7 + Math.PI))
        antL += Math.sin(t * 10) * 0.18
        antR += Math.sin(t * 10 + 1) * 0.18

        break
      }

      case 'wave': {
        clawR += -1.15 + Math.sin(t * 10) * 0.18 // raised claw
        g.rotation.x = 0.06
        y += Math.sin(t * 6) * -4
        tiltZ = -0.06

        break
      }

      case 'spin':
        g.rotation.y = t * 10
        y += Math.sin(Math.min(t / a.dur, 1) * Math.PI) * -12

        break
      case 'jump': {
        const k = Math.min(t / 0.7, 1)
        y += -Math.sin(k * Math.PI) * 44
        sy = 1 + Math.sin(k * Math.PI) * 0.16
        sx = 1 - Math.sin(k * Math.PI) * 0.1
        clawL += -0.8 * Math.sin(k * Math.PI)
        clawR += -0.8 * Math.sin(k * Math.PI)

        break
      }

      case 'celebrate': {
        y += -Math.abs(Math.sin(t * 5)) * 26
        clawL += -0.9
        clawR += -0.9
        antL += Math.sin(t * 12) * 0.22
        antR += Math.sin(t * 12 + 0.7) * 0.22

        if (a.t - dt <= 0 && a.t > 0) {
          this.stage.burst(g.position.x, this.baseY - 40, this.tint)
        }

        break
      }

      case 'sleep':
        sy = 0.88
        sx = 1.06
        y += 4 + wob * 1.2
        antL += -0.35
        antR += -0.35
        clawL += 0.15
        clawR += 0.15

        break
      case 'point': {
        const tx = a.target?.x ?? g.position.x + 100
        const ty = a.target?.y ?? this.baseY
        const dx = tx - g.position.x
        const dy = ty - this.baseY
        const ang = Math.atan2(dy, dx)
        g.rotation.z = -ang * 0.2
        clawR += -ang - Math.PI / 2 - 0.4 // right claw aims at the target
        y += -Math.abs(Math.sin(t * 4)) * 5

        break
      }

      case 'talk':
        sy = 1 + Math.sin(t * 14) * 0.035
        y += wob * 1.6
        clawL += Math.sin(t * 13) * 0.1
        clawR += Math.sin(t * 13 + 1.2) * 0.1

        break
    }

    // working: claw snaps every ~1.1s + doubled antenna speed
    if (this.working) {
      const wl = (this.age % 1.1) / 1.1
      const wr = ((this.age + 0.18) % 1.1) / 1.1
      clawL += -0.4 * snapPhase(wl)
      clawR += -0.4 * snapPhase(wr)
      antL += Math.sin(this.age * 9) * 0.08
      antR += Math.sin(this.age * 9 + 0.9) * 0.08
    }

    this.rot('clawL', clawL)
    this.rot('clawR', clawR)
    this.rot('antL', antL)
    this.rot('antR', antR)
    g.rotation.z += tiltZ

    /* pupils: canonical blink (a scale squish on the 3s cycle) + pointer
       tracking — pivots sit at each pupil's centre so both are transforms */
    this.nextBlink -= dt

    if (this.nextBlink <= 0) {
      this.nextBlink = 2.4 + Math.random() * 3
      this.blinkT = 0.14
    }

    this.blinkT = Math.max(0, this.blinkT - dt)
    const pupScale = this.asleep ? 0.1 : this.blinkT > 0 ? 0.25 : 1
    const ptr = this.stage.pointerPos()
    const lookX = Math.max(-1.8, Math.min(1.8, (ptr.x - g.position.x) / 220))
    const lookY = Math.max(-1.4, Math.min(1.4, (ptr.y - this.baseY) / 260))

    for (const k of ['pupL', 'pupR']) {
      const p = this.parts.get(k)

      if (p) {
        p.scale.set(1, pupScale, 1)
        p.position.x = (k === 'pupL' ? 46 : 76) + lookX
        p.position.y = 34 + lookY
      }
    }

    y *= ease
    this.hoverT += ((this.hoverOn ? 1 : 0) - this.hoverT) * Math.min(1, dt * 10)
    const lift = this.hoverT * -6
    sy *= 1 + this.hoverT * 0.08 + stretch
    sx *= (1 + this.hoverT * 0.08) * (1 - stretch * 0.55)

    g.position.y = this.baseY + y + lift
    g.scale.set(sx, sy, 1)

    const height = Math.max(0, -(y + lift))
    this.shadow.position.y = this.size * 0.55 + height
    const shk = 1 / (1 + height / 200)
    this.shadow.scale.set(shk, shk, 1)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * shk

    const haloMat = this.halo.material as THREE.MeshBasicMaterial

    const haloTarget = this.working
      ? 0.32 + Math.abs(Math.sin(this.age * 3.2 + this.phase)) * 0.2
      : this.hoverT * 0.18

    haloMat.opacity += (haloTarget - haloMat.opacity) * Math.min(1, dt * 7)

    if (done && a.name !== 'idle' && a.name !== 'sleep') {
      this.anim = { name: this.asleep ? 'sleep' : 'idle', t: 0, dur: Infinity }
    }
  }

  dispose() {
    this.group.parent?.remove(this.group)
    this.group.traverse((o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const m = o.material as THREE.Material | THREE.Material[]

        if (Array.isArray(m)) {m.forEach((x) => x.dispose())}
        else {m.dispose()}
      }
    })
  }
}
