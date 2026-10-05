/**
 * Director store — the pane's shared state (architecture §8.5, §12).
 *
 * Only what this milestone needs: the anchor, the per-avatar runtime rows, the
 * activity feed, open cards, and the transition log the dev snapshot exposes.
 * Per-frame values (renderCount, frameloop, regions) live in `pane3dRuntime`,
 * a plain mutable object the canvas writes each frame — never React state, so
 * nothing re-renders per frame.
 */

import { atom } from 'nanostores'

import type { AvatarId, DemoScript, NotifyRequest, PaneAnchor, PaneState, ScreenRect } from '../protocol'
import { AVATAR_IDS } from '../protocol'

export type AvatarState =
  'hidden' | 'emerging' | 'idle' | 'listening' | 'thinking' | 'responding' | 'celebrating' | 'notifying' | 'hiding'

export interface AvatarRuntime {
  id: AvatarId
  state: AvatarState
  visible: boolean
  /** Perch slot index; layout is owned by the room (later milestone). */
  slot: number
  meshCount: number
  materialTypes: string[]
  pendingNotify: number
}

export type FeedKind = 'notify' | 'chat' | 'task'

export interface FeedEntry {
  id: string
  kind: FeedKind
  avatar: AvatarId
  text: string
  at: number
}

export interface PaneCard {
  id: string
  avatar: AvatarId
  request: NotifyRequest
  shownAt: number
}

export interface TransitionRecord {
  avatar: AvatarId
  from: AvatarState
  to: AvatarState
  event: string
  at: number
}

export type FrameloopMode = 'always' | 'demand' | 'never'

export interface Pane3dRuntime {
  anchor: PaneAnchor
  frameloop: FrameloopMode
  renderCount: number
  regions: ScreenRect[]
  pixelRatio: number
  platform: NodeJS.Platform
  reducedMotion: boolean
  lastDemo: DemoScript | null
}

export const DEFAULT_ANCHOR: PaneAnchor = {
  kind: 'desktop',
  label: '',
  rect: { height: 0, width: 0, x: 0, y: 0 }
}

function emptyAvatars(): Record<AvatarId, AvatarRuntime> {
  const out = {} as Record<AvatarId, AvatarRuntime>

  AVATAR_IDS.forEach((id, slot) => {
    out[id] = { id, materialTypes: [], meshCount: 0, pendingNotify: 0, slot, state: 'hidden', visible: false }
  })

  return out
}

export const pane3dRuntime: Pane3dRuntime = {
  anchor: DEFAULT_ANCHOR,
  frameloop: 'demand',
  lastDemo: null,
  pixelRatio: 1,
  platform: 'linux',
  reducedMotion: false,
  regions: [],
  renderCount: 0
}

export const $avatars = atom<Record<AvatarId, AvatarRuntime>>(emptyAvatars())
export const $feed = atom<FeedEntry[]>([])
export const $cards = atom<Record<string, PaneCard>>({})
export const $anchor = atom<PaneAnchor>(DEFAULT_ANCHOR)
export const $transitions = atom<TransitionRecord[]>([])

export const TRANSITION_LIMIT = 200

export function recordTransition(record: Omit<TransitionRecord, 'at'> & { at?: number }): void {
  const next = [{ ...record, at: record.at ?? Date.now() }, ...$transitions.get()]

  $transitions.set(next.slice(0, TRANSITION_LIMIT))
}

export function setAnchor(anchor: PaneAnchor): void {
  pane3dRuntime.anchor = anchor
  $anchor.set(anchor)
}

/** Apply one message from the main process (architecture §4). */
export function applyPaneState(state: PaneState): void {
  switch (state.type) {
    case 'init':
      pane3dRuntime.platform = state.platform
      pane3dRuntime.reducedMotion = state.reducedMotion
      setAnchor(state.anchor)

      return

    case 'anchor':
      setAnchor(state.anchor)

      return
    case 'notify': {
      $cards.set({
        ...$cards.get(),
        [state.id]: { avatar: state.request.avatar, id: state.id, request: state.request, shownAt: Date.now() }
      })

      return
    }

    case 'demo':
      pane3dRuntime.lastDemo = state.script

      return

    case 'summon':

    case 'dismiss':
      // Avatar visibility belongs to the avatar core (next milestone); the
      // state row already exists so nothing else has to know yet.
      return
  }
}

export interface Pane3dAvatarSnapshot {
  id: AvatarId
  state: AvatarState
  visible: boolean
  slot: number
  screenRect: ScreenRect | null
  yawDeg: number
  gaze: { x: number; y: number }
  meshCount: number
  materialTypes: string[]
}

export interface Pane3dDebugSnapshot {
  anchor: PaneAnchor
  avatars: Pane3dAvatarSnapshot[]
  regions: ScreenRect[]
  frameloop: FrameloopMode
  renderCount: number
  pixelRatio: number
  transitions: TransitionRecord[]
  feed: FeedEntry[]
  cards: PaneCard[]
  tasks: unknown[]
  chart: null
  lastDemo: DemoScript | null
}

/**
 * Read-only view for validators (`window.__pane3dDebug.snapshot()`).
 * Nothing here mutates pane state.
 */
export function snapshotPane3d(): Pane3dDebugSnapshot {
  const avatars = $avatars.get()

  return {
    anchor: pane3dRuntime.anchor,
    avatars: AVATAR_IDS.map(id => {
      const row = avatars[id]

      return {
        gaze: { x: 0, y: 0 },
        id,
        materialTypes: [...row.materialTypes],
        meshCount: row.meshCount,
        screenRect: null,
        slot: row.slot,
        state: row.state,
        visible: row.visible,
        yawDeg: 0
      }
    }),
    cards: Object.values($cards.get()),
    chart: null,
    feed: $feed.get(),
    frameloop: pane3dRuntime.frameloop,
    lastDemo: pane3dRuntime.lastDemo,
    pixelRatio: pane3dRuntime.pixelRatio,
    regions: [...pane3dRuntime.regions],
    renderCount: pane3dRuntime.renderCount,
    tasks: [],
    transitions: $transitions.get()
  }
}
