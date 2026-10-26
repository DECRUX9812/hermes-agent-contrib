/**
 * Pure-logic tests for machine-mesh: the formatters and classifiers the pane renders from.
 * No SDK identifiers are referenced by these functions, so they run straight out of the vm.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

const EXPORTS = [
  'fmtUptime', 'relTime', 'isZeroTime', 'nodeStatus', 'nodeDot',
  'svcStatus', 'svcDot', 'meshSummary', 'countOnline', 'isNotMounted', 'errText',
]

function runtime() {
  const jsx = (type, props = {}) => ({ type, props })
  const context = {
    jsx,
    jsxs: jsx,
    host: { state: {}, request: async () => ({}) },
    PALETTE_AREA: 'palette',
    STATUSBAR_AREAS: { left: 'statusbar.left', right: 'statusbar.right' },
    queryClient: { invalidateQueries: () => {} },
    useQuery: () => ({ data: null, isLoading: false, isFetching: false }),
    useValue: (a) => (a && a.get ? a.get() : null),
    useCallback: (fn) => fn,
  }
  const code = source
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat('\n' + EXPORTS.map((name) => `globalThis.__${name} = ${name};`).join('\n'))
  vm.runInNewContext(code, context)
  return context
}

const fn = runtime()
const fmtUptime = fn.__fmtUptime
const relTime = fn.__relTime
const isZeroTime = fn.__isZeroTime
const nodeStatus = fn.__nodeStatus
const nodeDot = fn.__nodeDot
const svcStatus = fn.__svcStatus
const svcDot = fn.__svcDot
const meshSummary = fn.__meshSummary
const countOnline = fn.__countOnline
const isNotMounted = fn.__isNotMounted
const errText = fn.__errText

/* ---------------------------------------------------------------- fmtUptime */

test('fmtUptime renders the real uptime of this box', () => {
  assert.equal(fmtUptime(22596.94), '6h 16m') // /proc/uptime at recon time
  assert.equal(fmtUptime(45), '45s')
  assert.equal(fmtUptime(3660), '1h 1m')
  assert.equal(fmtUptime(200000), '2d 7h')
})

test('fmtUptime refuses to invent a duration', () => {
  assert.equal(fmtUptime(null), '—')
  assert.equal(fmtUptime(undefined), '—')
  assert.equal(fmtUptime('abc'), '—')
  assert.equal(fmtUptime(-5), '—')
})

/* ---------------------------------------------------------------- relTime */

test('relTime formats against an injected clock', () => {
  const now = Date.parse('2026-09-20T17:53:30-06:00')
  assert.equal(relTime('2026-09-20T06:41:11-06:00', now), '11h ago') // homebox's real LastSeen
  assert.equal(relTime('2026-09-20T17:53:00-06:00', now), 'just now')
  assert.equal(relTime('2026-09-20T17:23:30-06:00', now), '30m ago')
  assert.equal(relTime('2026-09-18T17:53:30-06:00', now), '2d ago')
})

test('relTime returns null when there is no honest answer', () => {
  assert.equal(relTime(null), null)
  assert.equal(relTime(''), null)
  assert.equal(relTime('0001-01-01T00:00:00Z'), null) // Go zero time
  assert.equal(relTime('not a date'), null)
  assert.equal(isZeroTime('0001-01-01T00:00:00Z'), true)
  assert.equal(isZeroTime('2026-09-20T06:41:11-06:00'), false)
})

/* ---------------------------------------------------------------- nodes */

test('nodeStatus describes this host with its uptime', () => {
  assert.equal(nodeStatus({ kind: 'self', name: 'workstation', uptime_s: 22596.94 }), 'this host · up 6h 16m')
})

test('nodeStatus describes peers online and offline', () => {
  assert.equal(nodeStatus({ kind: 'peer', online: true, active: true }), 'online · active')
  assert.equal(nodeStatus({ kind: 'peer', online: true, active: false }), 'online')
  assert.match(nodeStatus({ kind: 'peer', online: false, last_seen: '2020-01-01T00:00:00Z' }), /^last seen \d+d ago$/)
  assert.match(nodeStatus({ kind: 'peer', online: false, last_seen: null, last_handshake: '2020-01-01T00:00:00Z' }), /^last seen \d+d ago$/)
  assert.equal(nodeStatus({ kind: 'peer', online: false, last_seen: null, last_handshake: null }), 'offline · never seen')
  assert.equal(nodeStatus(null), 'unknown')
})

test('nodeDot is green only for a node that is actually up', () => {
  assert.equal(nodeDot({ kind: 'self' }), 'up')
  assert.equal(nodeDot({ kind: 'peer', online: true }), 'up')
  assert.equal(nodeDot({ kind: 'peer', online: false }), 'down')
  assert.equal(nodeDot(null), 'unknown')
})

test('countOnline counts only nodes that report online', () => {
  const counts = countOnline([{ online: true }, { online: false }, { online: true }, null])
  assert.equal(counts.online, 2)
  assert.equal(counts.total, 3)
})

/* ---------------------------------------------------------------- services */

test('svcStatus shows only the parts we actually probed', () => {
  assert.equal(
    svcStatus({ tcp: true, unit_state: 'active', unit: 'hermes-remote-backend.service', http_code: 302, http_probed: true }),
    'active · http 302',
  )
  assert.equal(svcStatus({ tcp: true, unit_state: null, unit: null, http_code: null, http_probed: true }), 'http — · no unit')
  assert.equal(svcStatus({ tcp: false, unit_state: null, unit: null, note: 'not listening' }), 'not listening')
  assert.equal(svcStatus({ tcp: false, unit_state: 'inactive', unit: 'hermes-changelog.service' }), 'not listening · inactive')
  assert.equal(svcStatus(null), 'unknown')
})

test('svcDot is green only for a port that answered a connect', () => {
  assert.equal(svcDot({ tcp: true }), 'up')
  assert.equal(svcDot({ tcp: false }), 'down')
  assert.equal(svcDot(null), 'unknown')
})

test('meshSummary produces the status-bar label from real numbers only', () => {
  const summary = meshSummary([{ tcp: true }, { tcp: true }, { tcp: false }, null])
  assert.equal(summary.up, 2)
  assert.equal(summary.down, 1)
  assert.equal(summary.total, 3)
  assert.equal(summary.label, 'mesh 2/3')
  assert.equal(meshSummary([]).label, 'mesh —')
  assert.equal(meshSummary(null).label, 'mesh —')
  assert.equal(meshSummary(undefined).total, 0)
})

/* ---------------------------------------------------------------- errors */

test('isNotMounted separates "not mounted" from "unreachable"', () => {
  assert.equal(isNotMounted({ status: 404 }), true)
  assert.equal(isNotMounted({ response: { status: 404 } }), true)
  assert.equal(isNotMounted({ message: 'Request failed with status 404' }), true)
  assert.equal(isNotMounted({ message: 'backend not mounted yet' }), true)
  assert.equal(isNotMounted({ status: 500, message: 'internal error' }), false)
  assert.equal(isNotMounted(new Error('fetch failed')), false)
  assert.equal(isNotMounted(null), false)
})

test('errText never throws on a weird error', () => {
  assert.equal(errText({ message: 'boom' }), 'boom')
  assert.equal(errText(null), 'unknown error')
  assert.equal(errText(new Error('timeout after 12000ms')), 'timeout after 12000ms')
})
