/**
 * The studio scene: three.js renderer + the voxel world + agents + displays +
 * camera rig. Owns the render loop, DOM overlays (nameplates/bubbles/markers),
 * and sim→visual wiring. One instance per mounted StudioPage.
 */

import * as THREE from 'three'

import castJson from './assets/cast.json'
import skinJuniper from './assets/entity/juniper.png'
import skinKit from './assets/entity/kit.png'
import skinMarlow from './assets/entity/marlow.png'
import skinRowan from './assets/entity/rowan.png'
import skinTove from './assets/entity/tove.png'
import skinWren from './assets/entity/wren.png'
import { Lamp } from './blocks'
import { type SimHandle, startSim } from './driver'
import { AX, AZ, FEET } from './hq-builder'
import { ActorManager } from './life'
import type { CastMember, SimStore } from './model'
import { ScreenManager } from './screens'
import { buildWorld, TIME_PRESETS, walkableGrid } from './world'

const SKIN_URLS: Record<string, string> = {
  marlow: skinMarlow,
  juniper: skinJuniper,
  kit: skinKit,
  wren: skinWren,
  rowan: skinRowan,
  tove: skinTove,
}

export interface CameraPreset {
  name: string
  pos: [number, number, number]
  look: [number, number, number]
}

/** Fallback list for the controls before the world loads. */
export const CAMERA_PRESETS: CameraPreset[] = [
  { name: 'exterior_hero', pos: [-50, 88, 34], look: [-4, 76, -2] },
  { name: 'entrance_atrium', pos: [-1.5, FEET + 2.2, AZ + 6.8], look: [2, FEET + 3.8, AZ - 2] },
  { name: 'wide_interior', pos: [-5, FEET + 1.7, -4.6], look: [-18, FEET + 1.0, -2.8] },
  { name: 'task_wall', pos: [AX - 0.8, FEET + 3.2, AZ + 0.5], look: [AX - 7.9, FEET + 2.4, AZ + 0.5] },
  { name: 'decision_podium', pos: [AX + 3.0, FEET + 1.5, AZ + 2.3], look: [AX + 6.8, FEET + 1.9, AZ - 0.8] },
  { name: 'library', pos: [-14, FEET + 2.8, 4.0], look: [-21.5, FEET + 1.2, -1.5] },
  { name: 'console', pos: [AX + 2.5, FEET + 2.2, AZ + 6.5], look: [AX + 7.5, FEET + 1.0, AZ + 2.5] },
  { name: 'merge_station', pos: [19.5, FEET + 1.6, 2.6], look: [24, FEET + 1.8, -0.2] },
  { name: 'testbench', pos: [16, FEET + 2.6, -0.5], look: [23, FEET + 1.0, -4.5] },
  { name: 'hall', pos: [-5, FEET + 1.7, -4.6], look: [18, FEET + 1.5, -2.0] },
  { name: 'night', pos: [16.5, 71.5, 45.5], look: [-2, 75.5, 11] },
]

export interface StudioScene {
  dispose(): void
  canvas: HTMLCanvasElement
  overlay: HTMLDivElement
  store: SimStore
  sim: SimHandle
  setSpeed(m: number): void
  setAutoAnswer(on: boolean): void
  setTime(name: 'day' | 'golden' | 'night'): void
  flyTo(preset: string): void
  flyToPos(pos: [number, number, number], look: [number, number, number]): void
  followAgent(id: string | null): void
  openDecisionFocus(): void
  /** pause the render loop when hidden */
  setRunning(running: boolean): void
}

interface Plate {
  el: HTMLDivElement
  name: HTMLDivElement
  bubble: HTMLDivElement | null
  mark: HTMLDivElement
}

function loadSkin(url: string): THREE.Texture {
  const tex = new THREE.Texture()
  const img = new Image()

  img.onload = () => {
    tex.image = img
    tex.needsUpdate = true
  }

  img.src = url

  return tex
}

export async function createStudio(opts: {
  container: HTMLDivElement
  speed?: number
  autoAnswer?: number
  reducedMotion: boolean
  onEvent?: (kind: string, data?: unknown) => void
}): Promise<StudioScene> {
  const { container } = opts
  const W = () => container.clientWidth
  const H = () => container.clientHeight

  const canvas = document.createElement('canvas')
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  canvas.style.imageRendering = 'pixelated'
  container.appendChild(canvas)

  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden'
  container.appendChild(overlay)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio))
  renderer.setSize(W(), H())

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, W() / H(), 0.1, 900)

  // ------------------------------------------------------------------ world
  const cast: CastMember[] = (castJson as { agents: CastMember[] }).agents
  const world = await buildWorld(cast.map(c => c.id))
  scene.add(world.group)

  // sun light for agent rigs (Lambert needs a real light; the voxel world bakes its own)
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.1)
  sun.position.set(-30, 60, 30)
  const amb = new THREE.AmbientLight(0x8899bb, 0.9)
  scene.add(sun, amb)

  // ------------------------------------------------------------------ sim
  const sim = startSim(cast, { speed: opts.speed ?? 1.6, autoAnswer: opts.autoAnswer ?? 0 })

  // ------------------------------------------------------------------ agents
  const walk = walkableGrid(world.plan)
  const actors = new ActorManager(sim.store, world.plan, walk, id => (SKIN_URLS[id] ? loadSkin(SKIN_URLS[id]) : null))
  actors.spawnAll()
  scene.add(actors.group)

  // ------------------------------------------------------------------ displays
  const screens = new ScreenManager(sim.store)
  // monitor quads: 3×2 screens face +z at the monitor anchor (block at z=-9 faces south)
  const monitorGeo = new THREE.PlaneGeometry(3, 2)

  for (const [id, a] of world.screens.monitorAnchors) {
    const tex = screens.monitorTexture(id)
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    const q = new THREE.Mesh(monitorGeo, mat)
    // monitors face +z (south) toward the chair
    q.position.set(a.x, a.y, a.z + 0.755)
    world.group.add(q)
  }

  // task wall: 7×4 board facing +x (east) at x=-8 wall
  {
    const t = world.screens.taskWall
    const tex = screens.taskWallTexture()
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    const q = new THREE.Mesh(new THREE.PlaneGeometry(t.w, t.h), mat)
    // board cells sit at x=-8; the east (front) face is at x=-7
    q.position.set(-6.99, t.y, t.z)
    q.rotation.y = Math.PI / 2
    world.group.add(q)
  }

  // hologram above the atrium lamp: additive floating sprite
  let holoMesh: THREE.Mesh | null = null

  {
    const t = world.screens.hologram
    const tex = screens.holoTexture()
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, toneMapped: false, side: THREE.DoubleSide })
    holoMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), mat)
    holoMesh.position.set(t.x, t.y, t.z)
    world.group.add(holoMesh)
  }

  // ------------------------------------------------------------------ confetti pool
  const confetti = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3)),
    new THREE.PointsMaterial({ size: 0.14, vertexColors: true, sizeAttenuation: true }),
  )

  {
    const colors = new Float32Array(600 * 3)
    const cols = [new THREE.Color(0xec9776), new THREE.Color(0xf8d892), new THREE.Color(0x98b2e2), new THREE.Color(0x8e66bf), new THREE.Color(0xf3d9c8)]

    for (let i = 0; i < 600; i++) {cols[i % cols.length].toArray(colors, i * 3)}
    confetti.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    confetti.visible = false
    confetti.frustumCulled = false
    world.group.add(confetti)
  }

  let confettiT = -1
  const confettiVel = new Float32Array(600 * 3)

  // ------------------------------------------------------------------ DOM plates
  const plates = new Map<string, Plate>()

  for (const a of sim.store.agents.values()) {
    const el = document.createElement('div')
    el.className = 'ac-plate'
    const name = document.createElement('div')
    name.className = 'ac-plate-name'
    name.textContent = a.name
    name.style.color = a.color
    const mark = document.createElement('div')
    mark.className = 'ac-plate-mark'
    mark.style.display = 'none'
    el.appendChild(mark)
    el.appendChild(name)
    overlay.appendChild(el)
    plates.set(a.id, { el, name, bubble: null, mark })
  }

  // ------------------------------------------------------------------ camera rig
  let camPos = new THREE.Vector3(...CAMERA_PRESETS[0].pos)
  let camLook = new THREE.Vector3(...CAMERA_PRESETS[0].look)
  let camTargetPos = camPos.clone()
  let camTargetLook = camLook.clone()
  let followId: string | null = null
  let orbitDragging = false
  let lastX = 0
  let lastY = 0
  let autoCycle = !opts.reducedMotion
  let autoTimer = 0
  let presetI = 0

  const flyTo = (name: string) => {
    const p = CAMERA_PRESETS.find(p => p.name === name)

    if (!p) {return}
    autoCycle = false
    followId = null
    camTargetPos.set(...p.pos)
    camTargetLook.set(...p.look)
  }

  const flyToPos = (pos: [number, number, number], look: [number, number, number]) => {
    autoCycle = false
    followId = null
    camTargetPos.set(...pos)
    camTargetLook.set(...look)
  }

  const followAgent = (id: string | null) => {
    followId = id
    autoCycle = false
  }

  canvas.addEventListener('pointerdown', e => {
    orbitDragging = true
    lastX = e.clientX
    lastY = e.clientY
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', e => {
    if (!orbitDragging) {return}
    const dx = (e.clientX - lastX) / 200
    const dy = (e.clientY - lastY) / 200
    lastX = e.clientX
    lastY = e.clientY
    // orbit camTargetPos around camTargetLook
    const v = camTargetPos.clone().sub(camTargetLook)
    const yaw = Math.atan2(v.x, v.z) - dx
    const r = Math.hypot(v.x, v.z)
    const pitch = Math.max(0.08, Math.min(1.4, Math.atan2(v.y, r) + dy))
    camTargetPos.set(camTargetLook.x + r * Math.sin(yaw) * Math.cos(pitch), camTargetLook.y + r * Math.sin(pitch), camTargetLook.z + r * Math.cos(yaw) * Math.cos(pitch))
    autoCycle = false
  })
  canvas.addEventListener('pointerup', () => (orbitDragging = false))
  canvas.addEventListener('wheel', e => {
    const v = camTargetPos.clone().sub(camTargetLook)
    const s = e.deltaY > 0 ? 1.12 : 0.89
    const len = Math.max(4, Math.min(90, v.length() * s))
    camTargetPos.copy(camTargetLook).add(v.normalize().multiplyScalar(len))
    autoCycle = false
  })

  // ------------------------------------------------------------------ sim wiring
  const off = sim.store.on(ev => {
    if (ev.type === 'lamp') {world.setLamp(ev.binding, ev.status)}
    else if (ev.type === 'bulbs') {world.setBulbs(ev.group, ev.lit)}
    else if (ev.type === 'confetti') {burstConfetti(ev.x, ev.y, ev.z)}
    else if (ev.type === 'decision' && ev.status === 'open') {opts.onEvent?.('decision', ev.key)}
    else if (ev.type === 'bell') {opts.onEvent?.('bell')}
    else if (ev.type === 'goal' && sim.store.goal?.status === 'done') {
      world.setLamp('goal:atrium', Lamp.DONE)
      world.applyTime(TIME_PRESETS.night === currentPreset ? TIME_PRESETS.golden : currentPreset)
    }
  })

  function burstConfetti(x: number, y: number, z: number): void {
    const pos = confetti.geometry.attributes.position as THREE.BufferAttribute

    for (let i = 0; i < 600; i++) {
      pos.setXYZ(i, x + (Math.random() - 0.5) * 1.2, y + Math.random() * 1.5, z + (Math.random() - 0.5) * 1.2)
      confettiVel[i * 3] = (Math.random() - 0.5) * 2.4
      confettiVel[i * 3 + 1] = Math.random() * 3 + 1.5
      confettiVel[i * 3 + 2] = (Math.random() - 0.5) * 2.4
    }

    pos.needsUpdate = true
    confetti.visible = true
    confettiT = 0
  }

  // ------------------------------------------------------------------ loop
  let running = true
  let raf = 0
  let last = performance.now()
  let currentPreset = TIME_PRESETS.golden
  const clock = new THREE.Clock()

  function frame(): void {
    if (!running) {return}
    raf = requestAnimationFrame(frame)
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const t = clock.getElapsedTime()

    // camera
    if (followId) {
      const actor = actors.actors.get(followId)

      if (actor) {
        camTargetLook.set(actor.x, FEET + 1.6, actor.z)
        const back = new THREE.Vector3(Math.sin(actor.yaw), 0, Math.cos(actor.yaw)).multiplyScalar(-4.5)
        camTargetPos.copy(camTargetLook).add(back).add(new THREE.Vector3(0, 2.2, 0))
      }
    } else if (autoCycle) {
      autoTimer += dt

      if (autoTimer > 14) {
        autoTimer = 0
        presetI = (presetI + 1) % CAMERA_PRESETS.length
        const p = CAMERA_PRESETS[presetI]
        camTargetPos.set(...p.pos)
        camTargetLook.set(...p.look)
      }
    }

    const k = 1 - Math.exp(-dt * 2.6)
    camPos.lerp(camTargetPos, k)
    camLook.lerp(camTargetLook, k)
    camera.position.copy(camPos)
    camera.lookAt(camLook)

    actors.update(t, dt)
    screens.flush()

    if (world.cloudTex) {
      world.cloudTex.offset.x = (t * 0.004) % 1
      world.cloudTex.offset.y = (t * 0.0013) % 1
    }

    // hologram bob + face camera
    if (holoMesh) {
      holoMesh.position.y = world.screens.hologram.y + Math.sin(t * 1.3) * 0.15
      holoMesh.rotation.y = Math.atan2(camera.position.x - holoMesh.position.x, camera.position.z - holoMesh.position.z)
    }

    // confetti
    if (confetti.visible) {
      confettiT += dt
      const pos = confetti.geometry.attributes.position as THREE.BufferAttribute

      for (let i = 0; i < 600; i++) {
        confettiVel[i * 3 + 1] -= dt * 4
        pos.setXYZ(i, pos.getX(i) + confettiVel[i * 3] * dt, pos.getY(i) + confettiVel[i * 3 + 1] * dt, pos.getZ(i) + confettiVel[i * 3 + 2] * dt)
      }

      pos.needsUpdate = true

      if (confettiT > 4) {confetti.visible = false}
    }

    renderer.render(scene, camera)

    // plates
    const positions = actors.screenPositions(camera, W(), H())

    for (const [id, p] of positions) {
      const plate = plates.get(id)

      if (!plate) {continue}
      plate.el.style.transform = `translate(${p.x - 40}px, ${p.y}px)`
      plate.el.style.display = 'block'
      plate.mark.style.display = p.alert ? 'block' : 'none'
      const a = sim.store.agents.get(id)!
      const speech = a.speech && a.speech.until > Date.now() ? a.speech.text : null

      if (speech && !plate.bubble) {
        const b = document.createElement('div')
        b.className = 'ac-bubble'
        b.textContent = speech
        plate.el.appendChild(b)
        plate.bubble = b
      } else if (!speech && plate.bubble) {
        plate.bubble.remove()
        plate.bubble = null
      }
    }

    for (const [id, plate] of plates) {
      if (!positions.has(id)) {plate.el.style.display = 'none'}
    }
  }

  raf = requestAnimationFrame(frame)

  const onResize = () => {
    renderer.setSize(W(), H())
    camera.aspect = W() / H()
    camera.updateProjectionMatrix()
  }

  const ro = new ResizeObserver(onResize)
  ro.observe(container)

  return {
    canvas,
    overlay,
    store: sim.store,
    sim,
    setSpeed(m) {
      sim.setSpeed(m)
    },
    setAutoAnswer(on) {
      sim.setAutoAnswer(on ? 2500 : 0)
    },
    setTime(name) {
      currentPreset = TIME_PRESETS[name]
      world.applyTime(currentPreset)
    },
    flyTo,
    flyToPos,
    followAgent,
    openDecisionFocus() {
      flyTo('decision_podium')
    },
    setRunning(r) {
      running = r

      if (r) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    },
    dispose() {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      off()
      sim.stop()
      actors.dispose()
      screens.dispose()
      world.dispose()
      renderer.dispose()
      canvas.remove()
      overlay.remove()
    },
  }
}
