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
import { prewarmPlan, type PrewarmStage } from '../scene/prewarm'
import { avatarFrames } from '../scene/projection'
import { prefersReducedMotion, setReducedMotion } from '../scene/reduced-motion'

import { runDemoScript } from './demo'
import { deliverNotification, dismiss, summon } from './director'
import { appendFeed } from './feed'

export type AvatarState =
  'hidden' | 'emerging' | 'idle' | 'listening' | 'thinking' | 'responding' | 'celebrating' | 'notifying' | 'hiding'

export interface AvatarRuntime {
  id: AvatarId
  state: AvatarState
  visible: boolean
  pendingNotify: number
  /**
   * `performance.now()` of the transition into `state`. The rig starts its
   * choreography clock here rather than at its first rendered frame, so a slow
   * frame cannot stretch an animation past its stated duration (§8.4).
   */
  changedAt: number
}

export type FeedKind = 'notify' | 'chat' | 'task'

export interface FeedEntry {
  id: string
  kind: FeedKind
  avatar: AvatarId
  text: string
  at: number
  /** Where the entry came from; harness-sourced entries are badged (§11). */
  source?: 'live' | 'dev-harness'
}

export interface PaneCard {
  id: string
  avatar: AvatarId
  request: NotifyRequest
  shownAt: number
}

/** One spoken line over an avatar (architecture §8.6). At most one at a time. */
export interface SpeechBubble {
  id: string
  /** Who is speaking — the bubble sits over this avatar. */
  avatar: AvatarId
  listener: AvatarId
  text: string
  at: number
  source?: 'live' | 'dev-harness'
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
  /** `performance.now()` when the anchor last changed — the re-perch clock (§7). */
  anchorChangedAt: number
  frameloop: FrameloopMode
  renderCount: number
  regions: ScreenRect[]
  pixelRatio: number
  platform: NodeJS.Platform
  lastDemo: DemoScript | null
}

export const DEFAULT_ANCHOR: PaneAnchor = {
  kind: 'desktop',
  label: '',
  rect: { height: 0, width: 0, x: 0, y: 0 }
}

function emptyAvatars(): Record<AvatarId, AvatarRuntime> {
  const out = {} as Record<AvatarId, AvatarRuntime>

  AVATAR_IDS.forEach(id => {
    out[id] = { changedAt: 0, id, pendingNotify: 0, state: 'hidden', visible: false }
  })

  return out
}

export const pane3dRuntime: Pane3dRuntime = {
  anchor: DEFAULT_ANCHOR,
  anchorChangedAt: 0,
  frameloop: 'demand',
  lastDemo: null,
  pixelRatio: 1,
  platform: 'linux',
  regions: [],
  renderCount: 0
}

export const $avatars = atom<Record<AvatarId, AvatarRuntime>>(emptyAvatars())
export const $feed = atom<FeedEntry[]>([])
export const $cards = atom<Record<string, PaneCard>>({})
/** The AvatarRoom's current speech bubble(s) (§8.6); a live exchange shows one. */
export const $bubbles = atom<SpeechBubble[]>([])
export const $anchor = atom<PaneAnchor>(DEFAULT_ANCHOR)
export const $transitions = atom<TransitionRecord[]>([])
/** The activity feed panel, toggled from the dock (§8.6). */
export const $feedPanelOpen = atom(false)
/** The host platform from `init`; decides who owns click-through (§6). */
export const $platform = atom<NodeJS.Platform>('linux')

/** Newest first, capped at `FEED_CAP` (§8.5). */
export function pushFeed(entry: FeedEntry): void {
  $feed.set(appendFeed($feed.get(), entry))
}

export const TRANSITION_LIMIT = 200

export function recordTransition(record: Omit<TransitionRecord, 'at'> & { at?: number }): void {
  const next = [{ ...record, at: record.at ?? Date.now() }, ...$transitions.get()]

  $transitions.set(next.slice(0, TRANSITION_LIMIT))
}

export function setAnchor(anchor: PaneAnchor): void {
  pane3dRuntime.anchor = anchor
  // Stamp at the IPC, not at the first frame that notices the move: on the slow
  // software-GL pane the re-perch tween must be measured from the real anchor
  // change or a late frame stretches it (VAL-ANCHOR-002).
  pane3dRuntime.anchorChangedAt = performance.now()
  $anchor.set(anchor)
}

/** Apply one message from the main process (architecture §4). */
export function applyPaneState(state: PaneState): void {
  switch (state.type) {
    case 'init':
      pane3dRuntime.platform = state.platform
      $platform.set(state.platform)
      setReducedMotion(state.reducedMotion)
      setAnchor(state.anchor)

      return

    case 'anchor':
      setAnchor(state.anchor)

      return

    case 'notify':
      deliverNotification(state.id, state.request)

      return

    case 'demo':
      pane3dRuntime.lastDemo = state.script
      runDemoScript(state.script)

      return

    case 'summon':
      summon(state.avatar)

      return

    case 'dismiss':
      dismiss(state.avatar)

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
  /** Greeting bow pitch in degrees; 0 at rest (VAL-ROOM-001 evidence). */
  bowDeg: number
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
  /** The AvatarRoom's live speech bubbles (§8.6). */
  bubbles: SpeechBubble[]
  tasks: unknown[]
  chart: null
  lastDemo: DemoScript | null
  /** Shader pre-warm lifecycle — 'warm' means the programs are linked and `ready` is imminent. */
  prewarm: PrewarmStage
  /** Every avatar id the pre-warm covered, registry-driven. */
  prewarmed: AvatarId[]
  reducedMotion: boolean
}

/**
 * Read-only view for validators (`window.__pane3dDebug.snapshot()`).
 * Nothing here mutates pane state.
 */
export function snapshotPane3d(): Pane3dDebugSnapshot {
  const avatars = $avatars.get()
  const visibleOrder = AVATAR_IDS.filter(id => avatars[id].visible)
  const prewarm = prewarmPlan()

  return {
    anchor: pane3dRuntime.anchor,
    avatars: AVATAR_IDS.map(id => {
      const row = avatars[id]
      const frame = avatarFrames[id]

      return {
        bowDeg: frame.bowDeg,
        gaze: { ...frame.gaze },
        id,
        materialTypes: [...frame.materialTypes],
        meshCount: frame.meshCount,
        screenRect: frame.screenRect ? { ...frame.screenRect } : null,
        slot: visibleOrder.indexOf(id),
        state: row.state,
        visible: row.visible,
        yawDeg: frame.yawDeg
      }
    }),
    bubbles: $bubbles.get().map(bubble => ({ ...bubble })),
    cards: Object.values($cards.get()),
    chart: null,
    feed: $feed.get(),
    frameloop: pane3dRuntime.frameloop,
    lastDemo: pane3dRuntime.lastDemo,
    pixelRatio: pane3dRuntime.pixelRatio,
    prewarm: prewarm.stage,
    prewarmed: [...prewarm.ids],
    reducedMotion: prefersReducedMotion(),
    regions: [...pane3dRuntime.regions],
    renderCount: pane3dRuntime.renderCount,
    tasks: [],
    transitions: $transitions.get()
  }
}
