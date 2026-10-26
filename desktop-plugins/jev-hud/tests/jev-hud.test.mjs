/**
 * jev-hud — registration shape + pure logic.
 *
 * Run: node --test ~/.hermes/desktop-plugins/jev-hud/tests/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { loadPlugin, register } from './harness.mjs'

const runtime = loadPlugin()
const plugin = runtime.plugin
const hud = runtime.__hud

/* ---------------------------------------------------------------- registration */

test('default export is a HermesPlugin whose id matches the folder', () => {
  assert.equal(plugin.id, 'jev-hud')
  assert.equal(plugin.name, 'Jev HUD')
  assert.equal(typeof plugin.register, 'function')
})

test('registers exactly a pane, a status-bar chip and a palette command', () => {
  const entries = register(plugin)
  assert.equal(entries.length, 3)

  const ids = entries.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'contribution ids must be unique')
  assert.deepEqual(ids.slice().sort(), ['hud-chip', 'hud-pane', 'hud-refresh'])
})

test('the pane lands on the right rail at 300px and renders lazily', () => {
  const pane = register(plugin).find((e) => e.id === 'hud-pane')
  assert.equal(pane.area, 'panes')
  assert.equal(pane.title, 'Jev HUD')
  assert.equal(pane.data.placement, 'right')
  assert.equal(pane.data.width, '300px')
  assert.equal(typeof pane.render, 'function') // lazy: never called by the registry
})

test('the status-bar chip is a right-cluster item with an order', () => {
  const chip = register(plugin).find((e) => e.id === 'hud-chip')
  assert.equal(chip.area, 'statusbar.right')
  assert.equal(typeof chip.order, 'number')
  assert.equal(typeof chip.render, 'function')
})

test('the palette command carries an id, label, keywords and a run handler', () => {
  const command = register(plugin).find((e) => e.id === 'hud-refresh')
  assert.equal(command.area, 'palette')
  assert.equal(command.data.id, 'jev-hud.refresh')
  assert.match(command.data.label, /Jev HUD/)
  assert.equal(typeof command.data.run, 'function')
  assert.ok(command.data.keywords.join('|').includes('ledger'))
  command.data.run() // must not throw outside React
})

test('every ctx.rest call is made through the register-time capture, never at import time', async () => {
  const calls = []
  const entries = register(plugin, { rest: (path, opts) => (calls.push([path, opts]), Promise.resolve({ ok: true, rows: [] })) })
  assert.equal(calls.length, 0, 'register() itself must not hit the backend')
  assert.equal(entries.length, 3)
})

/* ---------------------------------------------------------------- pure logic */

test('pct renders a real confidence and refuses to invent one', () => {
  assert.equal(hud.pct(0.6532), '65%')
  assert.equal(hud.pct(0), '0%')
  assert.equal(hud.pct(1), '100%')
  assert.equal(hud.pct(null), '—')
  assert.equal(hud.pct(undefined), '—')
  assert.equal(hud.pct('0.9'), '—', 'a string is not a number we can vouch for')
})

test('fmtAge is compact and honest about undated rows', () => {
  const now = 1789903438000
  assert.equal(hud.fmtAge(now / 1000 - 12, now), '12s')
  assert.equal(hud.fmtAge(now / 1000 - 240, now), '4m')
  assert.equal(hud.fmtAge(now / 1000 - 7200, now), '2h')
  assert.equal(hud.fmtAge(now / 1000 - 3 * 86400, now), '3d')
  assert.equal(hud.fmtAge(now / 1000 + 500, now), '0s', 'clock skew never renders as negative')
  assert.equal(hud.fmtAge(null, now), '—')
  assert.equal(hud.ageSeconds('nope', now), null)
})

test('verdictTone colours by meaning, never by hex', () => {
  assert.equal(hud.verdictTone('no'), 'text-rose-500')
  assert.equal(hud.verdictTone('skip'), 'text-rose-500')
  assert.equal(hud.verdictTone('yes'), 'text-emerald-500')
  assert.equal(hud.verdictTone('take_small'), 'text-emerald-500')
  assert.equal(hud.verdictTone('handoff'), 'text-amber-500')
  assert.equal(hud.verdictTone('Receipts'), 'text-[var(--foreground)]')
  assert.equal(hud.verdictTone(''), 'text-[var(--muted-foreground)]')
})

test('shortVerdict truncates for a 300px pane and labels a missing verdict', () => {
  assert.equal(hud.shortVerdict('wait'), 'wait')
  assert.equal(hud.shortVerdict('lint, unit tests +1'), 'lint, unit tests +1')
  assert.equal(hud.shortVerdict('x'.repeat(60)).length, 38)
  assert.ok(hud.shortVerdict('x'.repeat(60)).endsWith('…'))
  assert.equal(hud.shortVerdict(''), 'no verdict recorded')
  assert.equal(hud.shortVerdict(null), 'no verdict recorded')
})

test('classifyRestError separates "not mounted" from a real backend error', () => {
  const notMounted = hud.classifyRestError(Object.assign(new Error('Request failed'), { status: 404 }))
  assert.equal(notMounted.kind, 'not_mounted')
  assert.equal(hud.classifyRestError(new Error('404 Not Found')).kind, 'not_mounted')
  assert.equal(hud.classifyRestError(new Error('fetch failed')).kind, 'error')
  assert.equal(hud.classifyRestError(new Error('fetch failed')).detail, 'fetch failed')
  assert.equal(hud.classifyRestError(undefined).detail, 'no detail from the bridge')
})

test('classifyPayload only calls a payload usable when it actually carries rows', () => {
  assert.equal(hud.classifyPayload(undefined).state, 'malformed')
  assert.equal(hud.classifyPayload({ ok: true, rows: [], notes: ['oracle ledger not found'] }).state, 'empty')
  assert.equal(hud.classifyPayload({ ok: true, rows: [{ id: 'oracle:1' }] }).state, 'ok')
  assert.equal(hud.classifyPayload({ ok: false, rows: [] }).state, 'malformed')
  assert.equal(hud.classifyPayload({ ok: true, rows: [{ id: 'oracle:1' }] }).rows.length, 1)
})

test('sourceLine / verdictLine summarise only what the ledger reported', () => {
  assert.equal(hud.sourceLine({ oracle: 40, trading: 4 }), 'oracle 40 · trading 4')
  assert.equal(hud.sourceLine(null), '')
  assert.equal(hud.verdictLine({ no: 3, handoff: 10 }), 'handoff 10 · no 3')
  assert.equal(hud.verdictLine(null), '')
  assert.match(hud.verdictLine({ a: 1, b: 1, c: 1, d: 1, e: 1 }, 2), /\+3 more/)
  // a sentence-length verdict (the real ledger has them) must not blow out the 300px header
  const long = hud.verdictLine({ 'This needs a human decision; ask the user directly.': 3, wait: 1 })
  assert.ok(long.length < 32, long)
  assert.ok(long.endsWith('… 3 · wait 1'), long)
})
