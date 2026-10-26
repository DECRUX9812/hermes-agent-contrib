/**
 * Render tests: the pane and the chip are invoked for real (inside the vm) against canned query
 * states, and the visible text is asserted. This is what catches lazy ReferenceErrors and missing
 * degraded states — node --check cannot see either.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fixture, loadPlugin, textOf } from './_harness.mjs'

const runtimesLive = fixture('runtimes.live.json')
const processLive = fixture('process.live.json')

/** A query stub that answers by queryKey, so the pane's two queries get their real shapes. */
const queryStub = (runtimes, process) => (opts) => ({
  data: Array.isArray(opts && opts.queryKey) && opts.queryKey.includes('process') ? process : runtimes,
  isLoading: false,
  isError: false,
  error: null,
})

function paneText(overrides) {
  const ctx = loadPlugin(overrides)
  return textOf(ctx.__DeckPane()).join(' ')
}

test('pane renders the REAL live runtime readout', () => {
  const text = paneText({ useQuery: queryStub(runtimesLive, processLive) })
  assert.equal(text.includes('Local Model Deck'), true)
  assert.equal(text.includes('Ternary-Bonsai-2-27B-PTQ1_0.gguf'), true)
  assert.equal(text.includes('PTQ1_0 - 1.75 bpw ternary (group 128)'), true)
  assert.equal(text.includes('32k'), true)
  assert.equal(text.includes('0/1 busy'), true)
  assert.equal(text.includes('5.5 GB'), true)
  assert.equal(text.includes('26.9B'), true)
  assert.equal(text.includes('127.0.0.1:8085'), true)
  assert.equal(text.includes('pid 18328'), true)
  assert.equal(text.includes('1.6 GB'), true)
  assert.equal(text.includes('6h 28m'), true)
  assert.equal(text.includes('up'), true)
  assert.equal(text.includes('sampled'), true)
  assert.equal(text.includes('auto-refresh 5s while visible'), true)
  assert.match(text, /probes \/health \/props \/slots \/v1\/models and \/proc/)
})

test('pane shows the honest metrics row and never a fabricated tok/s', () => {
  const text = paneText({ useQuery: queryStub(runtimesLive, processLive) })
  assert.equal(text.includes('metrics disabled on this server (start with --metrics for tok/s)'), true)
  assert.equal(text.includes('metrics off'), true)
  assert.equal(text.includes('This server does not support metrics endpoint'), true)
  // no number may be presented as throughput
  assert.equal(/\d+(\.\d+)?\s*tok\/s/.test(text), false)
  assert.equal(/tokens\/s/.test(text), false)
})

test('pane reports "backend not mounted yet" on a 404 from ctx.rest', () => {
  const text = paneText({
    useQuery: () => ({ data: null, isLoading: false, isError: true, error: new Error('404 not found') }),
  })
  assert.equal(text.includes('backend not mounted yet'), true)
  assert.equal(text.includes('404 not found'), true)
  assert.equal(text.includes('restart the backend'), true)
})

test('pane reports an unreachable backend without pretending it is unmounted', () => {
  const text = paneText({
    useQuery: () => ({ data: null, isLoading: false, isError: true, error: new Error('fetch failed') }),
  })
  assert.equal(text.includes('backend unreachable'), true)
  assert.equal(text.includes('backend not mounted yet'), false)
})

test('pane is honest while the first probe is in flight', () => {
  const text = paneText({ useQuery: () => ({ data: null, isLoading: true, isError: false, error: null }) })
  assert.equal(text.includes('probing the configured runtime endpoints'), true)
  assert.equal(text.includes('probing…'), true) // header sample line, not a fake spinner
})

test('pane shows the empty state when nothing is listening', () => {
  const downPayload = {
    ok: true,
    ts: 1789949250.0,
    any_up: false,
    note: 'nothing answered /health on 127.0.0.1:8085 — start the runtime, or add it to RUNTIME_ENDPOINTS',
    runtimes: [{ id: 'bonsai', label: 'Ternary Bonsai 2 27B', host: '127.0.0.1', port: 8085, up: false, error: 'connection refused', slots: {} }],
  }
  const text = paneText({ useQuery: queryStub(downPayload, null) })
  assert.equal(text.includes('no local runtime is up'), true)
  assert.equal(text.includes('connection refused'), true)
  assert.equal(text.includes('nothing answered /health'), true)
})

test('pane handles an empty runtime allowlist', () => {
  const text = paneText({ useQuery: queryStub({ ok: true, ts: 1, any_up: false, note: null, runtimes: [] }, null) })
  assert.equal(text.includes('no runtimes configured'), true)
  assert.equal(text.includes('RUNTIME_ENDPOINTS'), true)
})

test('pane fetches the real backend routes: /runtimes and /process?port=<primary>', async () => {
  const paths = []
  const calls = []
  const ctx = loadPlugin({
    useQuery: (opts) => {
      calls.push(opts)
      return { data: runtimesLive, isLoading: false, isError: false, error: null }
    },
    useValue: () => true,
  })
  ctx.plugin.register({
    rest: async (path) => {
      paths.push(path)
      return runtimesLive
    },
    register: () => undefined,
  })
  ctx.__DeckPane()
  const runtimesOpts = calls.find((o) => o.queryKey.includes('runtimes'))
  const processOpts = calls.find((o) => o.queryKey.includes('process'))
  assert.equal(runtimesOpts.queryKey.join('|'), 'local-model-deck|runtimes')
  assert.equal(processOpts.enabled, true) // the primary port came from the live payload
  await runtimesOpts.queryFn()
  await processOpts.queryFn()
  assert.equal(paths.includes('/runtimes'), true)
  assert.equal(paths.includes('/process?port=8085'), true)
})

test('pane polls every 5s while visible and stops while hidden', () => {
  const calls = []
  const stub = (opts) => {
    calls.push(opts)
    return { data: runtimesLive, isLoading: false, isError: false, error: null }
  }
  let ctx = loadPlugin({ useQuery: stub, useValue: () => true })
  ctx.__DeckPane()
  const visibleOpts = calls.find((o) => o.queryKey.includes('runtimes'))
  assert.equal(visibleOpts.refetchInterval, 5000)
  assert.equal(visibleOpts.retry, 0) // never a long backoff hiding a dead backend

  calls.length = 0
  ctx = loadPlugin({ useQuery: stub, useValue: () => false })
  ctx.__DeckPane()
  const hiddenOpts = calls.find((o) => o.queryKey.includes('runtimes'))
  assert.equal(hiddenOpts.refetchInterval, false)
})

test('chip shows bonsai ok with a size hint for the live payload', () => {
  const ctx = loadPlugin({ useQuery: () => ({ data: runtimesLive, isLoading: false, isError: false, error: null }) })
  const tree = ctx.__DeckChip()
  const text = textOf(tree).join(' ')
  assert.equal(text.includes('bonsai ok'), true)
  assert.equal(text.includes('5.5 GB'), true)
  assert.equal(tree.props.title.includes('Local Model Deck'), true)
  assert.equal(typeof tree.props.onClick, 'function')
  tree.props.onClick() // must not throw with the stubbed queryClient
})

test('chip shows bonsai down and explains why in the tooltip', () => {
  const payload = { ok: true, ts: 1, any_up: false, note: null, runtimes: [{ id: 'bonsai', up: false, error: 'connection refused' }] }
  const ctx = loadPlugin({ useQuery: () => ({ data: payload, isLoading: false, isError: false, error: null }) })
  const tree = ctx.__DeckChip()
  const text = textOf(tree).join(' ')
  assert.equal(text.includes('bonsai down'), true)
  assert.equal(tree.props.title.includes('connection refused'), true)
})

test('chip stays silent-but-honest when the backend is not mounted', () => {
  const ctx = loadPlugin({
    useQuery: () => ({ data: null, isLoading: false, isError: true, error: new Error('404 not found') }),
  })
  const tree = ctx.__DeckChip()
  const text = textOf(tree).join(' ')
  assert.equal(text.includes('deck ?'), true)
  assert.equal(text.includes('ok'), false)
  assert.equal(tree.props.title.includes('404 not found'), true)
})
