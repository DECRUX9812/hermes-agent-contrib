import * as THREE from 'three'

import { faceCanvas } from './face'

/**
 * 3D mascot engine. ONE shared orthographic scene rendered over the whole
 * viewport; each bot is a THREE.Group positioned in CSS-pixel space so a
 * mascot can hop between rooms or fly to an element it's pointing at.
 *
 * Identity is deterministic per name (same seed vocabulary as blobatar):
 * shape + hue derive from the name, so a bot looks identical everywhere.
 */

function hash32(s: string): number {
  let h = 2166136261 >>> 0

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  return h >>> 0
}

function mulberry32(seed: number) {
  let a = seed >>> 0

  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// shared soft radial-gradient texture — contact shadows + working halos
let _softTex: THREE.CanvasTexture | null = null

function softTexture(): THREE.CanvasTexture {
  if (_softTex) {return _softTex}
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.55, 'rgba(255,255,255,.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  _softTex = new THREE.CanvasTexture(c)

  return _softTex
}

type BodyKind = 'round' | 'boxy' | 'capsule' | 'blob' | 'cone' | 'bean'

const BODY_KINDS: BodyKind[] = ['round', 'boxy', 'capsule', 'blob', 'cone', 'bean']

export type MascotAction =
  | 'idle'
  | 'dance'
  | 'wave'
  | 'spin'
  | 'jump'
  | 'celebrate'
  | 'sleep'
  | 'point'
  | 'talk'
  | 'walk'

interface Anim {
  name: MascotAction
  t: number
  dur: number // seconds; Infinity = until replaced
  target?: { x: number; y: number }
}

interface Particle {
  mesh: THREE.Mesh
  vx: number
  vy: number
  vz: number
  life: number
}

export class OverlayScene {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.OrthographicCamera
  private mascots = new Map<string, Mascot>()
  private particles: Particle[] = []
  private clock = new THREE.Clock()
  private raf = 0
  private visible = true

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -500, 500)
    this.resize()
    window.addEventListener('resize', () => this.resize())

    const key = new THREE.DirectionalLight(0xfff4e0, 2.0)
    key.position.set(0.6, 1.4, 2.2)
    this.scene.add(key)
    // cool rim from behind-left separates the body from the page
    const rim = new THREE.DirectionalLight(0x9db4ff, 1.15)
    rim.position.set(-1.6, -0.6, -1.8)
    this.scene.add(rim)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4480, 1.0))
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    document.addEventListener('visibilitychange', () => {
      this.visible = !document.hidden
    })
    this.loop()
  }

  resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    // Ortho in CSS pixels; +y DOWN to match DOM coords.
    this.camera.left = 0
    this.camera.right = w
    this.camera.top = 0
    this.camera.bottom = h
    this.camera.updateProjectionMatrix()
    // Re-clamp everyone into the new viewport — a shrunk window must not
    // strand a mascot off-screen (drag targets and docked rails included).
    const M = 70

    for (const m of this.mascots.values()) {
      const cx = Math.min(Math.max(m.group.position.x, M), w - M)
      const cy = Math.min(Math.max(m.group.position.y, M), h - M)
      m.group.position.x = cx
      m.group.position.y = cy
      m.baseY = cy
      const ud = m.group.userData

      if (typeof ud.tx === 'number') {ud.tx = Math.min(Math.max(ud.tx, M), w - M)}

      if (typeof ud.ty === 'number') {ud.ty = Math.min(Math.max(ud.ty, M), h - M)}
    }
  }

  add(id: string, name: string, x: number, y: number) {
    const m = new Mascot(id, name, this.scene, this)
    m.group.position.set(x, y, 0)
    m.baseY = y
    this.mascots.set(id, m)
    m.play('celebrate', 0.9)
  }

  remove(id: string) {
    const m = this.mascots.get(id)

    if (m) {
      m.dispose()
      this.mascots.delete(id)
    }
  }

  has(id: string) {
    return this.mascots.has(id)
  }

  get(id: string): Mascot | undefined {
    return this.mascots.get(id)
  }

  ids() {
    return this.mascots.keys()
  }

  /** Fire a celebration particle burst at a position. */
  burst(x: number, y: number, color: THREE.Color) {
    const rnd = mulberry32(hash32(`${x},${y},${performance.now()}`))

    for (let i = 0; i < 26; i++) {
      const g = new THREE.SphereGeometry(2.6, 8, 8)

      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(rnd(), 0.9, 0.6),
      })

      const mesh = new THREE.Mesh(g, mat)
      mesh.position.set(x, y, 0)
      this.scene.add(mesh)
      const a = rnd() * Math.PI * 2
      const sp = 120 + rnd() * 200
      this.particles.push({
        mesh,
        vx: Math.cos(a) * sp,
        vy: -Math.abs(Math.sin(a)) * sp - 60,
        vz: (rnd() - 0.5) * 60,
        life: 0.9 + rnd() * 0.7,
      })
    }

    void color
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)

    if (!this.visible) {
      this.clock.getDelta()

      return
    }

    const dt = Math.min(this.clock.getDelta(), 0.05)

    for (const m of this.mascots.values()) {m.update(dt)}

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!
      p.life -= dt

      if (p.life <= 0) {
        this.scene.remove(p.mesh)
        p.mesh.geometry.dispose()
        ;(p.mesh.material as THREE.Material).dispose()
        this.particles.splice(i, 1)

        continue
      }

      p.vy += 700 * dt
      p.mesh.position.x += p.vx * dt
      p.mesh.position.y += p.vy * dt
      p.mesh.position.z += p.vz * dt
      p.mesh.rotation.x += dt * 6
      p.mesh.rotation.z += dt * 4
      ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life)
      ;(p.mesh.material as THREE.MeshBasicMaterial).transparent = true
    }

    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    cancelAnimationFrame(this.raf)

    for (const m of this.mascots.values()) {m.dispose()}
    this.renderer.dispose()
  }
}

export class Mascot {
  readonly id: string
  readonly name: string
  group = new THREE.Group()
  baseY = 0
  private rnd: () => number
  private body: THREE.Mesh
  private face: THREE.Mesh
  private armL: THREE.Mesh
  private armR: THREE.Mesh
  private legL: THREE.Mesh
  private legR: THREE.Mesh
  private matBody: THREE.MeshStandardMaterial
  private anim: Anim = { name: 'idle', t: 0, dur: Infinity }
  private phase: number
  private size = 34
  private speakAmount = 0
  private asleep = false
  private hoverOn = false
  private hoverT = 0
  private working = false
  private halo: THREE.Mesh
  private shadow: THREE.Mesh

  constructor(id: string, name: string, parent: THREE.Scene, private stage: OverlayScene) {
    this.id = id
    this.name = name
    const h = hash32(name)
    this.rnd = mulberry32(h)
    this.phase = this.rnd() * Math.PI * 2

    const kind = BODY_KINDS[h % BODY_KINDS.length]!
    const hue = this.rnd()
    const color = new THREE.Color().setHSL(hue, 0.62, 0.56)

    this.matBody = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.42,
      metalness: 0.05,
      clearcoat: 0.6,
      clearcoatRoughness: 0.55,
    })
    this.body = new THREE.Mesh(this.bodyGeometry(kind), this.matBody)
    this.body.castShadow = false
    this.group.add(this.body)

    // Face: blobatar canvas as a texture on a slightly domed disc.
    this.face = new THREE.Mesh(
      new THREE.SphereGeometry(this.size * 0.52, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
      new THREE.MeshBasicMaterial({ transparent: true }),
    )
    this.face.rotation.x = -Math.PI / 2 + 0.42
    this.face.position.set(0, -this.size * 0.12, this.size * 0.58)
    this.group.add(this.face)
    void faceCanvas(name).then((c) => {
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      ;(this.face.material as THREE.MeshBasicMaterial).map = tex
      ;(this.face.material as THREE.MeshBasicMaterial).needsUpdate = true
    })

    const limbMat = new THREE.MeshPhysicalMaterial({ color: color.clone().offsetHSL(0, 0, -0.08), roughness: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.7 })
    const armGeo = new THREE.CapsuleGeometry(3.4, 14, 4, 8)
    this.armL = new THREE.Mesh(armGeo, limbMat)
    this.armR = new THREE.Mesh(armGeo, limbMat)
    this.armL.position.set(-this.size * 0.72, this.size * 0.05, 0)
    this.armR.position.set(this.size * 0.72, this.size * 0.05, 0)
    this.armL.rotation.z = 0.5
    this.armR.rotation.z = -0.5
    this.group.add(this.armL, this.armR)

    const legGeo = new THREE.CapsuleGeometry(4, 9, 4, 8)
    this.legL = new THREE.Mesh(legGeo, limbMat)
    this.legR = new THREE.Mesh(legGeo, limbMat)
    this.legL.position.set(-this.size * 0.3, this.size * 0.78, 0)
    this.legR.position.set(this.size * 0.3, this.size * 0.78, 0)
    this.group.add(this.legL, this.legR)

    // soft drop shadow pinned to the "ground" + a halo that glows while working
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(this.size * 2.7, this.size * 1.0),
      new THREE.MeshBasicMaterial({ map: softTexture(), color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    )
    this.shadow.position.set(0, this.size * 0.95, -30)
    this.group.add(this.shadow)

    this.halo = new THREE.Mesh(
      new THREE.PlaneGeometry(this.size * 3.4, this.size * 3.4),
      new THREE.MeshBasicMaterial({ map: softTexture(), color, transparent: true, opacity: 0, depthWrite: false }),
    )
    this.halo.position.set(0, this.size * 0.05, -40)
    this.group.add(this.halo)

    parent.add(this.group)
  }

  private bodyGeometry(kind: BodyKind): THREE.BufferGeometry {
    const s = this.size

    switch (kind) {
      case 'round':
        return new THREE.SphereGeometry(s, 32, 24)

      case 'boxy':
        return new THREE.BoxGeometry(s * 1.5, s * 1.5, s * 1.5, 2, 2, 2)

      case 'capsule':
        return new THREE.CapsuleGeometry(s * 0.72, s * 0.8, 8, 16)

      case 'blob':
        return new THREE.IcosahedronGeometry(s, 1)

      case 'cone':
        return new THREE.ConeGeometry(s * 0.85, s * 1.7, 24)
      case 'bean': {
        const g = new THREE.SphereGeometry(s, 32, 24)
        g.scale(1, 0.72, 0.9)

        return g
      }
    }
  }

  /** Position in CSS pixels (scene space = DOM space). */
  moveTo(x: number, y: number) {
    this.baseY = y
    // slide toward target — real tween happens in update
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

  update(dt: number) {
    const g = this.group
    const ud = g.userData as { tx?: number; ty?: number; vx?: number; vy?: number }
    let stretch = 0

    // Damped spring toward the drag target — soft overshoot, no linear glide.
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

      if (speed > 30) {
        this.walkBob(dt)
      }

      // squash-and-stretch along travel — the bigger the pull, the longer the body
      stretch = Math.min(0.22, speed / 2600)
      g.rotation.z = Math.max(-0.3, Math.min(0.3, -vx / 2400))
    }

    const a = this.anim
    a.t += dt
    const t = a.t
    const done = t >= a.dur

    // ease-in over ~160ms so action cuts never pop
    const e = Math.min(1, t / 0.16)
    const ease = e * e * (3 - 2 * e)

    // reset transient transforms every frame, then apply current action
    const dragLean = g.rotation.z
    g.rotation.set(0, 0, dragLean)
    let y = 0
    let sx = 1
    let sy = 1
    this.armL.rotation.z = 0.5
    this.armR.rotation.z = -0.5
    this.armL.rotation.x = 0
    this.armR.rotation.x = 0
    this.legL.rotation.x = 0
    this.legR.rotation.x = 0

    const wob = Math.sin(t * 2.4 + this.phase)

    switch (a.name) {
      case 'idle':
        // calm breathing + micro forward tilt so it reads alive, not bobbing
        y = wob * 2.6
        sy = 1 + wob * 0.028
        sx = 1 - wob * 0.018
        g.rotation.x = wob * 0.035

        break

      case 'walk':
        this.walkBob(dt)

        break
      case 'dance': {
        y = Math.abs(Math.sin(t * 7)) * -16
        g.rotation.z = Math.sin(t * 7) * 0.28
        g.rotation.y = Math.sin(t * 3.5) * 0.6
        this.armL.rotation.z = 0.5 + Math.sin(t * 7) * 1.3
        this.armR.rotation.z = -0.5 + Math.sin(t * 7 + Math.PI) * 1.3
        this.legL.rotation.x = Math.sin(t * 7) * 0.5
        this.legR.rotation.x = -Math.sin(t * 7) * 0.5

        break
      }

      case 'wave':
        this.armR.rotation.z = -2.4 + Math.sin(t * 10) * 0.5
        y = Math.sin(t * 6) * -4

        break

      case 'spin':
        g.rotation.y = t * 10
        y = Math.sin(Math.min(t / a.dur, 1) * Math.PI) * -14

        break
      case 'jump': {
        const k = Math.min(t / 0.7, 1)
        y = -Math.sin(k * Math.PI) * 46
        sy = 1 + Math.sin(k * Math.PI) * 0.18
        sx = 1 - Math.sin(k * Math.PI) * 0.12

        break
      }

      case 'celebrate': {
        y = -Math.abs(Math.sin(t * 5)) * 30
        this.armL.rotation.z = 2.6
        this.armR.rotation.z = -2.6

        if (a.t - dt <= 0 && a.t > 0) {
          this.stage.burst(g.position.x, this.baseY - 40, this.matBody.color)
        }

        break
      }

      case 'sleep':
        sy = 0.88
        sx = 1.06
        y = 4 + wob * 1.4

        break
      case 'point': {
        const tx = a.target?.x ?? g.position.x + 100
        const ty = a.target?.y ?? this.baseY
        const dx = tx - g.position.x
        const dy = ty - this.baseY
        const ang = Math.atan2(dy, dx)
        g.rotation.z = -ang * 0.22
        this.armR.rotation.z = -ang - Math.PI / 2
        this.armR.rotation.x = 0
        y = -Math.abs(Math.sin(t * 4)) * 5

        break
      }

      case 'talk':
        sy = 1 + Math.sin(t * 14) * 0.04
        y = wob * 2

        break
    }

    // smooth-in for the action envelope
    y *= ease

    // talking pulse on the face
    if (this.speakAmount > 0) {
      const s = 1 + Math.abs(Math.sin(t * 11)) * 0.1 * this.speakAmount
      this.face.scale.set(s, s, 1)
    } else {
      this.face.scale.set(1, 1, 1)
    }

    // sleep: eyelid droop via face scale squash
    if (this.asleep) {
      this.face.scale.set(1, Math.max(0.25, 1 - Math.min(1, a.t)), 1)
    }

    // hover: gentle lift + scale; travel: squash-stretch
    this.hoverT += ((this.hoverOn ? 1 : 0) - this.hoverT) * Math.min(1, dt * 10)
    const lift = this.hoverT * -6
    sy *= 1 + this.hoverT * 0.08 + stretch
    sx *= (1 + this.hoverT * 0.08) * (1 - stretch * 0.55)

    g.position.y = this.baseY + y + lift
    g.scale.set(sx, sy, 1)

    // shadow stays glued to the ground plane; fades as the mascot gains height
    const height = Math.max(0, -(y + lift))
    this.shadow.position.y = this.size * 0.95 + height
    const shk = 1 / (1 + height / 200)
    this.shadow.scale.set(shk, shk, 1)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * shk

    // halo: soft glow pulse while working, faint presence on hover
    const haloMat = this.halo.material as THREE.MeshBasicMaterial

    const haloTarget = this.working
      ? 0.32 + Math.abs(Math.sin(t * 3.2 + this.phase)) * 0.2
      : this.hoverT * 0.18

    haloMat.opacity += (haloTarget - haloMat.opacity) * Math.min(1, dt * 7)

    if (done && a.name !== 'idle' && a.name !== 'sleep') {
      this.anim = { name: this.asleep ? 'sleep' : 'idle', t: 0, dur: Infinity }
    }
  }

  private walkBob(dt: number) {
    const t = performance.now() / 1000
    this.legL.rotation.x = Math.sin(t * 16) * 0.7
    this.legR.rotation.x = -Math.sin(t * 16) * 0.7
    void dt
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
