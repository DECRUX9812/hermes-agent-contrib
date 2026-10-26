// Pure-logic tests for session-peek. No Electron, no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')
// vm.runInContext evaluates as a SCRIPT: `import` and `export` are both illegal
// there. Strip the import block (the sandbox supplies those bindings) and rewrite
// the export forms the plugin actually uses.
const code = SRC
  .replace(/^import[\s\S]*?from\s+'[^']*'\s*$/gm, '')
  .replace(/^export default \{/m, 'globalThis.__plugin = {')
  .replace(/^export function (\w+)/gm, 'function $1')

function load(overrides = {}) {
  const registered = []
  const ctx = {
    contribution: (area, data) => registered.push({ area, data }),
    rest: () => { throw new Error('no rest in tests') },
    socket: () => () => {},
    i18n: { register: () => {} },
  }
  const requested = []
  const hostStub = {
    request: async (method, params) => { requested.push({ method, params }); return overrides.list || { sessions: [] } },
    notify: () => {}, notifyError: () => {},
  }
  const sandbox = {
    globalThis: {}, console,
    host: hostStub,
    SESSION_ROW_AREAS: { leading: 'sessionRow.leading', trailing: 'sessionRow.trailing' },
    useValue: () => overrides.value,
    jsx: (type, props) => ({ type, props }),
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code + '\n;globalThis.__api = { badgeText, formatWhen, loadPreview };', sandbox)
  return { api: sandbox.__api, plugin: sandbox.__plugin, registered, requested, sandbox }
}

test('register() contributes to sessionRow.leading with a render fn', () => {
  const { plugin, registered } = load()
  plugin.register({ contribution: (a, d) => registered.push({ area: a, data: d }) })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].area, 'sessionRow.leading')
  assert.equal(typeof registered[0].data.render, 'function')
})

test('plugin id matches the directory name (loader contract)', () => {
  const { plugin } = load()
  assert.equal(plugin.id, 'session-peek')
  assert.equal(plugin.defaultEnabled, false, 'must ship opt-in')
})

test('badgeText formats turns and recency', () => {
  const { api } = load()
  const s = api.badgeText({ turns: 12, updated: Date.now() - 5 * 60000 })
  assert.equal(s, '12 msg · 5m')
})

test('badgeText returns null when there is nothing to show', () => {
  const { api } = load()
  assert.equal(api.badgeText(null), null)
  assert.equal(api.badgeText({}), null)
})

test('badgeText accepts numeric seconds and ms epochs', () => {
  const { api } = load()
  const now = Date.now()
  assert.match(api.badgeText({ turns: 1, updated: Math.floor(now / 1000) }), /^1 msg · /)
  assert.match(api.badgeText({ turns: 1, updated: now }), /^1 msg · /)
})

test('formatWhen degrades safely on junk input', () => {
  const { api } = load()
  assert.equal(api.formatWhen(null), null)
  assert.equal(api.formatWhen('not-a-date'), null)
  assert.equal(api.formatWhen(NaN), null)
})

test('loadPreview requests session.list and caches by durable id', async () => {
  const t = { l1: { durable_id: 'dur-1', title: 'One', message_count: 4, updated_at: Date.now() } }
  const { api, requested } = load({ list: { sessions: [t.l1] } })
  const a = await api.loadPreview('dur-1')
  const b = await api.loadPreview('dur-1')
  assert.equal(a.title, 'One')
  assert.equal(a.turns, 4)
  assert.equal(b, a, 'second call served from cache')
  assert.equal(requested.length, 1, 'exactly one request for two calls')
  assert.equal(requested[0].method, 'session.list')
})

test('loadPreview resolves null (never throws) when the RPC fails', async () => {
  const { api } = load({ list: null })
  // Simulate a failing request by passing a list getter that throws.
  const boom = load()
  boom.sandbox.host.request = async () => { throw new Error('gateway down') }
  const out = await vm.runInContext('loadPreview("x")', boom.sandbox)
  assert.equal(out, null)
})

test('loadPreview returns null for an unknown session rather than fabricating', async () => {
  const { api } = load({ list: { sessions: [] } })
  assert.equal(await api.loadPreview('nope'), null)
})