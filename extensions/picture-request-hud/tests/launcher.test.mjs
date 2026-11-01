/**
 * Unit proof for the launch path: no browser, no chrome.*, no window.
 *
 * The launcher takes `openWindow` and `pipAvailable` as injectable dependencies
 * precisely so these rules can be asserted here instead of only by eye in
 * Chrome: one click makes one window, a second click reuses it, a HUD owned by
 * another panel is asked to come forward rather than duplicated, and every
 * failure lands on a named, visible error.
 *
 * Run: node --test extensions/picture-request-hud/tests/launcher.test.mjs
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { createBus, MSG } from '../src/bus.mjs'
import {
  ERROR_COPY, HUD_REGISTRY_TTL_MS, describeLaunchError, hudIsLive, hudLaunchPlan,
} from '../src/hud-core.mjs'
import { createHudLauncher } from '../src/launcher.mjs'

const settle = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms))

/** Just enough surface for the launcher: the three methods it calls. */
function fakeSurface() {
  const seen = { errors: [], logs: [], statuses: [] }
  return {
    error: () => [...seen.errors].reverse().find(entry => entry.code !== null)?.code ?? null,
    log: (text, kind) => seen.logs.push({ kind, text }),
    seen,
    setError: (code, detail) => seen.errors.push({ code, detail }),
    setStatus: text => seen.statuses.push(text),
    status: () => seen.statuses.at(-1) ?? null,
  }
}

/** A stand-in for the Document-PiP window handle the launcher receives. */
function fakeHud() {
  const listeners = new Map()
  const counts = { focused: 0, geometry: 0 }
  const window = {
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) {listeners.set(type, [])}
      listeners.get(type).push(fn)
    },
    closed: false,
    focus: () => {
      counts.focused++
    },
    /** The user closing the floating window. */
    simulateClose: () => {
      window.closed = true
      for (const fn of listeners.get('pagehide') ?? []) {fn()}
    },
  }
  return {
    counts,
    handle: {
      applyGeometry: () => {
        counts.geometry++
      },
      document: {},
      window,
    },
    window,
  }
}

const withOpen = (hud, opened) => async () => {
  opened.count++
  return hud.handle
}

test('one click with no HUD open launches exactly one window', async () => {
  const surface = fakeSurface()
  const hud = fakeHud()
  const opened = { count: 0 }
  const launcher = createHudLauncher({
    openWindow: withOpen(hud, opened),
    pipAvailable: () => true,
    surface,
  })

  const receipt = await launcher.launch()

  assert.equal(receipt.action, 'open')
  assert.equal(receipt.ok, true)
  assert.equal(opened.count, 1)
  assert.equal(hud.counts.geometry, 1, 'geometry is applied from inside the window')
  assert.equal(surface.status(), 'HUD is open')
  assert.equal(surface.error(), null, 'a successful launch clears the error card')
  assert.equal(launcher.isOpen(), true)
})

test('a second click focuses the same window instead of opening a duplicate', async () => {
  const surface = fakeSurface()
  const hud = fakeHud()
  const opened = { count: 0 }
  const launcher = createHudLauncher({
    openWindow: withOpen(hud, opened),
    pipAvailable: () => true,
    surface,
  })

  await launcher.launch()
  const again = await launcher.launch()

  assert.equal(again.action, 'focus-local')
  assert.equal(again.reuse, true)
  assert.equal(opened.count, 1, 'never a second window')
  assert.equal(hud.counts.focused, 1)
  assert.equal(surface.status(), 'HUD is open — brought to the front')
})

test('a HUD announced by another panel is brought forward, not duplicated', async () => {
  const surface = fakeSurface()
  const hud = fakeHud()
  const opened = { count: 0 }
  const launcher = createHudLauncher({
    openWindow: withOpen(hud, opened),
    pipAvailable: () => true,
    surface,
  })

  // Stand in for the HUD window in the other panel announcing itself.
  const peer = createBus()
  const heard = []
  peer.subscribe(event => heard.push(event?.type))
  peer.post(MSG.hudState, { open: true, role: 'hud' })
  await settle()

  const receipt = await launcher.launch()
  await settle()

  assert.equal(receipt.action, 'focus-remote')
  assert.equal(opened.count, 0, 'no duplicate window')
  assert.ok(heard.includes(MSG.hudFocusRequest), 'the owner was asked to come forward')
  assert.equal(surface.status(), 'HUD is open — brought to the front')
  peer.close()
})

test('closing the HUD lets the next click launch a fresh one', async () => {
  const surface = fakeSurface()
  const hud = fakeHud()
  const opened = { count: 0 }
  const launcher = createHudLauncher({
    openWindow: withOpen(hud, opened),
    pipAvailable: () => true,
    surface,
  })

  await launcher.launch()
  hud.window.simulateClose()
  await settle(10)

  assert.equal(launcher.isOpen(), false)
  assert.equal(surface.status(), 'HUD closed')

  await launcher.launch()
  assert.equal(opened.count, 2)
})

test('an unsupported browser shows a named error instead of doing nothing', async () => {
  const surface = fakeSurface()
  let called = 0
  const launcher = createHudLauncher({
    openWindow: async () => {
      called++
      throw new Error('must not be reached')
    },
    pipAvailable: () => false,
    surface,
  })

  const receipt = await launcher.launch()

  assert.equal(receipt.ok, false)
  assert.equal(receipt.error, 'HUD_UNSUPPORTED')
  assert.equal(called, 0)
  assert.equal(surface.error(), 'HUD_UNSUPPORTED')
  assert.equal(surface.status(), 'Could not open the HUD')
})

test('a browser refusing the window surfaces HUD_NO_GESTURE, not a silent no-op', async () => {
  const surface = fakeSurface()
  const launcher = createHudLauncher({
    openWindow: async () => {
      const error = new Error('Document PiP requires a user gesture')
      error.name = 'NotAllowedError'
      throw error
    },
    pipAvailable: () => true,
    surface,
  })

  const receipt = await launcher.launch()

  assert.equal(receipt.ok, false)
  assert.equal(receipt.error, 'HUD_NO_GESTURE')
  assert.equal(surface.error(), 'HUD_NO_GESTURE')
  assert.equal(launcher.isOpen(), false)
})

test('the plan prefers the window it owns, then any other, then a new one', () => {
  assert.deepEqual(hudLaunchPlan({}), { action: 'open', label: 'Launch HUD', reuse: false })
  assert.equal(hudLaunchPlan({ remoteOpen: true }).action, 'focus-remote')
  assert.equal(hudLaunchPlan({ localOpen: true, remoteOpen: true }).action, 'focus-local')
  assert.equal(hudLaunchPlan({ localOpen: true }).reuse, true)
  assert.equal(hudLaunchPlan({ remoteOpen: true }).label, 'Bring HUD to front')
})

test('an announcement stops counting as alive once it goes stale', () => {
  const now = 1_000_000
  assert.equal(hudIsLive(now, now), true)
  assert.equal(hudIsLive(now - HUD_REGISTRY_TTL_MS, now), true)
  assert.equal(hudIsLive(now - HUD_REGISTRY_TTL_MS - 1, now), false)
  assert.equal(hudIsLive(0, now), false)
  assert.equal(hudIsLive(undefined, now), false)
  assert.equal(hudIsLive(now + 5_000, now), false, 'a clock that jumped must not keep it alive')
})

test('every launch failure maps to copy the panel can show', () => {
  assert.equal(describeLaunchError(Object.assign(new Error('x'), { name: 'NotAllowedError' })), 'HUD_NO_GESTURE')
  assert.equal(describeLaunchError(Object.assign(new Error('y'), { code: 'HUD_BLOCKED' })), 'HUD_BLOCKED')
  assert.equal(describeLaunchError(Object.assign(new Error('z'), { code: 'NOT_A_CODE' })), 'HUD_FAILED')
  assert.equal(describeLaunchError(new Error('z')), 'HUD_FAILED')

  for (const code of ['HUD_NO_GESTURE', 'HUD_UNSUPPORTED', 'HUD_BLOCKED', 'HUD_FAILED']) {
    assert.ok(ERROR_COPY[code]?.title, `${code} needs a title`)
    assert.ok(ERROR_COPY[code]?.body, `${code} needs a body`)
  }
})
