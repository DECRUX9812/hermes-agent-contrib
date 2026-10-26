/**
 * Pure-logic tests for context-xray: number formatting, share math, the chars/4
 * estimator (incl. empty/zero edges), top-N selection, window resolution, the
 * honesty-graded view model, the status-bar label and the refresh bus.
 *
 * Everything here runs against the module loaded in a node:vm sandbox, so these
 * are the REAL functions the pane calls. Fields are compared explicitly — never
 * deepEqual against a host literal (vm realms have their own prototypes).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { makeRuntime, sampleBreakdown, sampleHistory } from './_harness.mjs'

const rt = makeRuntime()
const P = rt.pure

test('module loads in the sandbox and exports the internals under test', () => {
  assert.equal(typeof P.buildContextView, 'function')
  assert.equal(typeof P.estimateTokensFromText, 'function')
  assert.equal(P.CHARS_PER_TOKEN, 4)
  assert.equal(P.TOP_N, 5)
  assert.equal(P.ID, 'context-xray')
  assert.equal(P.PANE_REF, 'context-xray:ctx-pane')
})

/* ── formatting ─────────────────────────────────────────────────────────── */

test('fmtTokens: compact readout, honest dashes for unusable input', () => {
  assert.equal(P.fmtTokens(0), '0')
  assert.equal(P.fmtTokens(940), '940')
  assert.equal(P.fmtTokens(1500), '1.5k')
  assert.equal(P.fmtTokens(41200), '41k')
  assert.equal(P.fmtTokens(1250000), '1.3M')
  assert.equal(P.fmtTokens(null), '—')
  assert.equal(P.fmtTokens(undefined), '—')
  assert.equal(P.fmtTokens(NaN), '—')
  assert.equal(P.fmtTokens('nope'), '—')
})

test('sharePct: share of a total, 0 when the total is unusable', () => {
  assert.equal(P.sharePct(1, 3), 33.3)
  assert.equal(P.sharePct(50, 200), 25)
  assert.equal(P.sharePct(42300, 42300), 100)
  assert.equal(P.sharePct(5, 0), 0)
  assert.equal(P.sharePct(0, 10), 0)
  assert.equal(P.sharePct(-5, 10), 0)
  assert.equal(P.sharePct('x', 10), 0)
  assert.equal(P.sharePct(10, 'x'), 0)
})

test('shareLabel: whole percents above 10, one decimal below', () => {
  assert.equal(P.shareLabel(33.3), '33%')
  assert.equal(P.shareLabel(4.2), '4.2%')
  assert.equal(P.shareLabel(0), '0%')
  assert.equal(P.shareLabel(NaN), '0%')
})

test('clampPct: whole percent inside 0..100, garbage is 0', () => {
  assert.equal(P.clampPct(105), 100)
  assert.equal(P.clampPct(-3), 0)
  assert.equal(P.clampPct(63.4), 63)
  assert.equal(P.clampPct('x'), 0)
  assert.equal(P.clampPct(null), 0)
})

/* ── the chars/4 estimator ──────────────────────────────────────────────── */

test('utf8Bytes: real UTF-8 byte counts without TextEncoder', () => {
  assert.equal(P.utf8Bytes(''), 0)
  assert.equal(P.utf8Bytes('abc'), 3)
  assert.equal(P.utf8Bytes('é'), 2)
  assert.equal(P.utf8Bytes('€'), 3)
  assert.equal(P.utf8Bytes('😀'), 4) // surrogate pair
  assert.equal(P.utf8Bytes('\ud83d'), 3) // lone high surrogate → replacement char
  assert.equal(P.utf8Bytes(null), 0)
})

test('estimateTokensFromText: 4 chars/token, CJK dense, zero/empty edges', () => {
  assert.equal(P.estimateTokensFromText(''), 0)
  assert.equal(P.estimateTokensFromText(null), 0)
  assert.equal(P.estimateTokensFromText(undefined), 0)
  assert.equal(P.estimateTokensFromText(0), 1) // a number coerces to text: '0' is one character
  assert.equal(P.estimateTokensFromText(false), 2) // 'false' → 5 chars → 2 tokens
  assert.equal(P.estimateTokensFromText('a'), 1) // ceiling keeps short text from estimating 0
  assert.equal(P.estimateTokensFromText('abcd'), 1)
  assert.equal(P.estimateTokensFromText('abcde'), 2)
  assert.equal(P.estimateTokensFromText('a'.repeat(4000)), 1000)
  assert.equal(P.estimateTokensFromText('一二三'), 3) // CJK ≈ 1 token each
  assert.equal(P.estimateTokensFromText('a一'), 2) // mixed
  assert.equal(P.estimateTokensFromText('é'.repeat(4)), 2) // 8 bytes / 4
})

test('historyRowMeasure: text + context + args, nothing invented for empty rows', () => {
  const full = P.historyRowMeasure({ role: 'tool', text: 'z'.repeat(800), context: 'c'.repeat(40), args: { command: 'ls' } })
  assert.equal(full.chars, 856) // 800 + 40 + 16 chars of JSON
  assert.equal(full.tokens, 214) // 200 + 10 + 4

  const empty = P.historyRowMeasure({ role: 'user' })
  assert.equal(empty.chars, 0)
  assert.equal(empty.tokens, 0)
  assert.equal(P.historyRowMeasure(null).tokens, 0)
  assert.equal(P.historyRowMeasure(undefined).chars, 0)
  assert.equal(P.historyRowMeasure({ args: {} }).tokens, 1) // '{}' is 2 chars → 1 token under the ceiling rule
})

test('historyRowLabel: role wording, tool names attached', () => {
  assert.equal(P.historyRowLabel({ role: 'user' }), 'user turn')
  assert.equal(P.historyRowLabel({ role: 'assistant' }), 'assistant turn')
  assert.equal(P.historyRowLabel({ role: 'tool', name: 'terminal' }), 'tool output · terminal')
  assert.equal(P.historyRowLabel({ role: 'weird' }), 'weird')
  assert.equal(P.historyRowLabel(null), 'row')
})

test('topHistoryRows: biggest first, ties in transcript order, capped', () => {
  const messages = [
    { role: 'user', text: 'a'.repeat(40) }, // 10
    { role: 'assistant', text: 'b'.repeat(400) }, // 100
    { role: 'tool', name: 'read_file', text: 'c'.repeat(200) }, // 50
    { role: 'user', text: 'd'.repeat(400) }, // 100 — ties with row 1, later in the transcript
    { role: 'assistant' }, // 0 tokens → never ranked
  ]
  const rows = P.topHistoryRows(messages, 3)
  assert.equal(rows.length, 3)
  assert.equal(rows[0].tokens, 100)
  assert.equal(rows[0].index, 1) // tie broken by transcript order
  assert.equal(rows[1].tokens, 100)
  assert.equal(rows[1].index, 3)
  assert.equal(rows[2].tokens, 50)
  assert.equal(rows[2].label, 'tool output · read_file')
  assert.equal(P.topHistoryRows(messages, 99).length, 4) // zero-token rows stay out
})

test('topHistoryRows / estimateFromHistory: zero and empty inputs', () => {
  assert.equal(P.topHistoryRows([], 5).length, 0)
  assert.equal(P.topHistoryRows(null, 5).length, 0)
  assert.equal(P.topHistoryRows([{}], 5).length, 0)
  assert.equal(P.topHistoryRows([{ role: 'user', text: 'a'.repeat(40) }], 0).length, 0)

  const empty = P.estimateFromHistory(null)
  assert.equal(empty.tokens, 0)
  assert.equal(empty.chars, 0)
  assert.equal(empty.count, 0)
  assert.equal(empty.rows.length, 0)

  const zeros = P.estimateFromHistory([{ role: 'user' }, { role: 'assistant' }])
  assert.equal(zeros.tokens, 0)
  assert.equal(zeros.count, 2)
  assert.equal(zeros.rows.length, 0)

  const sample = P.estimateFromHistory(sampleHistory().messages)
  assert.equal(sample.count, 3)
  assert.equal(sample.tokens, 334) // 100 + 30 + 204
  assert.equal(sample.chars, 1336) // 400 + 120 + 800 + 16
})

/* ── categories ─────────────────────────────────────────────────────────── */

test('categoryColor: theme vars only — a wire hex never reaches the DOM', () => {
  assert.equal(P.categoryColor('system_prompt', '#ff0000'), 'var(--context-usage-system)')
  assert.equal(P.categoryColor('conversation'), 'var(--context-usage-conversation)')
  assert.equal(P.categoryColor('unknown-id', '#ff0000'), P.FALLBACK_COLOR)
  assert.equal(P.categoryColor('unknown-id', 'rgb(1,2,3)'), P.FALLBACK_COLOR)
  assert.equal(P.categoryColor('unknown-id', 'var(--something-theme)'), 'var(--something-theme)')
  assert.equal(P.categoryColor('', undefined), P.FALLBACK_COLOR)
  assert.equal(P.FALLBACK_COLOR.indexOf('var('), 0)
})

test('normalizeCategories: keeps drawable rows, drops junk, rounds tokens', () => {
  const rows = P.normalizeCategories([
    { id: 'system_prompt', label: 'System prompt', color: 'var(--context-usage-system)', tokens: 8400 },
    { id: 'conversation', tokens: '9600.4' },
    { id: 'negative', tokens: -1 },
    { id: 'nan', tokens: 'nope' },
    { tokens: 500 }, // no id
    null,
    'nope',
    { id: 'zero', label: 'Zero', tokens: 0 }, // kept: zero is a real reading
  ])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].id, 'system_prompt')
  assert.equal(rows[0].color, 'var(--context-usage-system)')
  assert.equal(rows[1].id, 'conversation')
  assert.equal(rows[1].label, 'conversation') // label falls back to the id
  assert.equal(rows[1].tokens, 9600)
  assert.equal(rows[2].id, 'zero')
  assert.equal(rows[2].tokens, 0)
  assert.equal(P.normalizeCategories(null).length, 0)
})

test('sumTokens: only finite positives count', () => {
  assert.equal(P.sumTokens(P.normalizeCategories(sampleBreakdown().categories)), 42300)
  assert.equal(P.sumTokens([]), 0)
  assert.equal(P.sumTokens(null), 0)
  assert.equal(P.sumTokens([{ id: 'a', tokens: 5 }, { id: 'b', tokens: -5 }, { id: 'c', tokens: 'x' }]), 5)
})

/* ── contributors ───────────────────────────────────────────────────────── */

test('buildContributors: merges categories and rows, biggest first, tagged by basis', () => {
  const categories = P.normalizeCategories(sampleBreakdown().categories)
  const rows = P.topHistoryRows(sampleHistory().messages, 5)
  const top = P.buildContributors(categories, rows, 5)

  assert.equal(top.length, 5)
  assert.equal(top[0].key, 'cat:tool_definitions')
  assert.equal(top[0].tokens, 21200)
  assert.equal(top[0].basis, 'category')
  assert.equal(top[4].key, 'row:row-2') // the fattest transcript row sneaks into the top 5
  assert.equal(top[4].basis, 'transcript')
  assert.equal(top[4].chars, 816)
  assert.equal(top[4].tokens, 204)
  // descending
  for (let i = 1; i < top.length; i += 1) assert.ok(top[i - 1].tokens >= top[i].tokens, `order at ${i}`)
})

test('buildContributors: a fat transcript row outranks a thin category', () => {
  const top = P.buildContributors([{ id: 'skills', label: 'Skills', color: 'var(--x)', tokens: 50 }], P.topHistoryRows([{ role: 'user', text: 'a'.repeat(4000) }], 5), 5)
  assert.equal(top.length, 2)
  assert.equal(top[0].key, 'row:row-0')
  assert.equal(top[0].tokens, 1000)
  assert.equal(top[1].key, 'cat:skills')
})

test('buildContributors: empty inputs and a zero limit', () => {
  assert.equal(P.buildContributors([], [], 5).length, 0)
  assert.equal(P.buildContributors(null, null, 5).length, 0)
  assert.equal(P.buildContributors(P.normalizeCategories(sampleBreakdown().categories), [], 0).length, 0)
  assert.equal(P.buildContributors(P.normalizeCategories(sampleBreakdown().categories), [], 3).length, 3)
})

/* ── window resolution ──────────────────────────────────────────────────── */

test('configContextLength: reads model.context_length, ignores junk', () => {
  assert.equal(P.configContextLength({ model: { context_length: 200000 } }), 200000)
  assert.equal(P.configContextLength({ model: { context_length: '131072' } }), 131072)
  assert.equal(P.configContextLength({ model: { context_length: 0 } }), 0)
  assert.equal(P.configContextLength({ model: {} }), 0)
  assert.equal(P.configContextLength({}), 0)
  assert.equal(P.configContextLength(null), 0)
})

test('resolveWindowMax: the RPC window wins, config is the fallback', () => {
  assert.equal(P.resolveWindowMax({ context_max: 128000 }, { model: { context_length: 200000 } }), 128000)
  assert.equal(P.resolveWindowMax({ context_max: 0 }, { model: { context_length: 200000 } }), 200000)
  assert.equal(P.resolveWindowMax(null, { model: { context_length: 200000 } }), 200000)
  assert.equal(P.resolveWindowMax(null, null), 0)
})

test('usagePercent: null unless a real window is known', () => {
  assert.equal(P.usagePercent({ context_max: 200000, context_percent: 21 }), 21)
  assert.equal(P.usagePercent({ context_max: 200000, context_percent: 0 }), 0) // 0% is a reading, not a miss
  assert.equal(P.usagePercent({ context_max: 200000, context_used: 42000 }), 21)
  assert.equal(P.usagePercent({ context_max: 0, context_percent: 21 }), null)
  assert.equal(P.usagePercent({ context_percent: 21 }), null)
  assert.equal(P.usagePercent(null), null)
  assert.equal(P.usagePercent({}), null)
})

/* ── the chip ───────────────────────────────────────────────────────────── */

test('chipText / chipLabel: compact, tilde for estimates, — when nothing is known', () => {
  assert.equal(P.chipText(63, false), 'ctx 63%')
  assert.equal(P.chipText(63, true), 'ctx ~63%')
  assert.equal(P.chipText(63.4, false), 'ctx 63%')
  assert.equal(P.chipText(140, false), 'ctx 100%')
  assert.equal(P.chipText(null, false), 'ctx —')
  assert.equal(P.chipText(undefined, false), 'ctx —')
  assert.equal(P.chipText(NaN, false), 'ctx —')

  assert.equal(P.chipLabel(P.buildContextView({})), 'ctx —')
  assert.equal(P.chipLabel(null), 'ctx —')
  assert.equal(P.chipLabel(P.buildContextView({ breakdown: sampleBreakdown() })), 'ctx 21%')
  assert.equal(P.chipLabel(P.buildContextView({ breakdown: sampleBreakdown({ context_estimated: true }) })), 'ctx ~21%')
})

/* ── the view model: honesty grading ────────────────────────────────────── */

test('buildContextView: measured path — RPC numbers and split pass through', () => {
  const view = P.buildContextView({ breakdown: sampleBreakdown(), history: sampleHistory() })
  assert.equal(view.basis, 'measured')
  assert.equal(view.basisLabel, 'measured')
  assert.equal(view.estimated, false)
  assert.equal(view.used, 42300)
  assert.equal(view.windowMax, 200000)
  assert.equal(view.percent, 21)
  assert.equal(view.categories.length, 4)
  assert.equal(view.segmentTotal, 42300)
  assert.equal(view.contributors.length, 5)
  assert.equal(view.model, 'deepseek-v4.1-flash')
  assert.match(view.note, /measured/)
  assert.equal(view.note, P.BASIS_NOTE.measured)
})

test('buildContextView: the server\'s own estimate is graded estimated, not measured', () => {
  const view = P.buildContextView({ breakdown: sampleBreakdown({ context_estimated: true, context_source: 'estimate' }) })
  assert.equal(view.basis, 'estimated')
  assert.equal(view.estimated, true)
  assert.equal(view.serverEstimated, true)
  assert.match(view.note, /chars\/4/)
})

test('buildContextView: no categories + a transcript → derived, flagged as an estimate', () => {
  const view = P.buildContextView({
    breakdown: { categories: [], context_max: 200000, context_used: 0, context_estimated: false, context_source: 'provider_usage' },
    history: sampleHistory(),
  })
  assert.equal(view.basis, 'derived')
  assert.equal(view.estimated, true)
  assert.equal(view.categories.length, 1)
  assert.equal(view.categories[0].id, 'conversation')
  assert.equal(view.categories[0].tokens, 334)
  assert.equal(view.used, 334) // falls back to the measured segment total
  assert.equal(view.windowMax, 200000)
  assert.match(view.note, /display projection/) // the tool-output caveat is stated, not hidden
  assert.equal(view.contributors[0].basis, 'transcript')
})

test('buildContextView: occupancy without a split stays measured and says so', () => {
  const view = P.buildContextView({
    breakdown: { categories: [], context_max: 200000, context_used: 42300, context_percent: 21, context_estimated: false },
  })
  assert.equal(view.basis, 'measured')
  assert.equal(view.used, 42300)
  assert.equal(view.percent, 21)
  assert.equal(view.categories.length, 0)
  assert.equal(view.note, P.BASIS_NOTE.occupancyOnly)
})

test('buildContextView: nothing to report → unavailable, never a guess', () => {
  const view = P.buildContextView({})
  assert.equal(view.basis, 'unavailable')
  assert.equal(view.basisLabel, 'unavailable')
  assert.equal(view.used, 0)
  assert.equal(view.windowMax, 0)
  assert.equal(view.percent, 0)
  assert.equal(view.categories.length, 0)
  assert.equal(view.contributors.length, 0)
  assert.equal(P.chipLabel(view), 'ctx —')

  const errored = P.buildContextView({ breakdownError: 'session not found', historyError: 'session not found' })
  assert.equal(errored.basis, 'unavailable')
  assert.equal(errored.breakdownError, 'session not found')
})

test('buildContextView: config window is used only when the RPC reports none', () => {
  const withConfig = P.buildContextView({ config: { model: { context_length: 131072 } }, history: sampleHistory() })
  assert.equal(withConfig.windowMax, 131072)
  assert.equal(withConfig.basis, 'derived')

  const rpcWins = P.buildContextView({ breakdown: sampleBreakdown(), config: { model: { context_length: 131072 } } })
  assert.equal(rpcWins.windowMax, 200000)
})

test('buildContextView: no transcript and no split → no contributor invented', () => {
  const view = P.buildContextView({ breakdown: { categories: [], context_max: 200000, context_used: 0, context_estimated: false } })
  assert.equal(view.categories.length, 0)
  assert.equal(view.contributors.length, 0)
  assert.equal(view.used, 0)
})

/* ── refresh bus ────────────────────────────────────────────────────────── */

test('refreshBus: subscribe, emit, unsubscribe; a bad listener cannot break the fan-out', () => {
  const bus = makeRuntime().pure.refreshBus
  let hits = 0
  const off = bus.subscribe(() => {
    hits += 1
  })
  assert.equal(bus.emit(), 1)
  assert.equal(hits, 1)

  bus.subscribe(() => {
    throw new Error('listener blew up')
  })
  bus.subscribe(() => {
    hits += 10
  })
  assert.equal(bus.emit(), 3) // the thrower is counted but does not stop the others
  assert.equal(hits, 12)

  off()
  assert.equal(bus.emit(), 2)
  assert.equal(hits, 22)

  assert.equal(typeof bus.subscribe('not a function'), 'function') // safe no-op unsubscribe
  assert.equal(bus.emit(), 2)
})
