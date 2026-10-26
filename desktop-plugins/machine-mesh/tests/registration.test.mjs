/**
 * Registration-shape tests for machine-mesh.
 *
 * The plugin is loaded in a node:vm sandbox with the SDK/React imports stripped (see the
 * hermes-desktop-plugin-testing skill), then register() is called with a stub ctx and every
 * contribution is asserted FIELD BY FIELD — never deepEqual across vm realms.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function runtime({ withPaneVisibility = true } = {}) {
  const jsx = (type, props = {}) => ({ type, props })
  const visibilityCalls = []
  const host = {
    request: async () => ({}),
    onEvent: () => () => {},
    navigate: () => {},
    state: {},
  }
  if (withPaneVisibility) {
    host.paneVisibility = (paneId) => {
      visibilityCalls.push(paneId)
      return { get: () => true, subscribe: () => () => {} }
    }
  }
  const context = {
    jsx,
    jsxs: jsx,
    host,
    PALETTE_AREA: 'palette',
    STATUSBAR_AREAS: { left: 'statusbar.left', right: 'statusbar.right' },
    queryClient: { invalidateQueries: () => {} },
    useQuery: () => ({ data: null, isLoading: false, isError: false, error: null, isFetching: false }),
    useValue: (atomValue) => (atomValue && atomValue.get ? atomValue.get() : null),
    useCallback: (fn) => fn,
    __visibilityCalls: visibilityCalls,
  }
  const code = source
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
  vm.runInNewContext(code, context)
  return context
}

function registered(options) {
  const r = runtime(options)
  const entries = []
  r.plugin.register({ rest: () => Promise.resolve({}), register: (item) => entries.push(item) })
  return { r, entries }
}

test('default export is a valid plugin', () => {
  const r = runtime()
  assert.equal(r.plugin.id, 'machine-mesh')
  assert.equal(r.plugin.name, 'Machine Mesh')
  assert.equal(typeof r.plugin.description, 'string')
  assert.equal(typeof r.plugin.register, 'function')
})

test('registers three contributions with unique ids', () => {
  const { entries } = registered()
  assert.equal(entries.length, 3)
  const ids = entries.map((e) => e.id)
  assert.deepEqual(ids, ['mesh-pane', 'mesh-chip', 'mesh-refresh'])
  assert.equal(new Set(ids).size, ids.length)
  for (const entry of entries) assert.equal(typeof entry.area, 'string')
})

test('pane is registered right-side at 340px', () => {
  const { entries } = registered()
  const pane = entries.find((e) => e.id === 'mesh-pane')
  assert.equal(pane.area, 'panes')
  assert.equal(pane.title, 'Machine Mesh')
  assert.equal(pane.data.placement, 'right')
  assert.equal(pane.data.width, '340px')
  assert.equal(typeof pane.render, 'function')
})

test('status-bar chip is registered on the right with an order', () => {
  const { entries } = registered()
  const chip = entries.find((e) => e.id === 'mesh-chip')
  assert.equal(chip.area, 'statusbar.right')
  assert.equal(typeof chip.order, 'number')
  assert.equal(typeof chip.render, 'function')
})

test('palette command carries an id, label, keywords and a run function', () => {
  const { entries } = registered()
  const command = entries.find((e) => e.id === 'mesh-refresh')
  assert.equal(command.area, 'palette')
  assert.equal(command.data.id, 'machine-mesh.refresh')
  assert.match(command.data.label, /Machine Mesh/)
  assert.ok(Array.isArray(command.data.keywords))
  assert.ok(command.data.keywords.includes('tailscale'))
  assert.equal(typeof command.data.run, 'function')
  // A palette command must not throw when the query client refuses.
  command.data.run()
})

test('register binds host.paneVisibility to the scoped pane id', () => {
  const { r } = registered()
  assert.deepEqual(r.__visibilityCalls, ['machine-mesh:pane'])
})

test('register survives a host without paneVisibility (older desktop)', () => {
  const { entries } = registered({ withPaneVisibility: false })
  assert.equal(entries.length, 3)
  assert.equal(typeof entries[0].render, 'function')
})

test('every render function runs without data (degraded state, no crash)', () => {
  const { entries } = registered()
  for (const entry of entries) {
    if (typeof entry.render !== 'function') continue
    const tree = entry.render()
    assert.ok(tree && typeof tree === 'object', `${entry.id} render returned nothing`)
  }
})
