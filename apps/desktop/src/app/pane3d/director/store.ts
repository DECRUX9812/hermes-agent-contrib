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

import type {
  AvatarId,
  ChartSpec,
  DemoScript,
  NotifyRequest,
  PageContext,
  PaneAnchor,
  PaneState,
  ScreenRect
} from '../protocol'
import { AVATAR_IDS } from '../protocol'
import { prewarmPlan, type PrewarmStage } from '../scene/prewarm'
import { avatarFrames } from '../scene/projection'
import { prefersReducedMotion, setReducedMotion } from '../scene/reduced-motion'

import { chartRuntime } from './chart-state'
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

/** A task's lifecycle status (architecture §8.7, §12). */
export type TaskStatus = 'running' | 'done' | 'error' | 'cancelled'

/**
 * One submitted task, kept for the debug snapshot: what was asked, the context
 * it was given and how it ended (architecture §8.7, §12).
 */
export interface TaskRecord {
  id: string
  avatar: AvatarId
  text: string
  context: PageContext
  status: TaskStatus
}

export type TaskPhase = 'thinking' | 'responding'

/** The live working pill's state for one avatar — it collapses out of the composer (§8.8). */
export interface TaskProgress {
  taskId: string
  phase: TaskPhase
  /** The executor's latest progress label, or null before the first one. */
  label: string | null
  pct?: number
  /** Everything streamed so far; the pill renders its last two lines. */
  stream: string
  source?: 'live' | 'dev-harness'
}

/** A settled task's card: the result, or the failure (§8.7, §12). */
export interface TaskCard {
  id: string
  taskId: string
  avatar: AvatarId
  kind: 'result' | 'error'
  title: string
  body: string
  chart?: ChartSpec
  links?: { label: string; url: string }[]
  shownAt: number
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

/** The context fields a composer chip can remove (architecture §8.8). */
export type ContextField = 'url' | 'title' | 'selection'

/**
 * The open composer's captured page context (§8.8). Set only after
 * `captureContext()` resolves and the avatar is `listening`; cleared the moment
 * the avatar leaves `listening`.
 */
export interface ComposerState {
  avatar: AvatarId
  context: PageContext
  /** Chips the user removed — the task must not receive these fields. */
  removed: ContextField[]
}

export const $composer = atom<ComposerState | null>(null)
/** The AvatarRoom's current speech bubble(s) (§8.6); a live exchange shows one. */
export const $bubbles = atom<SpeechBubble[]>([])
/** Submitted tasks, newest first — the snapshot's `tasks` (§8.7, §12). */
export const $tasks = atom<TaskRecord[]>([])
/** The working pill per avatar while a task runs; absent when nothing runs (§8.8). */
export const $taskProgress = atom<Partial<Record<AvatarId, TaskProgress>>>({})
/** Settled task cards (result/error), one per avatar at most (§8.7). */
export const $taskCards = atom<Record<string, TaskCard>>({})
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
  /** Responding nod pitch in degrees; 0 unless a token burst just arrived (§8.4). */
  nodDeg: number
  /** Generic accent rotation in degrees (§8.4); advances only while thinking. */
  accentDeg: number
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
  /** The open composer's captured context + removed chips (§8.8); null when closed. */
  composer: ComposerState | null
  /** Submitted tasks with the context they carried and how they ended (§8.7, §12). */
  tasks: TaskRecord[]
  /** Settled task cards (result/error) currently on screen. */
  taskCards: TaskCard[]
  /** The live working pill per avatar while a task runs (§8.8). */
  taskProgress: TaskProgress[]
  /** The presented chart's yaw (§8.9); null when no chart is on screen. */
  chart: { visible: boolean; rotationDeg: number } | null
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
  const composer = $composer.get()

  return {
    anchor: pane3dRuntime.anchor,
    avatars: AVATAR_IDS.map(id => {
      const row = avatars[id]
      const frame = avatarFrames[id]

      return {
        accentDeg: frame.accentDeg,
        bowDeg: frame.bowDeg,
        gaze: { ...frame.gaze },
        id,
        materialTypes: [...frame.materialTypes],
        meshCount: frame.meshCount,
        nodDeg: frame.nodDeg,
        screenRect: frame.screenRect ? { ...frame.screenRect } : null,
        slot: visibleOrder.indexOf(id),
        state: row.state,
        visible: row.visible,
        yawDeg: frame.yawDeg
      }
    }),
    bubbles: $bubbles.get().map(bubble => ({ ...bubble })),
    cards: Object.values($cards.get()),
    chart: chartRuntime.visible ? { rotationDeg: chartRuntime.rotationDeg, visible: true } : null,
    composer: composer
      ? { avatar: composer.avatar, context: { ...composer.context }, removed: [...composer.removed] }
      : null,
    feed: $feed.get(),
    frameloop: pane3dRuntime.frameloop,
    lastDemo: pane3dRuntime.lastDemo,
    pixelRatio: pane3dRuntime.pixelRatio,
    prewarm: prewarm.stage,
    prewarmed: [...prewarm.ids],
    reducedMotion: prefersReducedMotion(),
    regions: [...pane3dRuntime.regions],
    renderCount: pane3dRuntime.renderCount,
    taskCards: Object.values($taskCards.get()).map(card => ({ ...card })),
    taskProgress: Object.values($taskProgress.get())
      .filter((progress): progress is TaskProgress => progress !== undefined)
      .map(progress => ({ ...progress })),
    tasks: $tasks.get().map(task => ({ ...task, context: { ...task.context } })),
    transitions: $transitions.get()
  }
}
