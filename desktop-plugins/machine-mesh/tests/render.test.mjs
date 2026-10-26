/**
 * Honest-state render tests for machine-mesh.
 *
 * The pane and the chip are rendered in the vm with a stub useQuery that returns whatever
 * data (or error) a case wants, then the returned jsx tree is walked for text. This is how
 * "backend not mounted yet", "tailscale CLI not found" and per-section errors are proven to
 * actually paint, instead of being asserted from the source.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

/** Minimal renderer: host elements are walked, function elements are invoked. */
function textOf(node) {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node === 'function') return textOf(node({}))
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object') {
    if (typeof node.type === 'function') return textOf(node.type(node.props || {}))
    if (node.props) return textOf(node.props.children)
  }
  return ''
}

/** Render both contributions with the given per-query results. */
function render({ nodes, services } = {}) {
  const jsx = (type, props = {}) => ({ type, props })
  const context = {
    jsx,
    jsxs: jsx,
    host: { state: {}, request: async () => ({}), paneVisibility: () => ({ get: () => true, subscribe: () => () => {} }) },
    PALETTE_AREA: 'palette',
    STATUSBAR_AREAS: { left: 'statusbar.left', right: 'statusbar.right' },
    queryClient: { invalidateQueries: () => {} },
    useValue: (a) => (a && a.get ? a.get() : null),
    useCallback: (fn) => fn,
    useQuery: (options) => (options.queryKey.includes('nodes') ? nodes : services) ||
      { data: null, isLoading: false, isFetching: false, error: null },
  }
  const code = source
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
  vm.runInNewContext(code, context)

  const entries = []
  context.plugin.register({ rest: () => Promise.resolve({}), register: (item) => entries.push(item) })
  const pane = entries.find((e) => e.id === 'mesh-pane').render()
  const chip = entries.find((e) => e.id === 'mesh-chip').render()
  return { paneText: textOf(pane), chipText: textOf(chip) }
}

const ok = (data) => ({ data, isLoading: false, isFetching: false, error: null })

const NODES_DATA = {
  ok: true,
  host: { name: 'workstation', os: 'linux', arch: 'x86_64', kernel: '7.0.0-31-generic', uptime_s: 22596.94, ips: ['192.168.1.10'] },
  tailscale: { available: true, reason: null, self_ip: '127.0.0.1', peer_count: 3, online_peers: 2 },
  nodes: [
    { kind: 'self', name: 'workstation', os: 'linux', arch: 'x86_64', kernel: '7.0.0-31-generic', uptime_s: 22596.94, ips: ['192.168.1.10', '127.0.0.1'], ipv4: '192.168.1.10', online: true },
    { kind: 'peer', name: 'laptop', os: 'linux', online: true, active: true, ipv4: '127.0.0.1', ips: ['127.0.0.1'], last_seen: null, last_handshake: '2026-09-20T17:52:30-06:00' },
    { kind: 'peer', name: 'homebox', os: 'linux', online: false, active: false, ipv4: '127.0.0.1', ips: ['127.0.0.1'], last_seen: '2020-01-01T00:00:00Z' },
  ],
}

const SERVICES_DATA = {
  ok: true,
  generated_at: '2026-09-20T17:55:00-0600',
  probe_hosts: ['127.0.0.1', '127.0.0.1', '192.168.1.10'],
  summary: { up: 6, total: 6, down: 0, http_answered: 6 },
  services: [
    { name: 'hermes-remote-backend', port: 9119, tcp: true, reachable: true, probe_host: '127.0.0.1', http_code: 302, http_probed: true, unit: 'hermes-remote-backend.service', unit_state: 'active', pid: 1992, note: null },
    { name: 'llama-server', port: 8085, tcp: true, reachable: true, probe_host: '127.0.0.1', http_code: 415, http_probed: true, unit: 'hermes-bonsai-llama.service', unit_state: 'active', pid: 18328, note: null },
    { name: 'jev-graphic-studio', port: 8791, tcp: false, reachable: false, probe_host: null, http_code: null, http_probed: true, unit: 'jev-graphic-studio.service', unit_state: 'inactive', pid: null, note: 'not listening' },
  ],
}

test('pane renders real nodes and services', () => {
  const { paneText } = render({ nodes: ok(NODES_DATA), services: ok(SERVICES_DATA) })

  assert.match(paneText, /Machine Mesh/)
  assert.match(paneText, /workstation/)
  assert.match(paneText, /7\.0\.0-31-generic/)
  assert.match(paneText, /2\/3 online/) // homebox is offline — the count must not say 3
  assert.match(paneText, /laptop/)
  assert.match(paneText, /127\.0\.0\.1/)
  assert.match(paneText, /homebox/)
  assert.match(paneText, /last seen \d+d ago/)
  assert.match(paneText, /hermes-remote-backend/)
  assert.match(paneText, /:9119/)
  assert.match(paneText, /active · http 302/)
  assert.match(paneText, /hermes-remote-backend\.service/)
  assert.match(paneText, /127\.0\.0\.1/)
  assert.match(paneText, /:8791/)
  assert.match(paneText, /not listening · inactive/)
  assert.match(paneText, /2\/3 up/)
  assert.match(paneText, /127\.0\.0\.1 → 127\.0\.0\.1 → 192\.168\.1\.10/)
})

test('chip shows the live count from the services payload', () => {
  const { chipText } = render({ nodes: ok(NODES_DATA), services: ok(SERVICES_DATA) })
  assert.match(chipText, /mesh 2\/3/)
})

test('404 renders "backend not mounted yet", not a spinner', () => {
  const notFound = { data: undefined, isLoading: false, isFetching: false, error: { status: 404, message: 'Not Found' } }
  const { paneText, chipText } = render({ nodes: notFound, services: notFound })

  assert.match(paneText, /backend not mounted yet/)
  assert.match(paneText, /nothing real to show/)
  assert.doesNotMatch(paneText, /no data/)
  assert.match(chipText, /mesh \?/)          // never a number it does not have
  assert.doesNotMatch(chipText, /mesh \d/)
})

test('an unreachable backend shows the real message, per section', () => {
  const boom = { data: undefined, isLoading: false, isFetching: false, error: new Error('fetch failed: ECONNREFUSED') }
  const { paneText } = render({ nodes: boom, services: boom })

  assert.match(paneText, /nodes unreachable/)
  assert.match(paneText, /services unreachable/)
  assert.match(paneText, /ECONNREFUSED/)
  assert.doesNotMatch(paneText, /backend not mounted yet/)
})

test('one broken half does not hide the other', () => {
  const boom = { data: undefined, isLoading: false, isFetching: false, error: new Error('timeout after 12000ms') }
  const { paneText } = render({ nodes: ok(NODES_DATA), services: boom })

  assert.match(paneText, /workstation/)              // nodes still render
  assert.match(paneText, /services unreachable/)
  assert.match(paneText, /timeout after 12000ms/)
})

test('missing tailscale CLI degrades to this host only, with the reason', () => {
  const hostOnly = {
    ok: true,
    host: NODES_DATA.host,
    tailscale: { available: false, reason: 'tailscale CLI not found', peer_count: 0, online_peers: 0, self_ip: null },
    nodes: [NODES_DATA.nodes[0]],
  }
  const { paneText, chipText } = render({ nodes: ok(hostOnly), services: ok(SERVICES_DATA) })

  assert.match(paneText, /tailscale: tailscale CLI not found — showing this host only/)
  assert.match(paneText, /workstation/)               // the one real node is still there
  assert.match(paneText, /1\/1 online/)
  assert.doesNotMatch(paneText, /homebox/)          // no invented peers
  assert.match(chipText, /mesh 2\/3/)                  // the chip is unaffected by nodes
})

test('an empty allowlist result says so instead of showing a blank list', () => {
  const empty = { ok: true, generated_at: '2026-09-20T17:55:00-0600', probe_hosts: ['127.0.0.1'], summary: { up: 0, total: 0, down: 0 }, services: [] }
  const { paneText } = render({ nodes: ok(NODES_DATA), services: ok(empty) })
  assert.match(paneText, /no services in the allowlist responded to the probe/)
})
