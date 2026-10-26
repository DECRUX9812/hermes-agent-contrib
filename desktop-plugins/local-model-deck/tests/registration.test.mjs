/**
 * Registration-shape tests: what the plugin contributes, and with which fields.
 * Fields are compared one at a time — never deepEqual — because the objects come out of a vm
 * realm with its own Object prototype.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadPlugin, textOf } from './_harness.mjs'

function registrations() {
  const ctx = loadPlugin()
  const entries = []
  ctx.plugin.register({ rest: async () => ({}), register: (item) => entries.push(item) })
  return { ctx, entries }
}

test('default export is a well-formed Hermes plugin', () => {
  const { ctx } = registrations()
  const plugin = ctx.plugin
  assert.equal(plugin.id, 'local-model-deck')
  assert.equal(typeof plugin.name, 'string')
  assert.equal(plugin.name, 'Local Model Deck')
  assert.equal(typeof plugin.description, 'string')
  assert.equal(typeof plugin.register, 'function')
})

test('registers exactly three contributions with unique ids', () => {
  const { entries } = registrations()
  assert.equal(entries.length, 3)
  const ids = entries.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length) // unique ids across the plugin
  for (const id of ids) assert.equal(typeof id, 'string')
  assert.equal(ids.includes('pane'), true)
  assert.equal(ids.includes('deck-chip'), true)
  assert.equal(ids.includes('deck-refresh'), true)
})

test('pane visibility is tracked under the host-namespaced pane id', () => {
  // The host scopes contribution ids as `${pluginId}:${id}` (contrib/plugin.ts), and
  // host.paneVisibility() is keyed by that scoped id — so the pane must ask for the same string
  // or it would poll for a pane that does not exist.
  const asked = []
  const ctx = loadPlugin({
    host: {
      notify: () => undefined,
      navigate: () => undefined,
      paneVisibility: (paneId) => {
        asked.push(paneId)
        return { get: () => true, listen: () => () => undefined }
      },
    },
  })
  const entries = []
  ctx.plugin.register({ rest: async () => ({}), register: (item) => entries.push(item) })
  const pane = entries.find((item) => item.id === 'pane')
  textOf(pane.render())
  assert.equal(asked.length, 1)
  assert.equal(asked[0], `local-model-deck:${pane.id}`)
  assert.equal(asked[0], 'local-model-deck:pane')
})

test('every contribution carries an area and a render/run entry point', () => {
  const { entries } = registrations()
  for (const item of entries) {
    assert.equal(typeof item.area, 'string')
    assert.notEqual(item.area.length, 0)
    assert.equal(item.render === undefined || typeof item.render === 'function', true)
  }
})

test('pane contribution: area panes, right placement, 320px', () => {
  const { entries } = registrations()
  const pane = entries.find((item) => item.id === 'pane')
  assert.equal(pane.area, 'panes')
  assert.equal(pane.title, 'Local Model Deck')
  assert.equal(pane.data.placement, 'right')
  assert.equal(pane.data.width, '320px')
  assert.equal(typeof pane.render, 'function')
})

test('status-bar chip: right area constant, numeric order, render fn', () => {
  const { ctx, entries } = registrations()
  const chip = entries.find((item) => item.id === 'deck-chip')
  assert.equal(chip.area, ctx.STATUSBAR_AREAS.right) // 'statusBar.right' in the SDK
  assert.equal(chip.area, 'statusBar.right')
  assert.equal(typeof chip.order, 'number')
  assert.equal(typeof chip.render, 'function')
})

test('palette command: namespaced id, label, keywords, run fn', () => {
  const { entries } = registrations()
  const command = entries.find((item) => item.id === 'deck-refresh')
  assert.equal(command.area, 'palette')
  assert.equal(command.data.id, 'local-model-deck.refresh')
  assert.equal(typeof command.data.label, 'string')
  assert.equal(command.data.label.startsWith('Local Model Deck'), true)
  assert.equal(Array.isArray(command.data.keywords), true)
  assert.equal(command.data.keywords.includes('llama.cpp'), true)
  assert.equal(typeof command.data.run, 'function')
})

test('every render function returns a jsx element without throwing', () => {
  const { entries } = registrations()
  for (const item of entries) {
    if (typeof item.render !== 'function') continue
    const tree = item.render()
    assert.equal(tree && tree.$$el, true, `${item.id} render did not return a jsx element`)
    // Flush one level of component so lazy ReferenceErrors surface here, not in the app.
    const text = textOf(tree).join(' ')
    assert.equal(typeof text, 'string')
  }
})

test('palette command run() does not throw with a stubbed host', () => {
  const { entries } = registrations()
  const command = entries.find((item) => item.id === 'deck-refresh')
  command.data.run()
})

test('chip renders an honest unknown state before any sample arrives', () => {
  const { entries } = registrations()
  const chip = entries.find((item) => item.id === 'deck-chip')
  const text = textOf(chip.render()).join(' ')
  assert.equal(text.includes('deck ?'), true) // no data yet: never claims ok/down
})
