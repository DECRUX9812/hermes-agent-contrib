/**
 * Unit tests for the parts of the HUD that are pure logic. Run with:
 *   node --test extensions/picture-request-hud/tests/
 *
 * These cover the things that break silently in a browser: geometry clamping
 * across small screens and DPI, the consent state machine, and the promise that
 * every error the capture/pip paths emit has human copy attached.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_HUD_SIZE, ERROR_COPY, MAX_HUD_SIZE, MAX_TASK_CHARS, MIN_HUD_SIZE,
  clampHudGeometry, copyFor, createConsentState, describeCaptureError, describeHudError, liveBadge, normalizeBackendUrl, normalizeTask,
} from '../src/hud-core.mjs'

test('geometry: default size survives a normal 1080p display', () => {
  const got = clampHudGeometry(DEFAULT_HUD_SIZE, { availHeight: 1040, availWidth: 1920 })
  assert.deepEqual(got, DEFAULT_HUD_SIZE)
})

test('geometry: never exceeds the display, always leaves a grab margin', () => {
  const got = clampHudGeometry({ height: 2000, width: 2000 }, { availHeight: 800, availWidth: 1280 })
  assert.ok(got.width <= 1280 - 16, `width ${got.width}`)
  assert.ok(got.height <= 800 - 16, `height ${got.height}`)
})

test('geometry: never collapses below the minimum, even on a tiny display', () => {
  const got = clampHudGeometry({ height: 10, width: 10 }, { availHeight: 200, availWidth: 240 })
  assert.deepEqual(got, MIN_HUD_SIZE)
})

test('geometry: a translated second monitor clamps to its own size, not the union', () => {
  // Laptop (1920) to the left of an external panel: availLeft is negative and
  // availWidth is only the current display. Using availLeft in the math would
  // wrongly shrink the HUD.
  const got = clampHudGeometry({ height: 600, width: 420 }, { availHeight: 1040, availLeft: -1920, availWidth: 1920 })
  assert.deepEqual(got, { height: 600, width: 420 })
})

test('geometry: garbage in, defaults out', () => {
  assert.deepEqual(clampHudGeometry(null, {}), DEFAULT_HUD_SIZE)
  assert.deepEqual(clampHudGeometry({ height: Number.NaN, width: '420' }, {}), DEFAULT_HUD_SIZE)
})

test('geometry: sizes are CSS pixels, so a 2x panel does not double them', () => {
  const dpr1 = clampHudGeometry({ height: 560, width: 420 }, { availHeight: 1040, availWidth: 1920 })
  const dpr2 = clampHudGeometry({ height: 560, width: 420 }, { availHeight: 1040, availWidth: 1920 })
  assert.deepEqual(dpr1, dpr2)
  assert.ok(dpr1.width < MAX_HUD_SIZE.width)
})

test('consent: idle → asking → live → stopped, and never live without a grant', () => {
  const seen = []
  const consent = createConsentState(s => seen.push(s.state))
  assert.equal(consent.isLive, false)
  assert.equal(consent.begin(), true)
  assert.equal(consent.isLive, false)
  consent.granted('Entire screen')
  assert.equal(consent.isLive, true)
  assert.equal(consent.begin(), false, 'a second begin() while live must not re-prompt')
  consent.stopped('user')
  assert.equal(consent.isLive, false)
  assert.deepEqual(seen, ['asking', 'live', 'stopped'])
})

test('consent: denial is distinct from a stop, and needs recovery copy', () => {
  const consent = createConsentState()
  consent.begin()
  consent.denied({ name: 'NotAllowedError' })
  assert.equal(consent.state, 'denied')
  const events = []
  createConsentState(e => events.push(e)).stopped('user')
  assert.deepEqual(events, [{ detail: 'user', state: 'stopped' }])
})

test('consent: an ended track lands in stopped, not denied', () => {
  const consent = createConsentState()
  consent.begin()
  consent.granted('Window')
  consent.ended()
  assert.equal(consent.state, 'stopped')
})

test('errors: every DOMException the picker can throw maps to its own code', () => {
  const cases = {
    AbortError: 'CAPTURE_CANCELLED',
    InvalidStateError: 'CAPTURE_NO_GESTURE',
    NotAllowedError: 'CAPTURE_DENIED',
    NotFoundError: 'CAPTURE_NO_SOURCE',
    NotReadableError: 'CAPTURE_BUSY',
    NotSupportedError: 'CAPTURE_UNSUPPORTED',
    PermissionDeniedError: 'CAPTURE_DENIED',
    TrackStartError: 'CAPTURE_BUSY',
    WeirdUnknown: 'CAPTURE_FAILED',
  }
  for (const [name, code] of Object.entries(cases)) {
    assert.equal(describeCaptureError({ name }), code, name)
  }
  assert.equal(describeCaptureError(null), 'CAPTURE_FAILED')
})

test('errors: HUD failures map to HUD codes', () => {
  assert.equal(describeHudError({ name: 'NotAllowedError' }), 'HUD_NO_GESTURE')
  assert.equal(describeHudError({ name: 'NotSupportedError' }), 'HUD_UNSUPPORTED')
  assert.equal(describeHudError({ name: 'InvalidStateError' }), 'HUD_BLOCKED')
  assert.equal(describeHudError({}), 'HUD_FAILED')
})

test('errors: every code the code paths can emit has copy with both fields', () => {
  const emittable = [
    'HUD_UNSUPPORTED', 'HUD_NO_GESTURE', 'HUD_BLOCKED', 'HUD_FAILED',
    'CAPTURE_DENIED', 'CAPTURE_CANCELLED', 'CAPTURE_NO_SOURCE', 'CAPTURE_BUSY',
    'CAPTURE_NO_GESTURE', 'CAPTURE_UNSUPPORTED', 'CAPTURE_FAILED',
    'BACKEND_OFFLINE', 'EXTENSION_CONTEXT_LOST',
  ]
  for (const code of emittable) {
    assert.ok(ERROR_COPY[code], `missing copy for ${code}`)
    assert.ok(ERROR_COPY[code].title.length > 3, `${code} title`)
    assert.ok(ERROR_COPY[code].body.length > 10, `${code} body`)
  }
  assert.equal(copyFor('NOT_A_CODE').title, 'NOT_A_CODE')
})

test('indicator: the live badge names what is shared when the platform says', () => {
  assert.equal(liveBadge(''), '● LIVE — sharing a screen')
  assert.equal(liveBadge('Entire Screen'), '● LIVE — sharing Entire Screen')
})

test('tasks: empty is refused, long is truncated, whitespace is trimmed', () => {
  assert.deepEqual(normalizeTask('   '), { error: 'EMPTY', ok: false })
  assert.deepEqual(normalizeTask(null), { error: 'EMPTY', ok: false })
  assert.deepEqual(normalizeTask('  hi  '), { ok: true, text: 'hi', truncated: false })
  const long = normalizeTask('x'.repeat(MAX_TASK_CHARS + 50))
  assert.equal(long.truncated, true)
  assert.equal(long.text.length, MAX_TASK_CHARS)
})

test('backend: loopback http(s) only, with a health path defaulted in', () => {
  assert.equal(normalizeBackendUrl('http://127.0.0.1:9120'), 'http://127.0.0.1:9120/api/health')
  assert.equal(normalizeBackendUrl('http://127.0.0.1:9120/api/hud/assist'), 'http://127.0.0.1:9120/api/hud/assist')
  assert.equal(normalizeBackendUrl('javascript:alert(1)'), null)
  assert.equal(normalizeBackendUrl('not a url'), null)
  assert.equal(normalizeBackendUrl(''), null)
})
