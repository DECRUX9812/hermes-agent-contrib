/**
 * World assembly: plan → light → atlas → layered meshes + dynamic lamp/bulb
 * cells + screen quads. Also owns the sky/fog/sun rig with time-of-day presets
 * matching the mod's cinematics (golden hour default, night, day).
 */

import * as THREE from 'three'

import type { Lamp} from './blocks';
import { B, bsId, bulb, isSolid as isBlocking, lamp } from './blocks'
import { AX, AZ, buildStudioPlan, FEET } from './hq-builder'
import { computeLight } from './light'
import { meshCell, meshWorld } from './mesher'
import type { Plan } from './plan'
import { type Atlas, buildAtlas } from './textures'

export interface TimePreset {
  name: 'day' | 'golden' | 'night'
  skyTop: number
  skyBottom: number
  fog: number
  skyLight: number // 0..1 contribution of the sky channel
  lampColor: number
  sunDir: [number, number, number]
  sunColor: number
  ambient: number
  stars: boolean
}

export const TIME_PRESETS: Record<string, TimePreset> = {
  day: {
    name: 'day',
    skyTop: 0x8fc3e8,
    skyBottom: 0xd8ecfa,
    fog: 0xcfe5f2,
    skyLight: 1.0,
    lampColor: 0xffd9a0,
    sunDir: [0.5, 1.0, 0.3],
    sunColor: 0xfff4e0,
    ambient: 0.18,
    stars: false,
  },
  golden: {
    name: 'golden',
    skyTop: 0x88b8e0,
    skyBottom: 0xf6d9a8,
    fog: 0xf0d9b0,
    skyLight: 0.85,
    lampColor: 0xffcf8e,
    sunDir: [-0.6, 0.35, 0.55],
    sunColor: 0xffd9a0,
    ambient: 0.26,
    stars: false,
  },
  night: {
    name: 'night',
    skyTop: 0x0a1230,
    skyBottom: 0x1c2c4e,
    fog: 0x141c30,
    skyLight: 0.22,
    lampColor: 0xffc98a,
    sunDir: [0.3, 0.9, -0.4],
    sunColor: 0x9fb4e0,
    ambient: 0.1,
    stars: true,
  },
}

const VERT = /* glsl */ `
attribute vec3 aLight;
varying vec2 vUv;
varying vec3 vLight;
varying float vFogDepth;
void main() {
  vUv = uv;
  vLight = aLight;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`

const FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D uMap;
uniform float uSky;        // sky channel weight for the preset
uniform vec3 uSkyTint;
uniform vec3 uLampTint;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlpha;      // translucency (1 for opaque layers)
uniform float uCut;        // alpha test (0.5 for cutout, else 0)
uniform float uAmbient;    // ambient light floor for the preset
varying vec2 vUv;
varying vec3 vLight;       // r=sky g=block b=ao*faceShade
varying float vFogDepth;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < uCut) discard;
  float skyL = vLight.r * uSky;
  float blkL = vLight.g;
  vec3 illum = uSkyTint * skyL + uLampTint * blkL * 1.35 * (1.0 - min(skyL, 0.85) * 0.55);
  illum += vec3(uAmbient);
  illum = clamp(illum, vec3(0.055), vec3(1.05));
  vec3 col = tex.rgb * illum * vLight.b;
  float f = smoothstep(uFogNear, uFogFar, vFogDepth);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, tex.a * uAlpha);
}
`

const FRAG_EMISSIVE = /* glsl */ `
precision mediump float;
uniform sampler2D uMap;
uniform float uFogDummy;
uniform float uAlpha;
uniform float uCut;
varying vec2 vUv;
varying vec3 vLight;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < uCut) discard;
  gl_FragColor = vec4(tex.rgb, tex.a * uAlpha);
}
`

export interface WorldBuild {
  plan: Plan
  group: THREE.Group
  atlas: Atlas
  /** drifting cloud texture — advance offset each frame */
  cloudTex: THREE.Texture | null
  lampCells: Map<number, { x: number; y: number; z: number; binding: string }>
  lampGroup: THREE.Group
  lampMeshes: Map<number, THREE.Mesh[]>
  setLamp(binding: string, status: Lamp): void
  setBulbs(group: 'merge' | 'podium', lit: boolean): void
  applyTime(preset: TimePreset): void
  /** screen quads owned by displays */
  screens: {
    monitorAnchors: Map<string, { x: number; y: number; z: number }>
    taskWall: { x: number; y: number; z: number; w: number; h: number }
    hologram: { x: number; y: number; z: number }
  }
  dispose(): void
}

function buildGeometry(data: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const interleaved = new Float32Array(data)
  const ib = new THREE.InterleavedBuffer(interleaved, 8)
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0))
  g.setAttribute('uv', new THREE.InterleavedBufferAttribute(ib, 2, 3))
  g.setAttribute('aLight', new THREE.InterleavedBufferAttribute(ib, 3, 5))
  g.setIndex(idx)

  return g
}

export async function buildWorld(cast: string[]): Promise<WorldBuild> {
  const plan = buildStudioPlan(cast)
  const light = computeLight(plan)
  const atlas = await buildAtlas()
  const atlasTex = new THREE.CanvasTexture(atlas.canvas)
  atlasTex.flipY = false // uv rects are stored top-origin; CanvasTexture defaults to flipY
  atlasTex.magFilter = THREE.NearestFilter
  atlasTex.minFilter = THREE.NearestFilter
  atlasTex.generateMipmaps = false
  atlasTex.colorSpace = THREE.SRGBColorSpace

  const group = new THREE.Group()
  group.matrixAutoUpdate = false

  const uniforms = {
    uMap: { value: atlasTex },
    uSky: { value: 0.85 },
    uSkyTint: { value: new THREE.Color(0xfff2dd) },
    uLampTint: { value: new THREE.Color(0xffcf8e) },
    uFogColor: { value: new THREE.Color(0xf0d9b0) },
    uFogNear: { value: 60 },
    uFogFar: { value: 160 },
    uAlpha: { value: 1 },
    uCut: { value: 0 },
    uAmbient: { value: 0.16 },
  }

  const makeMat = (alpha: number, cut: number, emissive = false) => {
    const u = { ...uniforms, uMap: uniforms.uMap, uSky: uniforms.uSky, uSkyTint: uniforms.uSkyTint, uLampTint: uniforms.uLampTint, uFogColor: uniforms.uFogColor, uFogNear: uniforms.uFogNear, uFogFar: uniforms.uFogFar, uAmbient: uniforms.uAmbient }
    u.uAlpha = { value: alpha }
    u.uCut = { value: cut }

    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: VERT,
      fragmentShader: emissive ? FRAG_EMISSIVE : FRAG,
      transparent: alpha < 1,
      depthWrite: alpha >= 1,
      side: THREE.FrontSide,
    })

    return mat
  }

  const mesh = meshWorld(plan, light, atlas)
  const [idxO, idxC, idxT, idxE] = mesh.idx

  const layers: Array<{ data: number[]; idx: number[]; mat: THREE.ShaderMaterial }> = [
    { data: mesh.opaque, idx: idxO, mat: makeMat(1, 0) },
    { data: mesh.cutout, idx: idxC, mat: makeMat(1, 0.4) },
    { data: mesh.emissive, idx: idxE, mat: makeMat(1, 0.4, true) },
    { data: mesh.translucent, idx: idxT, mat: makeMat(0.8, 0.02) },
  ]

  for (const l of layers) {
    if (l.idx.length === 0) {continue}
    const m = new THREE.Mesh(buildGeometry(l.data, l.idx), l.mat)
    m.frustumCulled = false
    m.matrixAutoUpdate = false
    group.add(m)
  }

  // ---------------------------------------------- dynamic lamp/bulb cells
  const lampGroup = new THREE.Group()
  group.add(lampGroup)
  const lampMeshes = new Map<number, THREE.Mesh[]>()
  const lampMat = makeMat(1, 0.4)
  const lampEmissiveMat = makeMat(1, 0.4, true)

  const rebuildLamp = (key: number, x: number, y: number, z: number, state: number) => {
    const data = meshCell(plan, light, atlas, x, y, z, state)
    const old = lampMeshes.get(key)

    if (old) {
      for (const m of old) {
        lampGroup.remove(m)
        m.geometry.dispose()
      }
    }

    const meshes: THREE.Mesh[] = []

    if (data.idxO.length) {
      const m = new THREE.Mesh(buildGeometry(data.opaque, data.idxO), lampMat)
      m.frustumCulled = false
      lampGroup.add(m)
      meshes.push(m)
    }

    if (data.idxE.length) {
      const m = new THREE.Mesh(buildGeometry(data.emissive, data.idxE), lampEmissiveMat)
      m.frustumCulled = false
      lampGroup.add(m)
      meshes.push(m)
    }

    lampMeshes.set(key, meshes)
  }

  const bulbCells: { merge: number[]; podium: number[] } = { merge: [], podium: [] }

  // merge bulbs: (HX, FEET+3, -1) and (HX, FEET+3, +1); podium bulbs: (AX+8, FEET+5, AZ-1..+1)
  for (const [key, cell] of mesh.bulbs) {
    if (cell.x === 24 && (cell.z === -1 || cell.z === 1)) {bulbCells.merge.push(key)}
    else {bulbCells.podium.push(key)}

    rebuildLamp(key, cell.x, cell.y, cell.z, plan.cells[key])
  }

  for (const [key, cell] of mesh.lamps) {
    rebuildLamp(key, cell.x, cell.y, cell.z, plan.cells[key])
  }

  const setLamp = (binding: string, status: Lamp) => {
    for (const [key, cell] of mesh.lamps) {
      if (cell.binding === binding) {
        const id = bsId(plan.cells[key])
        rebuildLamp(key, cell.x, cell.y, cell.z, lamp(id, status))
      }
    }
  }

  const setBulbs = (which: 'merge' | 'podium', lit: boolean) => {
    for (const key of bulbCells[which]) {
      const cell = mesh.bulbs.get(key)!
      rebuildLamp(key, cell.x, cell.y, cell.z, bulb(lit))
    }
  }

  // ---------------------------------------------- sky rig
  const skyGeo = new THREE.SphereGeometry(600, 24, 12)

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x88b8e0) },
      uBottom: { value: new THREE.Color(0xf6d9a8) },
      uStars: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w; // push to far plane
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform float uStars;
      varying vec3 vDir;
      float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = clamp(vDir.y * 1.6 + 0.15, 0.0, 1.0);
        vec3 col = mix(uBottom, uTop, h);
        if (uStars > 0.5 && vDir.y > 0.05) {
          vec2 g = floor(vDir.xz / max(vDir.y, 0.05) * 60.0);
          float s = hash21(g);
          if (s > 0.985) col += vec3(0.9) * smoothstep(0.985, 1.0, s);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })

  const skyMesh = new THREE.Mesh(skyGeo, skyMat)
  skyMesh.frustumCulled = false
  group.add(skyMesh)

  // ---------------------------------------------- blocky drifting clouds
  const cloudCanvas = document.createElement('canvas')
  cloudCanvas.width = 128
  cloudCanvas.height = 128
  const cctx = cloudCanvas.getContext('2d')!

  for (let i = 0; i < 64; i++) {
    const w = 10 + Math.floor(Math.random() * 5) * 10
    const h = 6 + Math.floor(Math.random() * 4) * 6
    const x = Math.floor(Math.random() * 128)
    const y = Math.floor(Math.random() * 128)
    const a = 0.65 + Math.random() * 0.3
    cctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`

    // draw wrapped so the cloud field tiles seamlessly
    for (const ox of [-128, 0, 128]) {
      for (const oy of [-128, 0, 128]) {
        cctx.fillRect(x + ox, y + oy, w, h)
      }
    }
  }

  const cloudTex = new THREE.CanvasTexture(cloudCanvas)
  cloudTex.wrapS = THREE.RepeatWrapping
  cloudTex.wrapT = THREE.RepeatWrapping
  cloudTex.repeat.set(3, 3)
  cloudTex.magFilter = THREE.NearestFilter

  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  })

  const cloudMesh = new THREE.Mesh(new THREE.PlaneGeometry(560, 560), cloudMat)
  cloudMesh.rotation.x = -Math.PI / 2
  cloudMesh.position.set(0, 106, 15)
  cloudMesh.frustumCulled = false
  group.add(cloudMesh)

  const applyTime = (preset: TimePreset) => {
    uniforms.uSky.value = preset.skyLight
    uniforms.uAmbient.value = preset.ambient
    uniforms.uSkyTint.value.setHex(preset.name === 'night' ? 0x8fa2c8 : preset.name === 'golden' ? 0xfff0d0 : 0xffffff)
    uniforms.uLampTint.value.setHex(preset.lampColor)
    uniforms.uFogColor.value.setHex(preset.fog)
    uniforms.uFogNear.value = preset.name === 'night' ? 50 : 60
    uniforms.uFogFar.value = preset.name === 'night' ? 130 : 160
    skyMat.uniforms.uTop.value.setHex(preset.skyTop)
    skyMat.uniforms.uBottom.value.setHex(preset.skyBottom)
    skyMat.uniforms.uStars.value = preset.stars ? 1 : 0
    cloudMat.color.setHex(preset.name === 'night' ? 0x2c3c5e : preset.name === 'golden' ? 0xffe8c8 : 0xffffff)
  }

  applyTime(TIME_PRESETS.golden)

  // ---------------------------------------------- screen anchors for displays
  const monitorAnchors = new Map<string, { x: number; y: number; z: number }>()

  for (const [name, a] of plan.anchors) {
    if (name.startsWith('monitor_')) {
      monitorAnchors.set(name.slice(8), { x: a.x, y: a.y, z: a.z })
    }
  }

  const tw = plan.anchors.get('task_wall')!

  const screens = {
    monitorAnchors,
    taskWall: { x: tw.x, y: FEET + 3.0, z: AZ + 0.5, w: 7, h: 4 },
    hologram: { x: AX + 0.5, y: FEET + 3.6, z: AZ + 0.5 },
  }

  return {
    plan,
    group,
    atlas,
    cloudTex,
    lampCells: mesh.lamps,
    lampGroup,
    lampMeshes,
    setLamp,
    setBulbs,
    applyTime,
    screens,
    dispose() {
      group.traverse(o => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const m = o.material

          if (Array.isArray(m)) {m.forEach(mm => mm.dispose())}
          else {m?.dispose()}
        }
      })
      cloudTex?.dispose()
      atlasTex.dispose()
    },
  }
}

/** Walkable-cell grid for agent pathing (FEET level, interior + outdoors). */
export function walkableGrid(plan: Plan): (x: number, z: number) => boolean {
  return (x, z) => {
    if (!plan.inXZ(x, z)) {return false}
    const feet = plan.get(x, FEET, z)
    const head = plan.get(x, FEET + 1, z)
    const below = plan.get(x, FEET - 1, z)
    const feetOk = bsId(feet) === B.AIR || !isBlocking(feet)
    const headOk = bsId(head) === B.AIR || !isBlocking(head)

    return feetOk && headOk && isBlocking(below)
  }
}
