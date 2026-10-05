/**
 * Unit tests for the pure 3D-Pane helpers: where the pane window sits, the
 * renderer URL it loads, and which click-through strategy its platform uses.
 * All are side-effect-free so the live spawn path in pane3d-window.ts stays a
 * thin application of these decisions (architecture §5/§6).
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import { paneClickThroughStrategy, paneUrl, resolvePaneBounds } from './pane3d'

const display = (workArea: { x: number; y: number; width: number; height: number }) => ({ workArea })

const primary = display({ x: 0, y: 0, width: 1920, height: 1080 })
const secondary = display({ x: 1920, y: 0, width: 1280, height: 1024 })

test('paneUrl puts ?win=pane3d before the hash for the dev server', () => {
  const url = paneUrl('http://127.0.0.1:5174')

  assert.equal(url, 'http://127.0.0.1:5174/?win=pane3d#/')
  // The route hash must come last: loadWindowUrl relies on it surviving.
  assert.ok(url.indexOf('?win=pane3d') < url.indexOf('#/'))
})

test('paneUrl tolerates a trailing slash on the dev server', () => {
  assert.equal(paneUrl('http://127.0.0.1:5174/'), 'http://127.0.0.1:5174/?win=pane3d#/')
})

test('paneUrl appends the query directly to a file URL', () => {
  const url = paneUrl('file:///opt/hermes/dist/index.html')

  assert.equal(url, 'file:///opt/hermes/dist/index.html?win=pane3d#/')
  assert.ok(url.indexOf('?win=pane3d') < url.indexOf('#/'))
})

test('paneUrl drops any stale query/hash on the base', () => {
  assert.equal(paneUrl('http://127.0.0.1:5174/?win=hud#/x'), 'http://127.0.0.1:5174/?win=pane3d#/')
})

test('resolvePaneBounds uses the workArea of the display containing the anchor', () => {
  const anchor = { x: 2000, y: 100, width: 800, height: 600 }

  assert.deepEqual(resolvePaneBounds([primary, secondary], anchor, primary), {
    x: 1920,
    y: 0,
    width: 1280,
    height: 1024
  })
})

test('resolvePaneBounds falls back to the primary display when the anchor is elsewhere', () => {
  const anchor = { x: 5000, y: 5000, width: 100, height: 100 }

  assert.deepEqual(resolvePaneBounds([secondary, primary], anchor, primary), {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080
  })
})

test('resolvePaneBounds falls back to the first usable display with no primary or anchor', () => {
  assert.deepEqual(resolvePaneBounds([secondary, primary], null, null), {
    x: 1920,
    y: 0,
    width: 1280,
    height: 1024
  })
})

test('resolvePaneBounds rounds a fractional work area to integers', () => {
  const fractional = display({ x: 0.4, y: 0.6, width: 1919.6, height: 1079.4 })

  assert.deepEqual(resolvePaneBounds([fractional], null, fractional), { x: 0, y: 1, width: 1920, height: 1079 })
})

test('resolvePaneBounds returns null when there is no display work area', () => {
  assert.equal(resolvePaneBounds([], null, null), null)
  assert.equal(resolvePaneBounds([{ workArea: undefined }], null, null), null)
  assert.equal(resolvePaneBounds(null, null, null), null)
})

test('click-through strategy is setShape on linux and forward elsewhere', () => {
  assert.equal(paneClickThroughStrategy('linux'), 'shape')
  assert.equal(paneClickThroughStrategy('darwin'), 'forward')
  assert.equal(paneClickThroughStrategy('win32'), 'forward')
})
