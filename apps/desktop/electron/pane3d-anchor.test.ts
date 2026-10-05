/**
 * Contract tests for the 3D-Pane AnchorService (architecture §7, VAL-ANCHOR-005,
 * VAL-CROSS-004).
 *
 * The selection rules are pure data (`pickHermesGuest`), the space conversion is
 * pure (`toPaneLocal`) and change detection is pure (`anchorEqual`). The service
 * orchestration is driven through injected window/guest handles and injected
 * timers, so `stop()` cleanup is provable without booting Electron.
 *
 * `electron` is mocked because the module type-imports it; nothing here touches
 * a real Electron primitive.
 */

import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  screen: {},
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) },
  webContents: { getAllWebContents: () => [] }
}))

import type { PaneAnchor, PaneState, ScreenRect } from '../src/app/pane3d/protocol'

import {
  anchorEqual,
  type AnchorGuestCandidate,
  type AnchorGuestHandle,
  type AnchorHostCandidate,
  type AnchorHostWindow,
  type AnchorPaneWindow,
  type AnchorServiceDeps,
  createAnchorService,
  pickHermesGuest,
  toPaneLocal
} from './pane3d-anchor'

const rect = (x: number, y: number, width: number, height: number): ScreenRect => ({ height, width, x, y })

const guest = (over: Partial<AnchorGuestCandidate> = {}): AnchorGuestCandidate => ({
  active: false,
  rect: rect(20, 30, 800, 600),
  title: 'Ada on X',
  visible: true,
  webContentsId: 1,
  ...over
})

const host = (over: Partial<AnchorHostCandidate> = {}): AnchorHostCandidate => ({
  bounds: rect(0, 0, 1920, 1080),
  focused: false,
  guests: [guest()],
  lastFocusedAt: 0,
  windowId: 1,
  zoom: 1,
  ...over
})

// ── pickHermesGuest ────────────────────────────────────────────────────────

test('prefers a visible guest in the focused host over an unfocused host', () => {
  const picked = pickHermesGuest([
    host({ guests: [guest({ webContentsId: 1 })], lastFocusedAt: 9_000, windowId: 1 }),
    host({ focused: true, guests: [guest({ webContentsId: 2, title: 'popout' })], lastFocusedAt: 1, windowId: 2 })
  ])

  assert.equal(picked?.host.windowId, 2)
  assert.equal(picked?.guest.webContentsId, 2)
})

test('falls back to the most recently focused host when none is focused', () => {
  const picked = pickHermesGuest([
    host({ guests: [guest({ webContentsId: 1 })], lastFocusedAt: 1_000, windowId: 1 }),
    host({ guests: [guest({ webContentsId: 2 })], lastFocusedAt: 5_000, windowId: 2 })
  ])

  assert.equal(picked?.host.windowId, 2)
})

test('within a host prefers the guest that contains the active element', () => {
  const picked = pickHermesGuest([
    host({
      guests: [guest({ active: false, webContentsId: 1 }), guest({ active: true, webContentsId: 2 })]
    })
  ])

  assert.equal(picked?.guest.webContentsId, 2)
})

test('skips guests that are hidden or have no layout rect', () => {
  const picked = pickHermesGuest([
    host({ guests: [guest({ rect: null, webContentsId: 1 }), guest({ visible: false, webContentsId: 2 })] })
  ])

  assert.equal(picked, null)
})

test('ignores a host whose only guest has zero size', () => {
  const picked = pickHermesGuest([host({ guests: [guest({ rect: rect(0, 0, 0, 0) })] })])

  assert.equal(picked, null)
})

// ── toPaneLocal ────────────────────────────────────────────────────────────

test('converts a screen rect to pane-local CSS px through the pane zoom and origin', () => {
  // Host webview at screen DIP (240 + 100, 108 + 50), pane origin (240, 108),
  // pane zoom 0.9: (100/0.9, 50/0.9).
  const local = toPaneLocal(rect(340, 158, 900, 450), { x: 240, y: 108 }, 0.9)

  assert.ok(Math.abs(local.x - 100 / 0.9) < 1e-6)
  assert.ok(Math.abs(local.y - 50 / 0.9) < 1e-6)
  assert.ok(Math.abs(local.width - 900 / 0.9) < 1e-6)
  assert.ok(Math.abs(local.height - 450 / 0.9) < 1e-6)
})

test('treats a broken zoom factor as 1 instead of collapsing the rect', () => {
  assert.deepEqual(toPaneLocal(rect(10, 20, 30, 40), { x: 0, y: 0 }, 0), rect(10, 20, 30, 40))
})

// ── anchorEqual ────────────────────────────────────────────────────────────

const anchor = (over: Partial<PaneAnchor> = {}): PaneAnchor => ({
  kind: 'hermes-browser',
  label: 'Ada on X',
  rect: rect(10, 20, 100, 50),
  ...over
})

test('ignores sub-pixel jitter but detects a real move', () => {
  assert.equal(anchorEqual(anchor(), anchor({ rect: rect(10.4, 20.4, 100.4, 50.4) })), true)
  assert.equal(anchorEqual(anchor(), anchor({ rect: rect(12, 20, 100, 50) })), false)
})

test('detects a kind or label change even when the rect is identical', () => {
  assert.equal(anchorEqual(anchor(), anchor({ kind: 'desktop' })), false)
  assert.equal(anchorEqual(anchor(), anchor({ label: 'other' })), false)
})

// ── createAnchorService ────────────────────────────────────────────────────

interface FakeHost extends AnchorHostWindow {
  listeners: Map<string, Array<() => void>>
  probe: () => Promise<AnchorGuestCandidate[]>
}

function makeHost(over: Partial<FakeHost> = {}): FakeHost {
  const listeners = new Map<string, Array<() => void>>()

  const fake: FakeHost = {
    getContentBounds: () => rect(240, 108, 1440, 864),
    getZoomFactor: () => 0.9,
    id: 1,
    isDestroyed: () => false,
    isFocused: () => false,
    listeners,
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    probe: async () => [guest()],
    probeWebviews: async () => fake.probe(),
    removeListener: (event, listener) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter(item => item !== listener)
      )
    },
    ...over
  }

  return fake
}

interface FakeGuest extends AnchorGuestHandle {
  listeners: Map<string, Array<() => void>>
}

function makeGuest(over: Partial<FakeGuest> = {}): FakeGuest {
  const listeners = new Map<string, Array<() => void>>()

  const fake: FakeGuest = {
    getHost: () => null,
    getTitle: () => 'Ada on X',
    isDestroyed: () => false,
    listeners,
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    removeListener: (event, listener) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter(item => item !== listener)
      )
    },
    webContentsId: 11,
    ...over
  }

  return fake
}

function harness(over: Partial<AnchorServiceDeps> = {}) {
  const states: PaneState[] = []
  const intervals: Array<{ fn: () => void; ms: number }> = []
  const cleared: unknown[] = []
  const rehomed: ScreenRect[] = []

  const pane: AnchorPaneWindow = {
    getContentBounds: () => rect(240, 108, 1440, 864),
    getZoomFactor: () => 0.9,
    isDestroyed: () => false
  }

  const deps: AnchorServiceDeps = {
    clearIntervalFn: handle => cleared.push(handle),
    enumerateOsWindow: async () => null,
    getPane: () => pane,
    listGuests: () => [],
    listHosts: () => [],
    now: () => 0,
    platform: 'linux',
    pushState: state => states.push(state),
    rehome: screenRect => rehomed.push(screenRect),
    setIntervalFn: (fn, ms) => {
      intervals.push({ fn, ms })

      return intervals.length
    },
    ...over
  }

  return { cleared, deps, intervals, pane, rehomed, service: createAnchorService(deps), states }
}

test('hermes-browser guest wins and the anchor is pushed in init as pane-local CSS px', async () => {
  // The probe deliberately omits the title: the label must come from the
  // guest's own webContents (the DOM probe has no title).
  const h = makeHost({ probe: async () => [guest({ rect: rect(100, 50, 900, 450), title: '', webContentsId: 11 })] })

  const g = makeGuest({ getHost: () => h, webContentsId: 11 })
  const harnessed = harness({ listGuests: () => [g], listHosts: () => [h] })

  await harnessed.service.start()

  const init = harnessed.states[0]

  assert.equal(init.type, 'init')

  if (init.type !== 'init') {
    return
  }

  assert.equal(init.platform, 'linux')
  assert.equal(init.reducedMotion, false)
  assert.equal(init.anchor.kind, 'hermes-browser')
  assert.equal(init.anchor.label, 'Ada on X')
  // Host content origin (240,108) + rect (100,50)×0.9 = screen DIP (330,153);
  // pane origin (240,108), pane zoom 0.9 → (100, 50).
  assert.ok(Math.abs(init.anchor.rect.x - 100) < 1e-6)
  assert.ok(Math.abs(init.anchor.rect.y - 50) < 1e-6)
  assert.ok(Math.abs(init.anchor.rect.width - 900) < 1e-6)
  // The poll must be ≤ 4 Hz.
  assert.equal(harnessed.intervals.length, 1)
  assert.ok(harnessed.intervals[0].ms >= 250)

  harnessed.service.stop()
})

test('falls back to the frontmost OS window when there is no browser guest', async () => {
  const harnessed = harness({
    enumerateOsWindow: async () => ({ app: 'Xterm', bounds: rect(240, 300, 1000, 700), title: 'Terminal' }),
    listGuests: () => [],
    listHosts: () => []
  })

  await harnessed.service.start()

  const init = harnessed.states[0]

  assert.equal(init.type === 'init' && init.anchor.kind, 'os-window')
  assert.equal(init.type === 'init' && init.anchor.label, 'Terminal')
  assert.ok(harnessed.rehomed.length === 1)

  harnessed.service.stop()
})

test('floats on the desktop when there is neither a browser guest nor an OS window', async () => {
  const harnessed = harness()

  await harnessed.service.start()

  const init = harnessed.states[0]

  assert.equal(init.type === 'init' && init.anchor.kind, 'desktop')

  harnessed.service.stop()
})

test('pushes an anchor update on a real move but ignores sub-pixel jitter', async () => {
  let rx = 100
  const h = makeHost({ probe: async () => [guest({ rect: rect(rx, 50, 900, 450), webContentsId: 11 })] })
  const g = makeGuest({ getHost: () => h })
  const harnessed = harness({ listGuests: () => [g], listHosts: () => [h] })

  await harnessed.service.start()
  assert.equal(harnessed.states.length, 1)

  // Sub-pixel: no push.
  rx = 100.4
  await harnessed.service.pick()

  // The poll tick is what publishes changes.
  harnessed.intervals[0].fn()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(harnessed.states.length, 1)

  // Real move: one push.
  rx = 140
  harnessed.intervals[0].fn()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(harnessed.states.length, 2)
  assert.equal(harnessed.states[1].type, 'anchor')

  harnessed.service.stop()
})

test('stop() clears the poll and removes every window and guest listener', async () => {
  const h = makeHost()
  const g = makeGuest({ getHost: () => h })
  const harnessed = harness({ listGuests: () => [g], listHosts: () => [h] })

  await harnessed.service.start()
  assert.ok(h.listeners.size > 0)
  assert.ok(g.listeners.size > 0)
  assert.equal(harnessed.cleared.length, 0)

  harnessed.service.stop()

  assert.deepEqual(harnessed.cleared, [1])
  assert.equal(harnessed.service.isRunning(), false)
  ;[...h.listeners.values()].forEach(list => assert.equal(list.length, 0))
  ;[...g.listeners.values()].forEach(list => assert.equal(list.length, 0))
})

test('a destroyed guest is never selected', async () => {
  const h = makeHost({ probe: async () => [guest({ webContentsId: 11 })] })
  const dead = makeGuest({ getHost: () => h, isDestroyed: () => true, webContentsId: 11 })
  const harnessed = harness({ listGuests: () => [dead], listHosts: () => [h] })

  await harnessed.service.start()

  assert.equal(harnessed.states[0].type === 'init' && harnessed.states[0].anchor.kind, 'desktop')

  harnessed.service.stop()
})
