import * as THREE from 'three'


/**
 * 3D mascot engine. ONE shared orthographic scene rendered over the whole
 * viewport; each bot is a THREE.Group positioned in CSS-pixel space so a
 * mascot can hop between rooms or fly to an element it's pointing at.
 *
 * Characters are assembled characters, not blobs: rounded body, real 3D
 * eyes (pupils that look at you, periodic blinks), a mouth that opens while
 * talking, arms with hands, feet, and per-brand accessories (visor, mask,
 * halo, claws, terminal faceplate) so each harness reads on sight.
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

/** Brand skins — matched on lowercase substring of the bot name. Each sets the
 *  body color and an accessory recipe so Grok / Muse / Scout read instantly. */
type Accessory = 'visor' | 'mask' | 'halo' | 'claws' | 'ears' | 'faceplate' | 'star'

interface Skin {
  color: number
  accessory?: Accessory
}

function skinFor(name: string, fallbackHue: number): Skin {
  const n = name.toLowerCase()

  if (n.includes('grok')) {return { color: 0xd9d9e3, accessory: 'visor' }}

  if (n.includes('muse')) {return { color: 0xb48cf0, accessory: 'mask' }}

  if (n.includes('scout') || n.includes('openai')) {return { color: 0xeef4f4, accessory: 'halo' }}

  if (n.includes('claw')) {return { color: 0xe0884f, accessory: 'claws' }}

  if (n.includes('ollama') || n.includes('olla')) {return { color: 0xe4e4ee, accessory: 'ears' }}

  if (n.includes('gemini')) {return { color: 0x7aa8ff, accessory: 'star' }}

  if (n.includes('claude')) {return { color: 0xd97757 }}

  if (n.includes('codex')) {return { color: 0x3d4a4a, accessory: 'faceplate' }}

  if (n.includes('opencode') || n.includes('cli') || n.includes('acp')) {return { color: 0x2b3038, accessory: 'faceplate' }}

  return { color: new THREE.Color().setHSL(fallbackHue, 0.62, 0.56).getHex() }
}

/** tiny canvas glyph ">_" for terminal-style faceplates */
let _plateTex: THREE.CanvasTexture | null = null

function faceplateTexture(): THREE.CanvasTexture {
  if (_plateTex) {return _plateTex}
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, 128, 128)
  ctx.fillStyle = '#7dffc9'
  ctx.font = '700 44px ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  ctx.fillText('>_' , 34, 66)
  _plateTex = new THREE.CanvasTexture(c)

  return _plateTex
}

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
  private pointer = { x: 0, y: 0 }

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
    window.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX
      this.pointer.y = e.clientY
    })

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

  /** Where the user's cursor is — mascots' eyes track it. */
  pointerPos() {
    return this.pointer
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
  private head: THREE.Group
  private eyeL: THREE.Group
  private eyeR: THREE.Group
  private pupilL: THREE.Object3D
  private pupilR: THREE.Object3D
  private mouth: THREE.Mesh
  private armL: THREE.Group
  private armR: THREE.Group
  private legL: THREE.Group
  private legR: THREE.Group
  private matBody: THREE.MeshStandardMaterial
  private anim: Anim = { name: 'idle', t: 0, dur: Infinity }
  private phase: number
  private size = 40
  private speakAmount = 0
  private asleep = false
  private hoverOn = false
  private hoverT = 0
  private working = false
  private halo: THREE.Mesh
  private shadow: THREE.Mesh
  private nextBlink: number
  private blinkT = 0

  constructor(id: string, name: string, parent: THREE.Scene, private stage: OverlayScene) {
    this.id = id
    this.name = name
    const h = hash32(name)
    this.rnd = mulberry32(h)
    this.phase = this.rnd() * Math.PI * 2
    this.nextBlink = 1.5 + this.rnd() * 3

    const kind = BODY_KINDS[h % BODY_KINDS.length]!
    const skin = skinFor(name, this.rnd())
    const color = new THREE.Color(skin.color)

    this.matBody = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.38,
      metalness: 0.06,
      clearcoat: 0.7,
      clearcoatRoughness: 0.4,
    })
    this.body = new THREE.Mesh(this.bodyGeometry(kind), this.matBody)
    this.group.add(this.body)

    // head group rides the upper front of the body — eyes/mouth/face live here
    this.head = new THREE.Group()
    this.head.position.set(0, -this.size * 0.14, this.size * 0.52)
    this.group.add(this.head)

    if (skin.accessory === 'faceplate') {
      // terminal bots: a raised dark screen face with an emissive ">_" glyph
      const plate = new THREE.Mesh(
        new THREE.SphereGeometry(this.size * 0.5, 24, 16, -0.6, 1.2, 0.9, 1.1),
        new THREE.MeshBasicMaterial({ color: 0x0c1016 }),
      )

      plate.rotation.x = -Math.PI / 2 + 0.4
      plate.position.z = 2
      this.head.add(plate)

      const glyph = new THREE.Mesh(
        new THREE.PlaneGeometry(this.size * 0.62, this.size * 0.62),
        new THREE.MeshBasicMaterial({ map: faceplateTexture(), transparent: true }),
      )

      glyph.position.z = this.size * 0.30
      this.head.add(glyph)
      // eyes still present, tucked behind the plate edge — subtle
      const { l, r } = this.buildEyes(true)
      this.eyeL = l
      this.eyeR = r
    } else {
      const { l, r } = this.buildEyes(false)
      this.eyeL = l
      this.eyeR = r
    }

    this.pupilL = this.eyeL.getObjectByName('pupil')!
    this.pupilR = this.eyeR.getObjectByName('pupil')!

    // mouth — small capsule that opens while talking
    this.mouth = new THREE.Mesh(
      new THREE.CapsuleGeometry(2.2, 6, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a2b33, roughness: 0.7 }),
    )
    this.mouth.rotation.z = Math.PI / 2
    this.mouth.rotation.x = -0.25
    this.mouth.position.set(0, this.size * 0.30, this.size * 0.42)
    this.head.add(this.mouth)

    this.addAccessory(skin, color)

    // arms: shoulder-pivot groups (capsule + hand sphere), so wave/dance read
    const limbMat = new THREE.MeshPhysicalMaterial({ color: color.clone().offsetHSL(0, 0, -0.1), roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.6 })
    this.armL = this.buildArm(-1, limbMat)
    this.armR = this.buildArm(1, limbMat)
    this.group.add(this.armL, this.armR)

    // feet — squashed spheres, alternate hop while walking
    this.legL = this.buildFoot(-1, limbMat)
    this.legR = this.buildFoot(1, limbMat)
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

  private buildEyes(hidden: boolean) {
    const mk = (side: 1 | -1) => {
      const g = new THREE.Group()

      const sclera = new THREE.Mesh(
        new THREE.SphereGeometry(5.4, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xf6f7ff, roughness: 0.25 }),
      )

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(2.3, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 0.3 }),
      )

      pupil.name = 'pupil'
      pupil.position.z = 3.4
      g.add(sclera, pupil)
      g.position.set(side * this.size * 0.23, 0, this.size * 0.30)
      g.visible = !hidden
      this.head.add(g)

      return g
    }

    return { l: mk(-1), r: mk(1) }
  }

  private buildArm(side: 1 | -1, mat: THREE.Material): THREE.Group {
    const pivot = new THREE.Group()
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(4, 13, 4, 10), mat)
    arm.position.y = 7
    const hand = new THREE.Mesh(new THREE.SphereGeometry(4.6, 12, 10), mat)
    hand.position.y = 15
    pivot.add(arm, hand)
    pivot.position.set(side * this.size * 0.78, this.size * 0.06, 0)
    pivot.rotation.z = side * -0.55

    return pivot
  }

  private buildFoot(side: 1 | -1, mat: THREE.Material): THREE.Group {
    const g = new THREE.Group()
    const foot = new THREE.Mesh(new THREE.SphereGeometry(6.4, 14, 10), mat)
    foot.scale.set(1, 0.55, 1.25)
    g.add(foot)
    g.position.set(side * this.size * 0.32, this.size * 0.82, 2)

    return g
  }

  /** Per-brand accessories — the "you can tell who's who at 30 feet" layer. */
  private addAccessory(skin: Skin, color: THREE.Color) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x14161e, roughness: 0.4, metalness: 0.3 })
    const bright = new THREE.MeshStandardMaterial({ color: 0xf2f2fa, roughness: 0.3 })

    switch (skin.accessory) {
      case 'visor': {
        // Grok — black visor band + twin antennae
        const visor = new THREE.Mesh(
          new THREE.SphereGeometry(this.size * 0.52, 24, 16, -0.9, 1.8, 0.75, 0.9),
          new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.15, metalness: 0.5 }),
        )

        visor.rotation.x = -Math.PI / 2 + 0.38
        visor.position.z = 1.5
        this.head.add(visor)

        for (const side of [-1, 1] as const) {
          const ant = new THREE.Group()
          const stalk = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 14, 4, 8), dark)
          const tip = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), bright)
          tip.position.y = 9
          ant.add(stalk, tip)
          ant.position.set(side * 8, -this.size * 0.92, 0)
          ant.rotation.z = side * -0.28
          this.group.add(ant)
        }

        break
      }

      case 'mask': {
        // Muse — phantom half-mask over the upper face + a star pin
        const mask = new THREE.Mesh(
          new THREE.SphereGeometry(this.size * 0.5, 24, 16, -0.7, 1.4, 0.6, 0.9),
          new THREE.MeshStandardMaterial({ color: 0xf4f0ff, roughness: 0.35 }),
        )

        mask.rotation.x = -Math.PI / 2 + 0.45
        mask.position.set(3, -2, 3)
        this.head.add(mask)
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(4.5), new THREE.MeshStandardMaterial({ color: 0xffd76a, roughness: 0.25 }))
        star.scale.set(1, 1, 0.4)
        star.position.set(this.size * 0.34, -this.size * 0.55, this.size * 0.5)
        star.rotation.z = 0.4
        this.group.add(star)

        break
      }

      case 'halo': {
        // Scout/OpenAI — floating teal halo ring above the head
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(this.size * 0.34, 1.6, 10, 28),
          new THREE.MeshStandardMaterial({ color: 0x10c9a5, roughness: 0.3, emissive: 0x0a5a48 }),
        )

        ring.position.set(0, -this.size * 1.06, 0)
        ring.rotation.x = Math.PI / 2 - 0.25
        this.group.add(ring)

        break
      }

      case 'claws': {
        // OpenClaw — pincer cones instead of round hands
        for (const side of [-1, 1] as const) {
          const claw = new THREE.Group()

          for (const s of [-1, 1] as const) {
            const c = new THREE.Mesh(new THREE.ConeGeometry(3.4, 9, 10), bright)
            c.position.set(s * 3.4, 0, 0)
            c.rotation.z = s * -0.5
            claw.add(c)
          }

          claw.position.set(side * this.size * 0.95, this.size * 0.12, 0)
          this.group.add(claw)
        }

        break
      }

      case 'ears': {
        // Ollama — llama ears
        for (const side of [-1, 1] as const) {
          const ear = new THREE.Mesh(new THREE.ConeGeometry(4.5, 13, 10), new THREE.MeshStandardMaterial({ color: color.clone().offsetHSL(0, 0, -0.05) }))
          ear.position.set(side * 10, -this.size * 0.95, 0)
          ear.rotation.z = side * -0.22
          this.group.add(ear)
        }

        break
      }

      case 'star': {
        // Gemini — violet 4-point star floating at temple height
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(5), new THREE.MeshStandardMaterial({ color: 0xb48cff, roughness: 0.2, emissive: 0x3b2a66 }))
        s.scale.set(1, 1.6, 0.4)
        s.position.set(this.size * 0.42, -this.size * 0.6, this.size * 0.45)
        this.group.add(s)

        break
      }

      case 'faceplate':
        break // built in the head section

      default:
        break // 3D eyes + mouth are the face — no decal texture needed
    }
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
        this.walkBob()
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
    this.armL.rotation.z = 0.55
    this.armR.rotation.z = -0.55
    this.armL.rotation.x = 0
    this.armR.rotation.x = 0
    this.legL.rotation.x = 0
    this.legR.rotation.x = 0
    this.legL.position.y = this.size * 0.82
    this.legR.position.y = this.size * 0.82
    this.head.rotation.set(0, 0, 0)
    this.head.position.y = -this.size * 0.14

    const wob = Math.sin(t * 2.4 + this.phase)

    switch (a.name) {
      case 'idle':
        // calm breathing + micro forward tilt so it reads alive, not bobbing
        y = wob * 2.6
        sy = 1 + wob * 0.028
        sx = 1 - wob * 0.018
        g.rotation.x = wob * 0.035
        // idle micro-gestures: slight head sway + occasional arm drift
        this.head.rotation.z = wob * 0.06
        this.armL.rotation.z = 0.55 + wob * 0.07
        this.armR.rotation.z = -0.55 - wob * 0.07

        break

      case 'walk':
        this.walkBob()

        break
      case 'dance': {
        y = Math.abs(Math.sin(t * 7)) * -16
        g.rotation.z = Math.sin(t * 7) * 0.28
        g.rotation.y = Math.sin(t * 3.5) * 0.6
        this.armL.rotation.z = 0.55 + Math.sin(t * 7) * 1.3
        this.armR.rotation.z = -0.55 + Math.sin(t * 7 + Math.PI) * 1.3
        this.legL.position.y = this.size * 0.82 - Math.abs(Math.sin(t * 7)) * 5
        this.legR.position.y = this.size * 0.82 - Math.abs(Math.sin(t * 7 + Math.PI)) * 5
        this.head.rotation.z = Math.sin(t * 7) * 0.12

        break
      }

      case 'wave':
        this.armR.rotation.z = -2.4 + Math.sin(t * 10) * 0.5
        this.armR.rotation.x = 0.3
        y = Math.sin(t * 6) * -4
        this.head.rotation.z = -0.08

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
        this.armL.rotation.z = 1.4
        this.armR.rotation.z = -1.4

        break
      }

      case 'celebrate': {
        y = -Math.abs(Math.sin(t * 5)) * 30
        this.armL.rotation.z = 2.6
        this.armR.rotation.z = -2.6
        this.head.rotation.z = Math.sin(t * 10) * 0.08

        if (a.t - dt <= 0 && a.t > 0) {
          this.stage.burst(g.position.x, this.baseY - 40, this.matBody.color)
        }

        break
      }

      case 'sleep':
        sy = 0.88
        sx = 1.06
        y = 4 + wob * 1.4
        this.head.rotation.z = 0.14

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
        this.head.rotation.z = Math.sin(t * 5) * 0.05

        break
    }

    // smooth-in for the action envelope
    y *= ease

    // ── eyes: blink + track the pointer ──
    this.nextBlink -= dt

    if (this.nextBlink <= 0) {
      this.blinkT = 0.12
      this.nextBlink = 2.4 + this.rnd() * 3
    }

    this.blinkT = Math.max(0, this.blinkT - dt)
    const blinkScale = this.asleep ? 0.12 : this.blinkT > 0 ? 0.15 : 1
    this.eyeL.scale.y = blinkScale
    this.eyeR.scale.y = blinkScale

    const ptr = this.stage.pointerPos()
    const lookX = Math.max(-1.7, Math.min(1.7, (ptr.x - g.position.x) / 220))
    const lookY = Math.max(-1.4, Math.min(1.4, (ptr.y - this.baseY) / 260))
    this.pupilL.position.x = lookX
    this.pupilR.position.x = lookX
    this.pupilL.position.y = lookY
    this.pupilR.position.y = lookY

    // ── mouth: opens while talking, soft smile otherwise ──
    const mouthOpen = this.speakAmount > 0 ? 0.35 + Math.abs(Math.sin(t * 13)) * 0.65 : 0
    this.mouth.scale.set(1, 1 - mouthOpen * 0.55, 1 + mouthOpen * 0.8)
    this.mouth.position.y = this.size * 0.30 + mouthOpen * 1.5
    this.head.position.y += this.speakAmount * Math.sin(t * 13) * 0.6

    // sleep: head droops
    if (this.asleep) {
      this.head.rotation.z += 0.1
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

  private walkBob() {
    const t = performance.now() / 1000
    this.legL.position.y = this.size * 0.82 - Math.abs(Math.sin(t * 16)) * 5
    this.legR.position.y = this.size * 0.82 - Math.abs(Math.sin(t * 16 + Math.PI)) * 5
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
