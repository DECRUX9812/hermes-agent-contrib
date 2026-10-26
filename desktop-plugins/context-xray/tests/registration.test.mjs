/**
 * Registration + render-smoke tests for context-xray.
 *
 * Asserts the contribution shape the desktop app relies on (pane in 'panes',
 * chip in statusbar.right, unique ids) and — because the smoke harness runs the
 * real render functions — that both surfaces survive a render with no session,
 * with a measured breakdown, with an estimate and with a dead RPC.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { makeRuntime, sampleBreakdown, sampleHistory, text } from './_harness.mjs'

const SOURCE = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

test('source styles through theme variables only — no literal colours, no palette classes', () => {
  assert.doesNotMatch(SOURCE, /#[0-9a-fA-F]{3,8}\b/, 'hex colour literal in plugin.js')
  assert.doesNotMatch(SOURCE, /\brgba?\(|\bhsla?\(/, 'rgb()/hsl() colour in plugin.js')
  assert.doesNotMatch(
    SOURCE,
    /\b(?:text|bg|border|ring|from|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    'hardcoded Tailwind palette class in plugin.js',
  )
  assert.match(SOURCE, /var\(--context-usage-/) // category colours come from the app's theme vars
})

function paneOf(contributions) {
  return contributions.find((item) => item.area === 'panes')
}
function chipOf(contributions) {
  return contributions.find((item) => String(item.area || '').indexOf('statusbar') === 0)
}

test('default export is a valid HermesPlugin for this folder', () => {
  const rt = makeRuntime()
  assert.equal(rt.plugin.id, 'context-xray')
  assert.equal(typeof rt.plugin.register, 'function')
  assert.equal(typeof rt.plugin.name, 'string')
  assert.equal(typeof rt.plugin.description, 'string')
})

test('register() contributes exactly a pane and a status-bar chip, with unique ids', () => {
  const rt = makeRuntime()
  const contributions = rt.register()

  assert.equal(contributions.length, 2)
  const ids = contributions.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length) // unique across everything registered

  const pane = paneOf(contributions)
  assert.ok(pane, 'a pane contribution in area panes')
  assert.equal(pane.id, 'ctx-pane')
  assert.equal(pane.area, 'panes')
  assert.equal(pane.title, 'Context X-Ray')
  assert.equal(pane.data.placement, 'right')
  assert.equal(pane.data.width, '340px')
  assert.equal(typeof pane.render, 'function')

  const chip = chipOf(contributions)
  assert.ok(chip, 'a chip contribution in the status bar')
  assert.equal(chip.id, 'ctx-chip')
  assert.equal(chip.area, 'statusbar.right')
  assert.equal(chip.order, 42)
  assert.equal(typeof chip.render, 'function')
})

test('register() is re-entrant and touches no ctx surface beyond register()', () => {
  const rt = makeRuntime()
  rt.register()
  const again = rt.register()
  assert.equal(again.length, 4) // one pane + one chip per call, nothing else
  assert.equal(again[2].id, 'ctx-pane')
  assert.equal(again[3].id, 'ctx-chip')
})

test('pane renders the honest no-session state (no fabricated numbers)', () => {
  const rt = makeRuntime({ sessionId: null })
  const [pane] = rt.register()
  const tree = pane.render()
  const out = text(tree)

  assert.match(out, /Context X-Ray/)
  assert.match(out, /no active session/)
  assert.doesNotMatch(out, /used /) // nothing to report → no numbers at all
  assert.doesNotMatch(out, /\d+%/)
})

test('chip renders "ctx —" with no active session', () => {
  const rt = makeRuntime({ sessionId: null })
  const [, chip] = rt.register()
  const out = text(chip.render())
  assert.match(out, /ctx —/)
})

test('chip renders the live streamed percentage when host.state.focusedUsage has one', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', liveUsage: { context_max: 200000, context_used: 126000, context_percent: 63 } })
  const [, chip] = rt.register()
  const out = text(chip.render())
  assert.match(out, /ctx 63%/)
  assert.doesNotMatch(out, /~/) // provider usage is measured: no tilde
})

test('chip marks a streamed ESTIMATE with a tilde', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', liveUsage: { context_max: 200000, context_used: 126000, context_estimated: true } })
  const [, chip] = rt.register()
  assert.match(text(chip.render()), /ctx ~63%/)
})

test('chip falls back to session.context_breakdown when the live atom is empty', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', data: { breakdown: sampleBreakdown() } })
  const [, chip] = rt.register()
  assert.match(text(chip.render()), /ctx 21%/)
})

test('pane renders measured numbers, the split and the top contributors', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', data: { breakdown: sampleBreakdown(), history: sampleHistory() } })
  const [pane] = rt.register()
  const out = text(pane.render())

  assert.match(out, /used/)
  assert.match(out, /42k/) // 42300 compacted
  assert.match(out, /window/)
  assert.match(out, /200k/)
  assert.match(out, /21%/)
  assert.match(out, /measured/)
  assert.match(out, /System prompt/)
  assert.match(out, /Tool definitions/)
  assert.match(out, /21k/) // tool definitions
  assert.match(out, /top contributors/)
  assert.match(out, /50%/) // tool_definitions share of 42300
  assert.match(out, /display transcript/) // the estimate caveat is on screen
})

test('pane renders the estimated badge and tildes for a server-side estimate', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', data: { breakdown: sampleBreakdown({ context_estimated: true, context_source: 'estimate' }) } })
  const [pane] = rt.register()
  const out = text(pane.render())

  assert.match(out, /estimated/)
  assert.match(out, /~42k/)
  assert.match(out, /chars\/4/)
  assert.doesNotMatch(out, /measured/)
})

test('pane renders a derived estimate (no categories) with its method stated', () => {
  const rt = makeRuntime({
    sessionId: 'runtime-1',
    data: {
      breakdown: { categories: [], context_max: 200000, context_used: 0, context_estimated: false, context_source: 'provider_usage' },
      history: sampleHistory(),
    },
  })
  const [pane] = rt.register()
  const out = text(pane.render())

  assert.match(out, /estimated · chars\/4/)
  assert.match(out, /Conversation \(transcript rows\)/)
  assert.match(out, /display projection/)
  assert.match(out, /tool output/)
})

test('pane reports "usage unavailable" instead of inventing a breakdown', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', data: { breakdown: null, history: null } })
  const [pane] = rt.register()
  const out = text(pane.render())

  assert.match(out, /usage unavailable for this session/)
  assert.doesNotMatch(out, /top contributors/)
})

test('pane surfaces RPC failures as text, not as a silent blank pane', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', errors: { breakdown: new Error('session not found'), history: new Error('session not found') } })
  const [pane] = rt.register()
  const out = text(pane.render())

  assert.match(out, /rpc: session not found/)
  assert.match(out, /usage unavailable for this session/)
})

test('both surfaces render when the desktop build has no host.paneVisibility', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', paneVisibility: false, data: { breakdown: sampleBreakdown() } })
  const [pane, chip] = rt.register()
  assert.match(text(pane.render()), /Context X-Ray/)
  assert.match(text(chip.render()), /ctx 21%/)
})

test('render is repeatable (no state leaks between paints)', () => {
  const rt = makeRuntime({ sessionId: 'runtime-1', data: { breakdown: sampleBreakdown() } })
  const [pane] = rt.register()
  const first = text(pane.render())
  const second = text(pane.render())
  assert.equal(first, second)
})
