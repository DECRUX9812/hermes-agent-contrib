// Pure-logic tests for attention-radar. No Electron, no network, no DOM.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')
// vm.runInContext evaluates as a SCRIPT: import/export are both illegal there.
const code = SRC
  .replace(/^import[\s\S]*?from\s+'[^']*'\s*$/gm, '')
  .replace(/^export default \{/m, 'globalThis.__plugin = {')
  .replace(/^export function (\w+)/gm, 'function $1')

function load(items = []) {
  const registered = []
  const sandbox = {
    console,
    PANES_AREA: 'panes', PALETTE_AREA: 'palette', STATUSBAR_AREAS: { left: 'statusBar.left', right: 'statusBar.right' },
    host: { state: { attentionItems: { get: () => items } } },
    useValue: (src) => (src && typeof src.get === 'function' ? src.get() : src),
    openSession: () => {},
    jsx: (type, props) => ({ type, props }),
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code + '\n;globalThis.__api={rank,bySession,headline,SEV};', sandbox)
  return { api: sandbox.__api, plugin: sandbox.__plugin, registered, sandbox }
}

const item = (kind, over = {}) => ({
  id: kind + ':' + (over.sessionId || 's') + ':1', kind,
  sessionId: 's', title: kind + ' title', ...over,
})

test('plugin ships opt-in with a valid id', () => {
  const { plugin } = load()
  assert.equal(plugin.id, 'attention-radar')
  assert.equal(plugin.defaultEnabled, false)
})

test('register() contributes pane, statusbar and palette exactly once each', () => {
  const { plugin } = load()
  const reg = []
  plugin.register({ contribution: (a, d) => reg.push({ area: a, id: d.id }) })
  assert.equal(reg.length, 3)
  assert.deepEqual(reg.map(r => r.area).sort(),
    ['palette', 'panes', 'statusBar.right'])
  // A pane without a placement hint lands arbitrarily in the layout tree.
  const pane = reg.find(r => r.area === 'panes')
  assert.ok(pane, 'pane registered')
})

test('rank orders by severity: error outranks sudo, sudo outranks clarify', () => {
  const { api } = load()
  const r = api.rank([item('clarify'), item('sudo'), item('error')]).map(i => i.kind)
  assert.deepEqual(r, ['error', 'sudo', 'clarify'])
})

test('rank is stable within a severity band', () => {
  const { api } = load()
  const r = api.rank([item('approval', { id: 'a' }), item('approval', { id: 'b' })]).map(i => i.id)
  assert.deepEqual(r, ['a', 'b'])
})

test('rank drops unknown kinds and non-objects rather than rendering junk', () => {
  const { api } = load()
  // Assert on length, not deepEqual: the array is built inside the vm realm, so
  // its prototype differs and deepEqual fails on [] for no meaningful reason.
  assert.equal(api.rank([item('bogus'), null, undefined, 42, 'x']).length, 0)
  assert.equal(api.rank(null).length, 0)
  assert.equal(api.rank(undefined).length, 0)
})

test('bySession groups app-level items under a stable key', () => {
  const { api } = load()
  const g = api.bySession(api.rank([item('sudo'), item('error', { sessionId: null })]))
  assert.equal(g.get('s').length, 1)
  assert.equal(g.get('__app__').length, 1)
})

test('headline counts blocking items separately from questions', () => {
  const { api } = load()
  assert.equal(api.headline([]), 'All clear')
  assert.equal(api.headline([item('clarify'), item('clarify')]), '2 questions')
  assert.equal(api.headline([item('clarify'), item('sudo')]), '1 blocking · 2 total')
  assert.equal(api.headline([item('error'), item('sudo'), item('clarify')]), '2 blocking · 3 total')
})

test('headline is singular for one question', () => {
  const { api } = load()
  assert.equal(api.headline([item('clarify')]), '1 question')
})

test('palette items() is a function re-read per open, and is bounded', () => {
  const { plugin, sandbox } = load(Array.from({ length: 60 }, (_, i) =>
    item('clarify', { id: 'c' + i, title: 'T' + i })))
  const reg = []
  plugin.register({ contribution: (a, d) => reg.push(d) })
  const pal = reg.find(d => d.id === 'attention-radar.open')
  assert.equal(typeof pal.items, 'function', 'items must be a function, not a snapshot')
  const rows = pal.items()
  assert.ok(rows.length <= 20, 'bounded, got ' + rows.length)
  assert.equal(typeof rows[0].label, 'string')
})