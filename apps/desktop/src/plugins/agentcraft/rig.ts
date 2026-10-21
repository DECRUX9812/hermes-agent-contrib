/**
 * Minecraft-format character rigs: box parts textured by a 64×64 skin PNG
 * (the mod's bundled agent skins, MIT). Standard Steve/Alex layout — head,
 * torso, arms (wide or 3px slim), legs, plus the 8 overlay (jacket/hat) layers.
 * Postures animate limb pivots; walking swings by a phase.
 */

import * as THREE from 'three'

export type Posture =
  | 'idle'
  | 'walk'
  | 'sit'
  | 'sit_type'
  | 'type'
  | 'think'
  | 'read'
  | 'talk'
  | 'relax'
  | 'wait'
  | 'error'
  | 'celebrate'

export interface RigParts {
  root: THREE.Group
  body: THREE.Group
  head: THREE.Group
  torso: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
}

const PX = 1 / 16 // one skin pixel → world units (blocks)
const TEX = 64

/**
 * Build a box part whose faces sample skin-UV rectangles.
 * `w,h,d` in pixels; `u,v` region origin in the skin; overlay pulls the region
 * from the second layer (inflated by `infl` px).
 */
function part(w: number, h: number, d: number, u: number, v: number, overlay?: { u: number; v: number; infl: number }): THREE.Group {
  const g = new THREE.Group()
  const base = boxWithSkin(w, h, d, u, v, 0)
  g.add(base)

  if (overlay) {
    const ov = boxWithSkin(w + overlay.infl * 2, h + overlay.infl * 2, d + overlay.infl * 2, overlay.u, overlay.v, 0)
    g.add(ov)
  }

  return g
}

function boxWithSkin(w: number, h: number, d: number, u: number, v: number, _infl: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w * PX, h * PX, d * PX)

  // three BoxGeometry face order: +x, -x, +y, -y, +z, -z
  // MC skin layout per part at (u,v): top (u+d, v, w, d); bottom (u+d+w, v, w, d);
  // right(−x of the char? actually the char's right = +x in MC...) — use the
  // conventional mapping: [right, left, top, bottom, front, back] regions:
  //  +x → left side region, -x → right side region? For a character facing +z
  //  (south), the arm on +x is their left. The skin's "right" region is drawn
  //  for the face looking west → maps to three's -x? We map: -x ← right region,
  //  +x ← left region, +z ← front, -z ← back.
  const faces: Array<[number, number, number, number]> = [
    /* +x  left  */ [u + 2 * d + w, v + d, d, h],
    /* -x  right */ [u, v + d, d, h],
    /* +y  top   */ [u + d, v, w, d],
    /* -y  bot   */ [u + d + w, v, w, d],
    /* +z  front */ [u + d, v + d, w, h],
    /* -z  back  */ [u + 2 * d + w, v + d, w, h],
  ]

  const uv = geo.attributes.uv as THREE.BufferAttribute

  // each face = 4 vertices in three's BoxGeometry uv order: (0,1)(1,1)(0,0)(1,0)? actually (u0,v0) top-left ...
  // three maps each face as a 2x2 plane; uv corners order per face: (0,1),(1,1),(0,0),(1,0)? Empirically it's
  // (0,1) (1,1) (0,0) (1,0) for position order of the face's quad — we set them explicitly:
  for (let f = 0; f < 6; f++) {
    const [fu, fv, fw, fh] = faces[f]
    const u0 = fu / TEX
    const v1 = 1 - fv / TEX
    const u1 = (fu + fw) / TEX
    const v0 = 1 - (fv + fh) / TEX
    // three's BoxGeometry uv order per face: (0,1) (1,1) (0,0) (1,0)
    uv.setXY(f * 4 + 0, u0, v1)
    uv.setXY(f * 4 + 1, u1, v1)
    uv.setXY(f * 4 + 2, u0, v0)
    uv.setXY(f * 4 + 3, u1, v0)
  }

  uv.needsUpdate = true
  const mesh = new THREE.Mesh(geo)

  return mesh
}

export interface Rig {
  root: THREE.Group
  parts: RigParts
  setPosture(p: Posture): void
  update(t: number, dt: number): void
  walkPhase: number
  posture: Posture
}

/** Build a rig from a skin texture. `slim` uses 3px arms (Alex layout). */
export function buildRig(skin: THREE.Texture, slim: boolean): Rig {
  skin.magFilter = THREE.NearestFilter
  skin.minFilter = THREE.NearestFilter
  skin.generateMipmaps = false
  skin.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.MeshLambertMaterial({ map: skin, transparent: false })
  const matOverlay = new THREE.MeshLambertMaterial({ map: skin, transparent: true, alphaTest: 0.5 })

  const armW = slim ? 3 : 4

  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  // pivots sit at the TOP of each limb (shoulder/hip/neck)
  const head = part(8, 8, 8, 0, 0, { u: 32, v: 0, infl: 0.5 })
  head.position.set(0, 24 * PX, 0)
  head.children.forEach(c => (c as THREE.Mesh).position.set(0, 4 * PX, 0))
  const headPivot = new THREE.Group()
  headPivot.position.set(0, 24 * PX, 0)
  head.position.set(0, 0, 0)

  for (const c of head.children) {(c as THREE.Mesh).position.set(0, 4 * PX, 0)}
  headPivot.add(head)
  body.add(headPivot)

  const torso = part(8, 12, 4, 16, 16, { u: 16, v: 32, infl: 0.25 })
  torso.position.set(0, 12 * PX, 0)

  for (const c of torso.children) {(c as THREE.Mesh).position.set(0, 6 * PX, 0)}
  body.add(torso)

  const armR = part(armW, 12, 4, 40, 16, { u: 40, v: 32, infl: 0.25 })
  armR.position.set(-(4 + armW / 2) * PX, 22 * PX, 0)

  for (const c of armR.children) {(c as THREE.Mesh).position.set(0, -5 * PX, 0)}
  body.add(armR)

  const armL = part(armW, 12, 4, 32, 48, { u: 48, v: 48, infl: 0.25 })
  armL.position.set((4 + armW / 2) * PX, 22 * PX, 0)

  for (const c of armL.children) {(c as THREE.Mesh).position.set(0, -5 * PX, 0)}
  body.add(armL)

  const legR = part(4, 12, 4, 0, 16, { u: 0, v: 32, infl: 0.25 })
  legR.position.set(-2 * PX, 12 * PX, 0)

  for (const c of legR.children) {(c as THREE.Mesh).position.set(0, -6 * PX, 0)}
  body.add(legR)

  const legL = part(4, 12, 4, 16, 48, { u: 0, v: 48, infl: 0.25 })
  legL.position.set(2 * PX, 12 * PX, 0)

  for (const c of legL.children) {(c as THREE.Mesh).position.set(0, -6 * PX, 0)}
  body.add(legL)

  root.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.material = o.parent === head && o !== head.children[0] ? matOverlay : mat
      o.castShadow = false
      o.receiveShadow = false
    }
  })
  // overlay meshes use the alphaTest material
  const overlays: THREE.Mesh[] = []

  for (const grp of [head, torso, armL, armR, legL, legR]) {
    if (grp.children[1]) {overlays.push(grp.children[1] as THREE.Mesh)}
  }

  overlays.forEach(m => (m.material = matOverlay))
  const bases: THREE.Mesh[] = []

  for (const grp of [head, torso, armL, armR, legL, legR]) {bases.push(grp.children[0] as THREE.Mesh)}
  bases.forEach(m => (m.material = mat))

  const rig: Rig = {
    root,
    parts: { root, body, head: headPivot, torso, armL, armR, legL, legR },
    walkPhase: 0,
    posture: 'idle',
    setPosture(p) {
      rig.posture = p
    },
    update(t, dt) {
      applyPosture(rig, t, dt)
    },
  }

  rig.root.scale.setScalar(0.9)

  return rig
}

const DEG = Math.PI / 180

function lerp(cur: number, target: number, k: number): number {
  return cur + (target - cur) * k
}

function applyPosture(rig: Rig, t: number, dt: number): void {
  const { armL, armR, legL, legR, head, body } = rig.parts
  const k = Math.min(1, dt * 10)
  const breathe = Math.sin(t * 2.2) * 0.02

  // defaults reset
  let targets = {
    armLx: 0,
    armLz: -4 * DEG,
    armRx: 0,
    armRz: 4 * DEG,
    legLx: 0,
    legRx: 0,
    headX: 0,
    headY: 0,
    headZ: 0,
    bodyY: 0,
    bodyRx: 0,
    legLy: 0,
    legRy: 0,
  }

  switch (rig.posture) {
    case 'walk': {
      rig.walkPhase += dt * 9
      const s = Math.sin(rig.walkPhase)
      const c = Math.sin(rig.walkPhase + Math.PI)
      targets.armLx = c * 0.9
      targets.armRx = s * 0.9
      targets.legLx = s * 1.0
      targets.legRx = c * 1.0
      targets.bodyY = Math.abs(Math.sin(rig.walkPhase)) * 0.06

      break
    }

    case 'sit':
      targets.legLx = targets.legRx = -80 * DEG
      targets.armLx = targets.armRx = -15 * DEG
      targets.bodyY = -0.32

      break

    case 'sit_type':
      targets.legLx = targets.legRx = -80 * DEG
      targets.armLx = targets.armRx = -55 * DEG + Math.sin(t * 14) * 0.08
      targets.bodyY = -0.32
      targets.headX = 6 * DEG

      break

    case 'type':
      targets.armLx = targets.armRx = -55 * DEG + Math.sin(t * 14) * 0.08
      targets.headX = 4 * DEG

      break

    case 'think':
      targets.armRx = -135 * DEG
      targets.armRz = -25 * DEG
      targets.headX = -8 * DEG
      targets.headZ = 8 * DEG

      break

    case 'read':
      targets.armLx = targets.armRx = -70 * DEG
      targets.headX = 18 * DEG

      break

    case 'talk':
      targets.headY = Math.sin(t * 1.4) * 0.18
      targets.armRx = Math.sin(t * 2.6) * 0.14

      break

    case 'relax':
      targets.armLz = -70 * DEG
      targets.armRz = 70 * DEG
      targets.headX = -10 * DEG
      targets.bodyRx = -8 * DEG
      targets.bodyY = -0.28

      break

    case 'wait':
      targets.armLz = -35 * DEG
      targets.armRz = 35 * DEG
      targets.headZ = Math.sin(t * 1.1) * 0.1
      targets.armLx = targets.armRx = -20 * DEG

      break

    case 'error':
      targets.headX = 22 * DEG
      targets.armLx = targets.armRx = 10 * DEG
      targets.bodyRx = 6 * DEG

      break

    case 'celebrate':
      targets.armLz = -160 * DEG
      targets.armRz = 160 * DEG
      targets.bodyY = Math.abs(Math.sin(t * 5)) * 0.14

      break

    default:
      targets.armLz = -4 * DEG + breathe
      targets.armRz = 4 * DEG - breathe
      targets.headY = Math.sin(t * 0.6) * 0.08
  }

  armL.rotation.x = lerp(armL.rotation.x, targets.armLx, k)
  armL.rotation.z = lerp(armL.rotation.z, targets.armLz, k)
  armR.rotation.x = lerp(armR.rotation.x, targets.armRx, k)
  armR.rotation.z = lerp(armR.rotation.z, targets.armRz, k)
  legL.rotation.x = lerp(legL.rotation.x, targets.legLx, k)
  legR.rotation.x = lerp(legR.rotation.x, targets.legRx, k)
  head.rotation.x = lerp(head.rotation.x, targets.headX, k)
  head.rotation.y = lerp(head.rotation.y, targets.headY, k)
  head.rotation.z = lerp(head.rotation.z, targets.headZ, k)
  body.rotation.x = lerp(body.rotation.x, targets.bodyRx, k)
  body.position.y = lerp(body.position.y, targets.bodyY, k)
}

/** Activity → posture mapping (desk activities sit; stations like terminals stand). */
export function postureFor(activity: string, station: string): Posture {
  switch (activity) {
    case 'thinking':
      return 'think'

    case 'reading':
      return station === 'library' ? 'read' : 'sit'

    case 'editing':
      return station === 'desk' ? 'sit_type' : 'type'

    case 'running':

    case 'testing':
      return station === 'desk' ? 'sit_type' : 'type'

    case 'waiting_user':
      return 'wait'

    case 'blocked':
      return 'sit'

    case 'error':
      return 'error'

    case 'done':
      return 'relax'

    case 'off_shift':
      return 'relax'

    default:
      return station === 'desk' || station === 'lounge' || station === 'meeting' ? 'sit' : 'idle'
  }
}
