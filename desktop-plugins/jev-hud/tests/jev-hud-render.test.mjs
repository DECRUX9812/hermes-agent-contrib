/**
 * jev-hud — render states (pane + status-bar chip), including the degraded paths.
 *
 * Every state here is one the real app can hit: backend not mounted, backend answering with
 * an empty ledger, and a healthy payload. The assertions are on the rendered TEXT, so a
 * regression that starts printing a plausible number with no data behind it fails the suite.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { expand, loadPlugin, register, renderText } from './harness.mjs'

const NOT_MOUNTED_TEXT = 'backend not mounted yet — restart the Hermes backend to mount /api/plugins/jev-hud'

const ROW = {
  id: 'oracle:39',
  source: 'oracle',
  ts: 1789903438.6494904,
  ts_iso: '2026-09-20T05:23:58-06:00',
  question: 'Merge the branch now or wait?',
  verdict: 'wait',
  answer: 'wait',
  confidence: 0.65,
  decider: 'jev',
  kind: 'choice',
  model: 'jev-1.13.0',
  ms: 203,
  cost_usd: 1.621e-05,
  cached: false,
  fallback: false,
  reason: null,
  probabilities: { merge_now: 0.17, wait: 0.83 },
  extra: {},
  age_s: 120,
}

const SUMMARY = {
  ok: true,
  today: '2026-09-20',
  today_counts: { count: 12, by_source: { oracle: 9, trading: 3 }, by_verdict: { handoff: 4, wait: 3, no: 2 } },
  window_counts: { count: 44 },
  mean_confidence_today: 0.42,
  mean_confidence_today_n: 7,
  last_seen: { ts: ROW.ts, verdict: 'wait', age_s: 120, source: 'oracle' },
  notes: [],
}

function paneOf(runtime) {
  const pane = register(runtime.plugin).find((e) => e.id === 'hud-pane')
  return expand(pane.render())
}

function chipOf(runtime) {
  const chip = register(runtime.plugin).find((e) => e.id === 'hud-chip')
  return expand(chip.render())
}

test('backend not mounted: the pane says exactly that and shows no numbers', () => {
  const runtime = loadPlugin({
    queries: { recent: { isError: true, error: Object.assign(new Error('Request failed'), { status: 404 }) }, summary: { isError: true, error: new Error('404') } },
  })
  const text = renderText(paneOf(runtime))
  assert.ok(text.includes(NOT_MOUNTED_TEXT), text)
  assert.match(text, /expected at \/api\/plugins\/jev-hud\/recent/)
  assert.doesNotMatch(text, /\d+%/, 'no confidence may be rendered with no data')
  assert.doesNotMatch(text, /\b44\b/)
})

test('backend reachable but the ledger is empty: an honest empty state, not zeros', () => {
  const runtime = loadPlugin({
    queries: {
      recent: { data: { ok: true, rows: [], count: 0, available: 0, notes: ['oracle ledger not found at /home/user/.hermes/jev-oracle-ledger.jsonl — nothing to show from it'] } },
      summary: { data: Object.assign({}, SUMMARY, { today_counts: { count: 0, by_source: {}, by_verdict: {} }, mean_confidence_today: null, mean_confidence_today_n: 0, last_seen: null, notes: ['trading ledger not found'] }) },
    },
  })
  const text = renderText(paneOf(runtime))
  assert.match(text, /no decisions in the ledger tail/)
  assert.match(text, /will not invent a row/)
  assert.match(text, /oracle ledger not found/)     // the backend's own note is surfaced
  assert.match(text, /no ledger rows read/)
  assert.match(text, /no verdicts today/)
  assert.match(text, /mean confidence —/)            // unknown, never 0%
})

test('healthy payload: rows, verdict, confidence, age and the today header all render', () => {
  const runtime = loadPlugin({
    queries: {
      recent: { data: { ok: true, rows: [ROW], count: 1, available: 40, notes: [] } },
      summary: { data: SUMMARY },
    },
  })
  const text = renderText(paneOf(runtime))
  assert.match(text, /Jev decisions/)
  assert.match(text, /12 today/)
  assert.match(text, /oracle 9 · trading 3/)
  assert.match(text, /handoff 4 · wait 3 · no 2/)
  assert.match(text, /mean confidence 42% \(7 of 12 scored\)/)
  assert.match(text, /wait/)
  assert.match(text, /65%/)
  assert.match(text, /Merge the branch now or wait\?/)
  assert.match(text, /1 of 40/)
  assert.match(text, /refresh/)
})

test('a decision without a confidence renders as unknown, not as 0%', () => {
  const runtime = loadPlugin({
    queries: {
      recent: { data: { ok: true, rows: [Object.assign({}, ROW, { confidence: null, verdict: 'handoff', fallback: true, reason: 'jev failed: RuntimeError' })], notes: [] } },
      summary: { data: SUMMARY },
    },
  })
  const text = renderText(paneOf(runtime))
  assert.match(text, /handoff/)
  assert.match(text, /—/)
  assert.doesNotMatch(text, /0%/)
})

test('the row detail renders probabilities and provenance when expanded', () => {
  const runtime = loadPlugin()
  const detail = expand(runtime.__hud.DecisionDetail({ row: ROW }))
  const text = renderText(detail)
  assert.match(text, /merge_now/)
  assert.match(text, /83%/)
  assert.match(text, /jev-1\.13\.0/)
  assert.match(text, /203ms/)
  assert.match(text, /2026-09-20T05:23:58-06:00/)
})

test('the status-bar chip reports today\'s count, or the honest failure', () => {
  const healthy = loadPlugin({ queries: { summary: { data: SUMMARY } } })
  const chip = chipOf(healthy)
  assert.equal(renderText(chip).trim(), 'jev 12 today')
  assert.match(chip.props.title, /12 decisions today/)
  assert.match(chip.props.title, /click to refresh/)

  const offline = loadPlugin({ queries: { summary: { isError: true, error: new Error('404 Not Found') } } })
  const offlineChip = chipOf(offline)
  assert.equal(renderText(offlineChip).trim(), 'jev offline')
  assert.equal(offlineChip.props.title, NOT_MOUNTED_TEXT)

  const loading = loadPlugin({ queries: { summary: {} } })
  assert.equal(renderText(chipOf(loading)).trim(), 'jev …', 'no number until a number exists')
})
