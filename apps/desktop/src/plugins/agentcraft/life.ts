/**
 * Agent actors: skinned rigs that walk between stations on the walkable grid
 * and take an activity-appropriate posture. Speech bubbles, nameplates, "!"
 * markers and activity particles live in the DOM/three layers — this module
 * owns positions, paths and rig updates.
 */

import * as THREE from 'three'

import { FEET } from './hq-builder'
import type { SimAgent, SimStore, Station } from './model'
import type { Plan } from './plan'
import { buildRig, postureFor, type Rig } from './rig'

export interface Actor {
  id: string
  rig: Rig
  x: number
  z: number
  yaw: number
  station: Station
  path: [number, number][]
  pathI: number
  speed: number
  seated: boolean
}

/** Anchor slot claims so two agents don't share a chair. */
export class SlotAllocator {
  private used = new Map<string, string>()
  constructor(private plan: Plan) {}

  claim(agent: string, station: Station): { x: number; y: number; z: number; yaw: number } | null {
    if (station === 'desk') {
      const a = this.plan.anchors.get(`seat_${agent}`)

      return a ? { x: a.x, y: a.y, z: a.z, yaw: a.yaw } : null
    }

    const prefix = `slot_${station}_`

    // already holding one?
    for (const [slot, who] of this.used) {if (who === agent && slot.startsWith(prefix)) {
      const a = this.plan.anchors.get(slot)

      return a ? { x: a.x, y: a.y, z: a.z, yaw: a.yaw } : null
    }}

    for (let i = 0; i < 8; i++) {
      const name = `${prefix}${i}`
      const a = this.plan.anchors.get(name)

      if (!a) {continue}

      if (this.used.get(name)) {continue}
      this.used.set(name, agent)

      return { x: a.x, y: a.y, z: a.z, yaw: a.yaw }
    }

    return null
  }

  release(agent: string): void {
    for (const [slot, who] of [...this.used]) {
      if (who === agent && slot !== `seat_${agent}`) {this.used.delete(slot)}
    }
  }
}

/** Manhattan path on the walkable grid — A* lite over the plan at FEET level. */
export function findPath(walk: (x: number, z: number) => boolean, sx: number, sz: number, tx: number, tz: number): [number, number][] {
  const key = (x: number, z: number) => (x + 8192) * 8192 + (z + 8192)
  const open: Array<[number, number, number]> = [[sx, sz, 0]] // x, z, g
  const came = new Map<number, number>()
  const g = new Map<number, number>([[key(sx, sz), 0]])
  const visited = new Set<number>()
  let found = false
  let guard = 0

  while (open.length && guard++ < 4000) {
    open.sort((a, b) => b[2] + Math.abs(b[0] - tx) + Math.abs(b[1] - tz) - (a[2] + Math.abs(a[0] - tx) + Math.abs(a[1] - tz)))
    const [x, z, gCost] = open.pop()!
    const k = key(x, z)

    if (visited.has(k)) {continue}
    visited.add(k)

    if (x === tx && z === tz) {
      found = true

      break
    }

    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const nz = z + dz
      const nk = key(nx, nz)

      if (visited.has(nk)) {continue}

      if (!walk(nx, nz) && !(nx === tx && nz === tz)) {continue}

      if (!g.has(nk) || g.get(nk)! > gCost + 1) {
        g.set(nk, gCost + 1)
        came.set(nk, k)
        open.push([nx, nz, gCost + 1])
      }
    }
  }

  if (!found) {return []}
  const path: [number, number][] = []
  let cur = key(tx, tz)
  const startK = key(sx, sz)
  let guard2 = 0

  while (cur !== startK && guard2++ < 2000) {
    path.unshift([Math.floor(cur / 8192) - 8192, (cur % 8192) - 8192])
    const p = came.get(cur)

    if (p === undefined) {break}
    cur = p
  }

  return path
}

export class ActorManager {
  actors = new Map<string, Actor>()
  group = new THREE.Group()
  private slots: SlotAllocator
  private walk: (x: number, z: number) => boolean
  private lastStation = new Map<string, Station>()

  constructor(
    private st: SimStore,
    private plan: Plan,
    walk: (x: number, z: number) => boolean,
    private skinFor: (id: string) => THREE.Texture | null,
  ) {
    this.slots = new SlotAllocator(plan)
    this.walk = walk
    st.on(ev => {
      if (ev.type === 'agent') {this.onAgentChange(ev.id)}
    })
  }

  spawnAll(): void {
    for (const a of this.st.agents.values()) {this.spawn(a)}
  }

  private spawn(a: SimAgent): void {
    const skin = this.skinFor(a.id) ?? new THREE.Texture()
    const rig = buildRig(skin, a.model === 'slim')
    const seat = this.plan.anchors.get(`seat_${a.id}`)!

    const actor: Actor = {
      id: a.id,
      rig,
      x: seat.x,
      z: seat.z,
      yaw: seat.yaw,
      station: 'lounge',
      path: [],
      pathI: 0,
      speed: 2.4 + Math.random() * 0.5,
      seated: false,
    }

    rig.root.position.set(seat.x, FEET, seat.z)
    rig.root.rotation.y = (seat.yaw * Math.PI) / 180
    rig.setPosture('sit')
    this.group.add(rig.root)
    this.actors.set(a.id, actor)
    this.lastStation.set(a.id, a.station)
  }

  private onAgentChange(id: string): void {
    const a = this.st.agents.get(id)
    const actor = this.actors.get(id)

    if (!a || !actor) {return}

    if (a.station !== this.lastStation.get(id)) {
      this.lastStation.set(id, a.station)
      const slot = this.slots.claim(id, a.station)

      if (slot) {
        const path = findPath(this.walk, Math.round(actor.x - 0.5) + 0, Math.round(actor.z - 0.5) + 0, Math.floor(slot.x), Math.floor(slot.z))
        actor.path = path
        actor.pathI = 0
        actor.seated = false
      }

      // targetYaw stored on the actor for arrival orientation
      ;(actor as Actor & { targetYaw?: number }).targetYaw = slot?.yaw ?? 0
    }
  }

  update(t: number, dt: number): void {
    for (const actor of this.actors.values()) {
      const a = this.st.agents.get(actor.id)!

      if (actor.pathI < actor.path.length) {
        const [tx, tz] = actor.path[actor.pathI]
        const dx = tx + 0.5 - actor.x
        const dz = tz + 0.5 - actor.z
        const dist = Math.hypot(dx, dz)

        if (dist < 0.08) {
          actor.pathI++

          continue
        }

        const step = Math.min(dist, actor.speed * dt)
        actor.x += (dx / dist) * step
        actor.z += (dz / dist) * step
        const targetYaw = Math.atan2(dx, dz)
        let dy = targetYaw - actor.yaw

        while (dy > Math.PI) {dy -= Math.PI * 2}

        while (dy < -Math.PI) {dy += Math.PI * 2}
        actor.yaw += dy * Math.min(1, dt * 8)
        actor.rig.setPosture('walk')
      } else {
        const ty = ((actor as Actor & { targetYaw?: number }).targetYaw ?? actor.yaw) * (Math.PI / 180)
        let dy = ty - actor.yaw

        while (dy > Math.PI) {dy -= Math.PI * 2}

        while (dy < -Math.PI) {dy += Math.PI * 2}
        actor.yaw += dy * Math.min(1, dt * 5)
        actor.rig.setPosture(postureFor(a.activity, a.station))
      }

      actor.rig.root.position.set(actor.x, FEET + (actor.rig.posture === 'walk' ? Math.abs(Math.sin(actor.rig.walkPhase)) * 0.05 : 0), actor.z)
      actor.rig.root.rotation.y = actor.yaw
      actor.rig.update(t, dt)
    }
  }

  screenPositions(camera: THREE.Camera, w: number, h: number): Map<string, { x: number; y: number; speech: string | null; alert: boolean }> {
    const out = new Map<string, { x: number; y: number; speech: string | null; alert: boolean }>()
    const v = new THREE.Vector3()

    for (const [id, actor] of this.actors) {
      v.set(actor.x, FEET + 2.1, actor.z)
      v.project(camera)

      if (v.z > 1) {continue}
      const a = this.st.agents.get(id)!
      const speech = a.speech && a.speech.until > Date.now() ? a.speech.text : null
      out.set(id, {
        x: (v.x * 0.5 + 0.5) * w,
        y: (-v.y * 0.5 + 0.5) * h,
        speech,
        alert: a.activity === 'waiting_user' || a.activity === 'blocked' || a.activity === 'error',
      })
    }

    return out
  }

  dispose(): void {
    this.group.traverse(o => {
      if (o instanceof THREE.Mesh) {o.geometry.dispose()}
    })
  }
}
