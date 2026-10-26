/**
 * Pure-helper tests. The payload fixtures under tests/fixtures/*.live.json are VERBATIM
 * captures from this box's llama-server (and from the plugin backend probing it), so the
 * mapping is tested against what the runtime really sends.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fixture, loadPlugin } from './_harness.mjs'

const runtimesLive = fixture('runtimes.live.json')
const processLive = fixture('process.live.json')
const liveRow = runtimesLive.runtimes[0]
const METRICS_OFF = 'metrics disabled on this server (start with --metrics for tok/s)'

test('fmtBytes: bytes to human units', () => {
  const ctx = loadPlugin()
  assert.equal(ctx.__fmtBytes(5935527936), '5.5 GB') // the live weights file
  assert.equal(ctx.__fmtBytes(1024), '1.0 KB')
  assert.equal(ctx.__fmtBytes(512), '512 B')
  assert.equal(ctx.__fmtBytes(1536), '1.5 KB')
  assert.equal(ctx.__fmtBytes(0), '—')
  assert.equal(ctx.__fmtBytes(null), '—')
  assert.equal(ctx.__fmtBytes(undefined), '—')
  assert.equal(ctx.__fmtBytes('nope'), '—')
})

test('fmtCount / fmtCtx / fmtRss / fmtUptime', () => {
  const ctx = loadPlugin()
  assert.equal(ctx.__fmtCount(26895998464), '26.9B')
  assert.equal(ctx.__fmtCount(1500000), '1.5M')
  assert.equal(ctx.__fmtCount(2048), '2k')
  assert.equal(ctx.__fmtCount(0), '—')

  assert.equal(ctx.__fmtCtx(32768), '32k')
  assert.equal(ctx.__fmtCtx(4096), '4k')
  assert.equal(ctx.__fmtCtx(1234), '1234')
  assert.equal(ctx.__fmtCtx(null), '—')

  assert.equal(ctx.__fmtRss(1602.6), '1.6 GB') // the live RSS
  assert.equal(ctx.__fmtRss(812.4), '812 MB')
  assert.equal(ctx.__fmtRss(0), '—')

  assert.equal(ctx.__fmtUptime(23308.3), '6h 28m') // the live uptime
  assert.equal(ctx.__fmtUptime(90), '1m 30s')
  assert.equal(ctx.__fmtUptime(30), '30s')
  assert.equal(ctx.__fmtUptime(2 * 86400 + 3600), '2d 1h')
  assert.equal(ctx.__fmtUptime(null), null)
  assert.equal(ctx.__fmtUptime(-5), null)
})

test('fmtClock renders HH:MM:SS and refuses junk', () => {
  const ctx = loadPlugin()
  assert.match(ctx.__fmtClock(runtimesLive.ts), /^\d{2}:\d{2}:\d{2}$/)
  assert.equal(ctx.__fmtClock(0), null)
  assert.equal(ctx.__fmtClock(null), null)
  assert.equal(ctx.__fmtClock('x'), null)
})

test('modelFromCmdline extracts the -m basename, never the --mmproj', () => {
  const ctx = loadPlugin()
  const cmdline = processLive.cmdline
  assert.equal(ctx.__modelFromCmdline(cmdline), 'Ternary-Bonsai-2-27B-PTQ1_0.gguf')
  assert.equal(ctx.__modelFromCmdline('llama-server --mmproj /x/mm.gguf --port 8085'), null)
  assert.equal(ctx.__modelFromCmdline('vllm serve --model=/a/b.gguf'), 'b.gguf')
  assert.equal(ctx.__modelFromCmdline(''), null)
  assert.equal(ctx.__modelFromCmdline(null), null)
})

test('modelFromProps / nCtxFromProps / totalSlotsFromProps', () => {
  const ctx = loadPlugin()
  assert.equal(ctx.__modelFromProps({ model_alias: '/a/b.gguf' }), '/a/b.gguf')
  assert.equal(ctx.__modelFromProps({ model_path: '/a/c.gguf' }), '/a/c.gguf')
  assert.equal(ctx.__modelFromProps({}), null)
  assert.equal(ctx.__nCtxFromProps({ default_generation_settings: { n_ctx: 32768 } }), 32768)
  assert.equal(ctx.__nCtxFromProps({ n_ctx: 4096 }), 4096)
  assert.equal(ctx.__nCtxFromProps({ default_generation_settings: { n_ctx: 0 } }), null)
  assert.equal(ctx.__totalSlotsFromProps({ total_slots: 1 }), 1)
  assert.equal(ctx.__totalSlotsFromProps({}), null)
})

test('slotsSummary accepts the backend summary object AND a raw /slots list', () => {
  const ctx = loadPlugin()
  // The backend's shape (this is what the pane receives in production) — from the live capture.
  const summary = ctx.__slotsSummary(liveRow.slots, null)
  assert.equal(summary.total, 1)
  assert.equal(summary.busy, 0)
  assert.equal(summary.idle, 1)
  // A raw llama.cpp /slots list still works (mixed, synthetic)
  const raw = ctx.__slotsSummary([{ is_processing: true }, { is_processing: false }], 2)
  assert.equal(raw.total, 2)
  assert.equal(raw.busy, 1)
  assert.equal(raw.idle, 1)
  // Unmeasured busy stays unknown in both shapes — never 0
  const unknown = ctx.__slotsSummary({ total: 4, busy: null, idle: null }, null)
  assert.equal(unknown.total, 4)
  assert.equal(unknown.busy, null)
  assert.equal(unknown.idle, null)
  const none = ctx.__slotsSummary(null, 4)
  assert.equal(none.total, 4)
  assert.equal(none.busy, null)
  assert.equal(none.idle, null)
  const nothing = ctx.__slotsSummary(undefined, null)
  assert.equal(nothing.total, null)
  assert.equal(nothing.busy, null)
})

test('runtimeRow keeps unknown ports and slots out of the numbers', () => {
  const ctx = loadPlugin()
  const bare = ctx.__runtimeRow({ id: 'x' })
  assert.equal(bare.port, null)
  assert.equal(bare.nCtxRaw, null)
  assert.equal(bare.slotsText, '—')
  assert.equal(bare.probeMs, null)
  const partial = ctx.__runtimeRow({ id: 'x', slots: { total: 2, busy: null } })
  assert.equal(partial.slotsText, '?/2')
})

test('runtimeRow maps the REAL live /runtimes payload', () => {
  const ctx = loadPlugin()
  const row = ctx.__runtimeRow(liveRow)
  assert.equal(row.id, 'bonsai')
  assert.equal(row.short, 'bonsai')
  assert.equal(row.label, 'Ternary Bonsai 2 27B')
  assert.equal(row.up, true)
  assert.equal(row.health, 'ok')
  assert.equal(row.modelFile, 'Ternary-Bonsai-2-27B-PTQ1_0.gguf')
  assert.equal(row.ftype, 'PTQ1_0 - 1.75 bpw ternary (group 128)')
  assert.equal(row.nCtx, '32k')
  assert.equal(row.nCtxRaw, 32768)
  assert.equal(row.slotsTotal, 1)
  assert.equal(row.slotsBusy, 0)
  assert.equal(row.slotsText, '0/1')
  assert.equal(row.sizeText, '5.5 GB')
  assert.equal(row.paramsText, '26.9B')
  assert.equal(row.sizeHint, '5.5 GB')
  assert.equal(row.port, 8085)
  assert.equal(row.probeMs, liveRow.probe_ms)
  assert.equal(row.error, null)
  // metrics: the live server answered 501 — the row must say so and carry the server's words
  assert.equal(row.metrics.on, false)
  assert.equal(row.metrics.note, METRICS_OFF)
  assert.equal(row.metrics.raw, liveRow.metrics_note)
  assert.equal(row.metrics.raw.includes('--metrics'), true)
})

test('runtimeRow stays honest for a down runtime and for a metrics-on runtime', () => {
  const ctx = loadPlugin()
  const down = ctx.__runtimeRow({ id: 'bonsai', up: false, error: 'connection refused', slots: {} })
  assert.equal(down.up, false)
  assert.equal(down.modelFile, null)
  assert.equal(down.slotsText, '—')
  assert.equal(down.slotsBusy, null)
  assert.equal(down.sizeText, '—')
  assert.equal(down.sizeHint, '')
  assert.equal(down.metrics.on, false)
  assert.equal(down.error, 'connection refused')

  const on = ctx.__runtimeRow({ id: 'x', up: true, metrics_enabled: true, metrics_status: 200 })
  assert.equal(on.metrics.on, true)
  assert.equal(on.metrics.note, 'tok/s available from /metrics')
  assert.equal(on.metrics.raw, null)

  const silent = ctx.__runtimeRow({ id: 'x', up: true, metrics_enabled: false })
  assert.equal(silent.metrics.on, false) // undefined/absent metrics is OFF, never assumed on
  assert.equal(silent.metrics.note, METRICS_OFF)
})

test('processRow maps the REAL live /process payload', () => {
  const ctx = loadPlugin()
  const row = ctx.__processRow(processLive)
  assert.equal(row.found, true)
  assert.equal(row.pidText, `pid ${processLive.pid}`)
  assert.equal(row.rssText, '1.6 GB')
  assert.equal(row.uptimeText, '6h 28m')
  assert.match(row.startedText, /^\d{2}:\d{2}:\d{2}$/)
  assert.equal(row.cmdline.includes('llama-server'), true)
  assert.equal(row.note, null)
})

test('processRow degrades honestly when the pid is unknown', () => {
  const ctx = loadPlugin()
  const missing = ctx.__processRow({ found: false, note: 'no listener found on port 8085' })
  assert.equal(missing.found, false)
  assert.equal(missing.pidText, '—')
  assert.equal(missing.rssText, '—')
  assert.equal(missing.uptimeText, null)
  assert.equal(missing.note, 'no listener found on port 8085')
  const empty = ctx.__processRow(null)
  assert.equal(empty.note, 'no listener process found for this port')
})

test('deckStatus: chip text, hint and tone from a live payload', () => {
  const ctx = loadPlugin()
  const up = ctx.__deckStatus(runtimesLive)
  assert.equal(up.text, 'bonsai ok')
  assert.equal(up.hint, '5.5 GB')
  assert.equal(up.tone, 'ok')

  const down = ctx.__deckStatus({ runtimes: [{ id: 'bonsai', up: false, error: 'connection refused' }] })
  assert.equal(down.text, 'bonsai down')
  assert.equal(down.hint, 'connection refused')
  assert.equal(down.tone, 'down')

  const two = ctx.__deckStatus({ runtimes: [liveRow, { id: 'other', up: true }] })
  assert.equal(two.text, 'bonsai ok +1')

  const none = ctx.__deckStatus(null)
  assert.equal(none.text, 'deck ?')
  assert.equal(none.tone, 'unknown')
})

test('backendState tells not-mounted apart from unreachable', () => {
  const ctx = loadPlugin()
  const notMounted = ctx.__backendState(new Error('Request failed: 404 not found'))
  assert.equal(notMounted.kind, 'not-mounted')
  assert.equal(notMounted.title, 'backend not mounted yet')
  assert.equal(notMounted.detail.includes('404'), true)
  assert.equal(notMounted.hint.includes('restart the backend'), true)

  const unreachable = ctx.__backendState(new Error('fetch failed'))
  assert.equal(unreachable.kind, 'unreachable')
  assert.equal(unreachable.title, 'backend unreachable')

  assert.equal(ctx.__backendState(null), null)
  assert.equal(ctx.__errorText(null), 'no error detail')
})

test('shortId and baseName behave for odd inputs', () => {
  const ctx = loadPlugin()
  assert.equal(ctx.__shortId('Bonsai'), 'bonsai')
  assert.equal(ctx.__shortId('host:8085'), 'host')
  assert.equal(ctx.__shortId(null), 'runtime')
  assert.equal(ctx.__baseName('/a/b/c.gguf'), 'c.gguf')
  assert.equal(ctx.__baseName('c.gguf'), 'c.gguf')
  assert.equal(ctx.__baseName(''), null)
})
