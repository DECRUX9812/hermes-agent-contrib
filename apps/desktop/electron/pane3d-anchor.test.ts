/**
 * Contract tests for the 3D-Pane AnchorService (architecture §7, VAL-ANCHOR-005,
 * VAL-CROSS-004).
 *
 * The selection rules are pure data (`pickHermesGuest`, `pickFrontmostForeignWindow`),
 * the space conversion is pure (`toPaneLocal`), change detection is pure
 * (`anchorEqual`), the consent rule is pure (`titlesAvailableFor`) and the probe
 * budget is pure (`withTimeout`). The service session is driven through injected
 * window/guest handles and injected timers, so re-entrancy, generation
 * invalidation and `stop()` cleanup are provable without booting Electron.
 */

import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

import type { PaneAnchor, PaneState, ScreenRect } from '../src/app/pane3d/protocol'

import { createAnchorService } from './pane3d-anchor'
import {
  anchorEqual,
  type AnchorGuestCandidate,
  type AnchorHostCandidate,
  type OsWindowCandidate,
  pickFrontmostForeignWindow,
  pickHermesGuest,
  titlesAvailableFor,
  toPaneLocal,
  withTimeout
} from './pane3d-anchor-pick'
import type { AnchorGuestHandle, AnchorHostWindow, AnchorPaneWindow, AnchorServiceDeps } from './pane3d-anchor-types'

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
  minimized: false,
  visible: true,
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

test('a hidden host loses even when it was the most recently focused one', () => {
  const picked = pickHermesGuest([
    host({ focused: true, guests: [guest({ webContentsId: 1 })], lastFocusedAt: 9_000, visible: false, windowId: 1 }),
    host({ guests: [guest({ webContentsId: 2 })], lastFocusedAt: 1, windowId: 2 })
  ])

  assert.equal(picked?.host.windowId, 2)
  assert.equal(picked?.guest.webContentsId, 2)
})

test('a minimized host is never eligible, even alone', () => {
  assert.equal(pickHermesGuest([host({ focused: true, minimized: true })]), null)
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

// ── pickFrontmostForeignWindow (VAL-ANCHOR-005) ─────────────────────────────

const osWindow = (over: Partial<OsWindowCandidate> = {}): OsWindowCandidate => ({
  app: 'Xterm',
  bounds: rect(240, 300, 1000, 700),
  pid: 4001,
  title: 'Terminal',
  ...over
})

test('skips Hermes OS windows (browser and child/renderer pids) and takes the frontmost foreign one', () => {
  // A real Hermes instance owns windows through the main (browser) pid and can
  // also have a child/renderer pid attached (app.getAppMetrics() lists them).
  // The candidates arrive front-to-back, so the two Hermes windows lead.
  const hermesBrowserPid = 1234
  const hermesRendererPid = 1240

  const picked = pickFrontmostForeignWindow(
    [
      osWindow({ app: 'Hermes', pid: hermesBrowserPid, title: 'Hermes' }),
      osWindow({ app: 'Hermes', pid: hermesRendererPid, title: 'Hermes — 3D Pane' }),
      osWindow({ app: 'Code', pid: 4100, title: 'main.ts' }),
      osWindow({ app: 'Firefox', pid: 4200, title: 'Docs' })
    ],
    [hermesBrowserPid, hermesRendererPid]
  )

  assert.equal(picked?.title, 'main.ts')
  assert.equal(picked?.pid, 4100)
})

test('skips a zero-area foreign window instead of adopting an unusable anchor', () => {
  const picked = pickFrontmostForeignWindow(
    [osWindow({ bounds: rect(0, 0, 0, 0), pid: 4100 }), osWindow({ pid: 4200, title: 'Docs' })],
    [1234]
  )

  assert.equal(picked?.title, 'Docs')
})

test('returns null when only Hermes windows are on screen, so the anchor falls to the desktop', () => {
  assert.equal(pickFrontmostForeignWindow([osWindow({ pid: 1234 }), osWindow({ pid: 1240 })], [1234, 1240]), null)
  assert.equal(pickFrontmostForeignWindow([], [1234]), null)
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

// ── titlesAvailableFor (platform as data) ──────────────────────────────────

test('only macOS without the Screen Recording grant withholds titles', () => {
  assert.equal(titlesAvailableFor('darwin', 'granted'), true)
  assert.equal(titlesAvailableFor('darwin', 'denied'), false)
  assert.equal(titlesAvailableFor('darwin', null), false)
  assert.equal(titlesAvailableFor('darwin', 'restricted'), false)
  assert.equal(titlesAvailableFor('linux', 'denied'), true)
  assert.equal(titlesAvailableFor('linux', undefined), true)
  assert.equal(titlesAvailableFor('win32', 'denied'), true)
})

// ── withTimeout ────────────────────────────────────────────────────────────

test('withTimeout resolves the value when the promise is fast', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), 1000, 'fallback'), 'ok')
})

test('withTimeout resolves the fallback when the promise never settles or rejects', async () => {
  vi.useFakeTimers()

  try {
    const hung = withTimeout(new Promise<string>(() => {}), 1000, 'fallback')
    const rejected = withTimeout(Promise.reject(new Error('boom')), 1000, 'fallback')

    await vi.advanceTimersByTimeAsync(1000)

    assert.equal(await hung, 'fallback')
    assert.equal(await rejected, 'fallback')
  } finally {
    vi.useRealTimers()
  }
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
    isMinimized: () => false,
    isVisible: () => true,
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
    isDestroyed: () => false,
    isVisible: () => true
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

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, reject, resolve }
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

test('a hidden or minimized host is skipped after the probe even when most recently focused', async () => {
  const hidden = makeHost({
    isFocused: () => true,
    isVisible: () => false,
    probe: async () => [guest({ webContentsId: 11 })]
  })

  const hiddenGuest = makeGuest({ getHost: () => hidden, webContentsId: 11 })

  const hiddenHarness = harness({
    enumerateOsWindow: async () => ({ app: 'Xterm', bounds: rect(0, 0, 800, 600), title: 'Terminal' }),
    listGuests: () => [hiddenGuest],
    listHosts: () => [hidden]
  })

  await hiddenHarness.service.start()

  const hiddenInit = hiddenHarness.states[0]

  assert.equal(hiddenInit.type === 'init' && hiddenInit.anchor.kind, 'os-window')
  hiddenHarness.service.stop()

  const minimized = makeHost({ isFocused: () => true, isMinimized: () => true })
  const minimizedGuest = makeGuest({ getHost: () => minimized })
  const minimizedHarness = harness({ listGuests: () => [minimizedGuest], listHosts: () => [minimized] })

  await minimizedHarness.service.start()

  const minimizedInit = minimizedHarness.states[0]

  assert.equal(minimizedInit.type === 'init' && minimizedInit.anchor.kind, 'desktop')
  minimizedHarness.service.stop()
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
  await flush()
  assert.equal(harnessed.states.length, 1)

  // Real move: one push.
  rx = 140
  harnessed.intervals[0].fn()
  await flush()
  assert.equal(harnessed.states.length, 2)
  assert.equal(harnessed.states[1].type, 'anchor')

  harnessed.service.stop()
})

test('a second ready while running refreshes init once, with no new poll or listeners', async () => {
  const h = makeHost({ probe: async () => [guest({ webContentsId: 11 })] })
  const g = makeGuest({ getHost: () => h })
  const harnessed = harness({ listGuests: () => [g], listHosts: () => [h] })

  await harnessed.service.start()
  assert.equal(harnessed.states.length, 1)

  const hostListenersBefore = [...h.listeners.values()].reduce((total, list) => total + list.length, 0)
  const guestListenersBefore = [...g.listeners.values()].reduce((total, list) => total + list.length, 0)

  // The renderer reloaded: same window, a new `ready`, a moved anchor.
  h.probe = async () => [guest({ rect: rect(200, 60, 900, 450), webContentsId: 11 })]
  await harnessed.service.start()

  assert.equal(harnessed.states.length, 2)
  assert.equal(harnessed.states[1].type, 'init')
  assert.equal(harnessed.states[1].type === 'init' && harnessed.states[1].anchor.rect.x, 200)
  assert.equal(harnessed.intervals.length, 1, 'no second poll may be added')
  assert.equal(
    [...h.listeners.values()].reduce((total, list) => total + list.length, 0),
    hostListenersBefore
  )
  assert.equal(
    [...g.listeners.values()].reduce((total, list) => total + list.length, 0),
    guestListenersBefore
  )

  harnessed.service.stop()
})

test('a stop()+start() during an in-flight pick leaves one live poll and no stale init', async () => {
  const first = deferred<AnchorGuestCandidate[]>()
  const second = deferred<AnchorGuestCandidate[]>()
  const probes: Array<ReturnType<typeof deferred<AnchorGuestCandidate[]>>> = []

  const h = makeHost({
    probe: () => {
      const probe = probes.length === 0 ? first : second

      probes.push(probe)

      return probe.promise
    }
  })

  const g = makeGuest({ getHost: () => h })
  const harnessed = harness({ listGuests: () => [g], listHosts: () => [h] })

  const startFirst = harnessed.service.start()
  // The first start is suspended on its probe now.
  assert.equal(probes.length, 1)

  harnessed.service.stop()
  const startSecond = harnessed.service.start()
  assert.equal(probes.length, 2)

  first.resolve([guest({ webContentsId: 11 })])
  second.resolve([guest({ webContentsId: 11 })])
  await startFirst
  await startSecond

  assert.equal(harnessed.intervals.length, 1, 'the aborted start must not leak a poll')
  assert.equal(harnessed.states.length, 1, 'the aborted start must not push an init')
  assert.equal(harnessed.states[0].type, 'init')

  harnessed.service.stop()

  assert.deepEqual(harnessed.cleared, [1])
  assert.equal(harnessed.service.isRunning(), false)
  ;[...h.listeners.values()].forEach(list => assert.equal(list.length, 0))
  ;[...g.listeners.values()].forEach(list => assert.equal(list.length, 0))
})

test('poll ticks probe nothing while the pane is hidden and resume when it is visible', async () => {
  let visible = true
  let probes = 0
  let osCalls = 0

  const h = makeHost({
    probe: async () => {
      probes += 1

      return [guest({ webContentsId: 11 })]
    }
  })

  const g = makeGuest({ getHost: () => h })

  const pane: AnchorPaneWindow = {
    getContentBounds: () => rect(240, 108, 1440, 864),
    getZoomFactor: () => 0.9,
    isDestroyed: () => false,
    isVisible: () => visible
  }

  const harnessed = harness({
    enumerateOsWindow: async () => {
      osCalls += 1

      return null
    },
    getPane: () => pane,
    listGuests: () => [g],
    listHosts: () => [h]
  })

  await harnessed.service.start()
  const probesAfterStart = probes

  assert.ok(probesAfterStart > 0, 'the init anchor needs a probe')

  visible = false
  harnessed.intervals[0].fn()
  await flush()
  assert.equal(probes, probesAfterStart, 'a hidden pane must not be probed')
  assert.equal(osCalls, 0, 'a hidden pane must not enumerate OS windows')

  visible = true
  harnessed.intervals[0].fn()
  await flush()
  assert.ok(probes > probesAfterStart, 'picking resumes once the pane is visible')

  harnessed.service.stop()
})

test('a probe that never resolves times out and does not block the next pick', async () => {
  vi.useFakeTimers()

  try {
    let hang = true
    let probes = 0

    const h = makeHost({
      probe: () => {
        probes += 1

        return hang ? new Promise<AnchorGuestCandidate[]>(() => {}) : Promise.resolve([guest({ webContentsId: 11 })])
      }
    })

    const g = makeGuest({ getHost: () => h })
    const harnessed = harness({ listGuests: () => [g], listHosts: () => [h] })

    const started = harnessed.service.start()

    await vi.advanceTimersByTimeAsync(1000)
    await started

    assert.equal(harnessed.states[0].type === 'init' && harnessed.states[0].anchor.kind, 'desktop')
    assert.equal(probes, 1)

    // The hung host is gone: the next pick is not stuck behind it.
    hang = false
    const anchorNow = await harnessed.service.pick()

    assert.equal(probes, 2)
    assert.equal(anchorNow.kind, 'hermes-browser')

    harnessed.service.stop()
  } finally {
    vi.useRealTimers()
  }
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
