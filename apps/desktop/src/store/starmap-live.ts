import { atom, computed } from 'nanostores'

import { getStarmapGraph } from '@/hermes'
import type { SessionInfo, StarmapGraph, StarmapNode } from '@/types/hermes'

import type { ClientSessionState } from '../app/types'

import { $sessions, sessionMatchesStoredId } from './session'
import { $sessionStates } from './session-states'
import { $starmapError, $starmapGraph } from './starmap'

// Starmap live mode: while the toggle is on, the graph is polled on a slow
// cadence and every node reports the state of the session currently using it —
// a busy pulse, a waiting-for-input ring, and a one-shot flash when a busy
// session settles. View-layer only; nothing here writes back to the backend.

const LIVE_POLL_MS = 15_000

export const $starmapLive = atom(false)

/** The session a skill node should pulse for / click through to. */
export interface StarmapLiveRef {
  busy: boolean
  /** Session row's last_active, used for picking the liveliest binding. */
  lastActive: number
  needsInput: boolean
  /** Live runtime key — the id `$sessionStates` is keyed by. */
  sessionKey: string
  /** Durable stored id — what `openSession` / pickers consume. */
  storedId: string
}

export interface StarmapGraphDelta {
  /** Node ids present now but not before — these birth-ease in on refresh. */
  nodeIds: Set<string>
  /** Link keys (`a->b`) not in the previous graph — these fade in too. */
  linkKeys: Set<string>
  /** True when the refresh changes the map's structure (a node removed or
   *  retimestamped — ring buckets can shift) and the component should fall
   *  back to a full fade reset + refit instead of a delta birth. */
  structural: boolean
}

const linkKey = (edge: { source: string; target: string }) => `${edge.source}->${edge.target}`

const sameNode = (a: StarmapNode, b: StarmapNode): boolean =>
  a.id === b.id &&
  a.label === b.label &&
  a.kind === b.kind &&
  a.timestamp === b.timestamp &&
  a.category === b.category &&
  a.useCount === b.useCount &&
  a.state === b.state &&
  a.createdBy === b.createdBy &&
  a.pinned === b.pinned &&
  a.memorySource === b.memorySource

/** Structural equality over everything the map renders — the poll uses it to
 *  skip a store write (and the sim rebuild + re-jiggle it triggers) when a
 *  refresh returns the same learning state. */
export function sameStarmapGraph(a: StarmapGraph, b: StarmapGraph): boolean {
  if (
    a.nodes.length !== b.nodes.length ||
    a.edges.length !== b.edges.length ||
    a.memory.length !== b.memory.length ||
    a.clusters.length !== b.clusters.length
  ) {
    return false
  }

  const nodeById = new Map(b.nodes.map(node => [node.id, node]))

  if (!a.nodes.every(node => sameNode(node, nodeById.get(node.id) ?? node))) {
    return false
  }

  const linksB = new Set(b.edges.map(linkKey))

  if (!a.edges.every(edge => linksB.has(linkKey(edge)))) {
    return false
  }

  return a.memory.every(
    (card, i) =>
      card === b.memory[i] ||
      (card.source === b.memory[i]!.source &&
        card.title === b.memory[i]!.title &&
        card.body === b.memory[i]!.body &&
        card.fingerprint === b.memory[i]!.fingerprint &&
        card.timestamp === b.memory[i]!.timestamp)
  )
}

/** Diff a live refresh against the previous graph (null-safe). */
export function diffStarmapGraphs(prev: null | StarmapGraph, next: StarmapGraph): StarmapGraphDelta {
  const delta: StarmapGraphDelta = { linkKeys: new Set(), nodeIds: new Set(), structural: true }

  if (!prev) {
    return delta
  }

  delta.structural = false

  const prevNodes = new Map(prev.nodes.map(node => [node.id, node]))

  for (const node of next.nodes) {
    const before = prevNodes.get(node.id)

    if (!before) {
      delta.nodeIds.add(node.id)

      continue
    }

    // A moved timestamp or a kind flip relocates the node's ring bucket —
    // indices shift, so this is a layout change, not a delta birth.
    if (before.timestamp !== node.timestamp || before.kind !== node.kind) {
      delta.structural = true
    }
  }

  if (next.nodes.length !== prev.nodes.length + delta.nodeIds.size) {
    // The count doesn't reconcile → a node was dropped; buckets may have
    // shifted, so treat it as structural too.
    delta.structural = true
  }

  const prevLinks = new Set(prev.edges.map(linkKey))

  for (const edge of next.edges) {
    const key = linkKey(edge)

    if (!prevLinks.has(key)) {
      delta.linkKeys.add(key)
    }
  }

  return delta
}

// ── Live session → skill binding ────────────────────────────────────────────

const skillNamesOf = (skills: ClientSessionState['skills']): string[] => Object.values(skills).flat()

const sessionLastActive = (storedId: string, sessions: readonly SessionInfo[]): number =>
  sessions.find(row => sessionMatchesStoredId(row, storedId))?.last_active ?? 0

/** Rank two candidate sessions for one skill: the one doing visible work
 *  (busy, then waiting-for-input) wins; otherwise the more recently active. */
const better = (a: StarmapLiveRef, b: StarmapLiveRef): StarmapLiveRef => {
  if (a.busy !== b.busy) {
    return a.busy ? a : b
  }

  if (a.needsInput !== b.needsInput) {
    return a.needsInput ? a : b
  }

  return a.lastActive >= b.lastActive ? a : b
}

/**
 * skill name → the one session to attribute it to. Every session publishes
 * its loaded skill set on `state.skills`; several sessions can share a skill,
 * so this resolves each skill to its liveliest binding.
 */
export function resolveLiveSkillSessions(
  states: Readonly<Record<string, ClientSessionState>>,
  sessions: readonly SessionInfo[]
): Map<string, StarmapLiveRef> {
  const live = new Map<string, StarmapLiveRef>()

  for (const [sessionKey, state] of Object.entries(states)) {
    if (!state) {
      continue
    }

    const storedId = state.storedSessionId ?? sessionKey
    const lastActive = sessionLastActive(storedId, sessions)

    for (const skill of skillNamesOf(state.skills)) {
      const candidate: StarmapLiveRef = {
        busy: state.busy,
        lastActive,
        needsInput: state.needsInput,
        sessionKey,
        storedId
      }

      const current = live.get(skill)

      live.set(skill, current ? better(candidate, current) : candidate)
    }
  }

  return live
}

export const $starmapLiveSessions = computed([$sessionStates, $sessions], (states, sessions) =>
  resolveLiveSkillSessions(states, sessions)
)

// ── Settle events ───────────────────────────────────────────────────────────

/** skill name → ms epoch of its last busy→idle settle. The component turns
 *  each fresh entry into a one-shot expanding flash on that node. */
export const $starmapSettles = atom<Record<string, number>>({})

/** Per-skill busy projection — true while any bound session is busy. */
export function skillBusyMap(states: Readonly<Record<string, ClientSessionState>>): Map<string, boolean> {
  const busy = new Map<string, boolean>()

  for (const state of Object.values(states)) {
    if (!state) {
      continue
    }

    for (const skill of skillNamesOf(state.skills)) {
      busy.set(skill, Boolean(busy.get(skill)) || state.busy)
    }
  }

  return busy
}

/** Skills that flipped busy → idle between two projections (a session using
 *  them finished its turn). */
export function detectSettles(prev: ReadonlyMap<string, boolean>, next: ReadonlyMap<string, boolean>): string[] {
  const settled: string[] = []

  for (const [skill, wasBusy] of prev) {
    if (wasBusy && !next.get(skill)) {
      settled.push(skill)
    }
  }

  return settled
}

// ── Poll loop + settle watch (live-mode lifecycle) ──────────────────────────

let pollTimer: null | ReturnType<typeof setInterval> = null
let settleUnsub: null | (() => void) = null
let prevBusy: Map<string, boolean> = new Map()

async function refreshStarmapGraph(): Promise<void> {
  try {
    const next = await getStarmapGraph()
    const prev = $starmapGraph.get()

    // Skip the write (and the sim rebuild it triggers) when nothing changed.
    if (!prev || !sameStarmapGraph(prev, next)) {
      $starmapGraph.set(next)
    }
  } catch (err) {
    $starmapError.set(err instanceof Error ? err.message : String(err))
  }
}

function onSessionStates(states: Record<string, ClientSessionState>): void {
  const next = skillBusyMap(states)
  const settled = detectSettles(prevBusy, next)
  prevBusy = next

  if (settled.length) {
    const marks = { ...$starmapSettles.get() }
    const now = Date.now()

    for (const skill of settled) {
      marks[skill] = now
    }

    $starmapSettles.set(marks)
  }
}

/** Start the live feed: poll the graph and watch session states for busy →
 *  idle edges on skill-bearing sessions. Idempotent. */
export function startStarmapLive(): void {
  if (pollTimer) {
    return
  }

  $starmapLive.set(true)
  prevBusy = skillBusyMap($sessionStates.get())
  settleUnsub = $sessionStates.subscribe(onSessionStates)
  void refreshStarmapGraph()
  pollTimer = setInterval(() => void refreshStarmapGraph(), LIVE_POLL_MS)
}

/** Stop the feed and clear live-derived state. Idempotent. */
export function stopStarmapLive(): void {
  $starmapLive.set(false)
  $starmapSettles.set({})
  prevBusy = new Map()

  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }

  settleUnsub?.()
  settleUnsub = null
}
