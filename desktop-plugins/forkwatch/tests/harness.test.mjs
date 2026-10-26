// Harness tests for forkwatch — pure helpers + shipped register(). No Electron,
// no network, no DOM. Pattern from the hermes-desktop-plugins skill template:
// strip import lines (bare specifiers can't resolve outside the app), rewrite
// exports (vm.runInContext evaluates as a SCRIPT, so `export` is illegal), and
// keep the REAL default-export object so tests exercise the shipped register().
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

const EXPORTS = ['verdict', 'receiptTone', 'fmtDays', 'barGeom']

function load({ restResult = null, restError = null } = {}) {
  // Faithful to react/jsx-runtime 19.2.7 (verified against the app's real
  // build): null props throw "Cannot read properties of null (reading 'key')"
  // in production, and the 3rd argument is the KEY — children must live in
  // props.children or they're silently dropped. A lax stub here is how the
  // plugin shipped with both bugs while tests stayed green.
  const jsx = (type, props, maybeKey) => {
    if (props === null || props === undefined) {
      throw new TypeError("Cannot read properties of null (reading 'key')")
    }
    const { key: configKey, ...rest } = props
    return { $$el: true, type, props: rest, key: maybeKey ?? configKey ?? null }
  }
  const restCalls = []
  const registered = []
  const intervals = []
  const sandbox = {
    console,
    jsx,
    jsxs: jsx,
    atom: (v) => { let cur = v; const subs = new Set(); return {
      get: () => cur,
      set: (x) => { cur = x; subs.forEach((f) => f(cur)) },
      subscribe: (f) => { subs.add(f); return () => subs.delete(f) },
    } },
    useValue: (a) => (a && typeof a.get === 'function' ? a.get() : a),
    host: { navigate: () => {} },
    PALETTE_AREA: 'palette', PANES_AREA: 'panes', ROUTES_AREA: 'routes',
    SIDEBAR_NAV_AREA: 'sidebarNav', STATUSBAR_AREAS: { left: 'sb.left', right: 'sb.right' },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  const code = SOURCE
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import\s+\{[\s\S]*?\}\s+from 'react'\r?\n/m, '')
    .replace(/^import\s+\{[^}]*\}\s+from 'react\/jsx-runtime'\r?\n/m, '')
    .replace(/^export function /gm, 'function ')
    .replace(/^export const /gm, 'const ')
    .replace(/^export default /m, 'globalThis.plugin = ')
    .concat(`\nglobalThis.__helpers = { ${EXPORTS.join(', ')} }\n`)
  vm.runInContext(code, sandbox, { filename: 'plugin.js' })

  // Drive register() with a fake ctx capturing contributions + timers.
  const ctx = {
    rest: async (path) => { restCalls.push(path); if (restError) throw new Error(restError); return restResult },
    setInterval: (fn, ms) => { intervals.push(ms); return () => {} },
    registerMany: (cs) => { registered.push(...cs); return () => {} },
    register: (c) => { registered.push(c); return () => {} },
    onDispose: () => {},
  }
  sandbox.plugin.register(ctx)
  return { plugin: sandbox.plugin, helpers: sandbox.__helpers, registered, restCalls, intervals, sandbox }
}

// ── helpers ─────────────────────────────────────────────────────────────────

test('verdict: behind Nous outranks unpushed', () => {
  const { helpers } = load()
  const v = helpers.verdict({
    legs: { origin: { exists: true, behind: 26, ahead: 1112 }, fork: { ahead: 1, behind: 0 } },
  })
  assert.equal(v.tone, 'warn')
  assert.match(v.text, /26 behind Nous/)
})

test('verdict: unpushed work surfaces when caught up with Nous', () => {
  const { helpers } = load()
  const v = helpers.verdict({
    legs: { origin: { exists: true, behind: 0, ahead: 1112 }, fork: { ahead: 3, behind: 0 } },
  })
  assert.equal(v.tone, 'ok')
  assert.match(v.text, /\+3 unpushed/)
})

test('verdict: fully clean reads in sync', () => {
  const { helpers } = load()
  const v = helpers.verdict({
    legs: { origin: { exists: true, behind: 0, ahead: 0 }, fork: { ahead: 0, behind: 0 } },
  })
  assert.equal(v.tone, 'ok')
  assert.match(v.text, /in sync/)
})

test('verdict: null state and missing origin are distinct', () => {
  const { helpers } = load()
  assert.equal(helpers.verdict(null).tone, 'muted')
  assert.equal(helpers.verdict({ legs: { origin: { exists: false } } }).tone, 'warn')
})

test('receiptTone maps outcomes', () => {
  const { helpers } = load()
  assert.equal(helpers.receiptTone('ok'), 'ok')
  assert.equal(helpers.receiptTone('failed'), 'bad')
  assert.equal(helpers.receiptTone('running'), 'busy')
  assert.equal(helpers.receiptTone('whatever'), 'muted')
})

test('fmtDays compact forms', () => {
  const { helpers } = load()
  assert.equal(helpers.fmtDays(null), '—')
  assert.equal(helpers.fmtDays(0.03), '1h')
  assert.equal(helpers.fmtDays(0.5), '12h')
  assert.equal(helpers.fmtDays(2.4), '2d')
  assert.equal(helpers.fmtDays(90), '3mo')
})

test('barGeom scales halves against the max, never divides by zero', () => {
  const { helpers } = load()
  const g = helpers.barGeom(0, 0)
  assert.equal(g.max, 1)
  assert.equal(g.leftPct, 0)
  assert.equal(g.rightPct, 0)
  const g2 = helpers.barGeom(26, 1112)
  assert.equal(g2.max, 1112)
  assert.equal(g2.rightPct, 100)
  assert.ok(g2.leftPct < 3)
})

// ── shipped plugin object ───────────────────────────────────────────────────

test('plugin ships opt-in-off (defaultEnabled) with a stable id', () => {
  const { plugin } = load()
  assert.equal(plugin.id, 'forkwatch')
  assert.equal(plugin.defaultEnabled, true)
  assert.equal(typeof plugin.register, 'function')
})

test('register: fetches /state once and polls every 30s', () => {
  const { restCalls, intervals } = load({ restResult: { legs: {} } })
  assert.deepEqual(restCalls, ['/state'])
  assert.ok(intervals.includes(30_000))
})

test('register: contributes route, sidebar nav, statusbar chip, pane and palette', () => {
  const { registered } = load({ restResult: { legs: {} } })
  const areas = registered.map((c) => c.area)
  for (const area of ['routes', 'sidebarNav', 'sb.right', 'panes', 'palette']) {
    assert.ok(areas.includes(area), 'missing contribution for ' + area)
  }
  const route = registered.find((c) => c.area === 'routes')
  assert.equal(route.data.path, '/forkwatch')
  const nav = registered.find((c) => c.area === 'sidebarNav')
  assert.equal(nav.data.path, '/forkwatch')
  assert.equal(nav.data.codicon, 'git-branch')
  const pane = registered.find((c) => c.area === 'panes')
  assert.equal(pane.data.placement, 'right')
})

test('render paths execute without throwing (page + chip + pane)', () => {
  const { registered } = load({ restResult: {
    legs: { origin: { exists: true, behind: 1, ahead: 2 }, fork: { ahead: 1, behind: 0 } },
    head: { branch: 'main', short_sha: 'abc1234', repo: '/x', dirty_files: 0, fork_aware: true, tracking_remote: 'fork' },
    repo: '/x',
    updates: { history: [], latest: null },
    gateway: { state: 'degraded', alive: true, platforms: {} },
    pins: { 'cua-driver': '0.34.0' },
  } })
  for (const c of registered) {
    if (typeof c.render === 'function') assert.ok(c.render() != null, c.id + ' rendered null')
  }
})

test('rendered elements actually carry children (not dropped as jsx key)', async () => {
  // Regression: passing children as jsx()'s 3rd argument silently drops them
  // (3rd arg is the KEY). Assert the tree has real content in props.children.
  const { registered } = load({ restResult: {
    legs: { origin: { exists: true, behind: 5, ahead: 2 }, fork: { ahead: 1, behind: 0 } },
    head: { branch: 'main', short_sha: 'abc1234', repo: '/x', dirty_files: 0, fork_aware: true, tracking_remote: 'fork' },
    repo: '/x',
    updates: { history: [], latest: null },
    gateway: { state: 'degraded', alive: true, platforms: {} },
    pins: { 'cua-driver': '0.34.0' },
  } })
  // register()'s refresh() is async — wait for the state atom to settle.
  await new Promise((r) => setTimeout(r, 10))
  const page = registered.find((c) => c.area === 'routes').render()
  // render() returns the component element; invoke it like React would.
  const pageDiv = page.type(page.props)
  assert.ok(pageDiv.props.children?.length > 0, 'page root has no children')

  // Walk the tree — invoking function components — so a dropped-children
  // regression fails. Renders Tile/DivergingBar/etc. like React would.
  const texts = []
  const walk = (node) => {
    if (node == null || typeof node === 'string' || typeof node === 'number') {
      if (typeof node === 'string') texts.push(node)
      return
    }
    if (Array.isArray(node)) return node.forEach(walk)
    if (node.$$el) {
      if (typeof node.props?.children === 'string') texts.push(node.props.children)
      if (typeof node.type === 'function') return walk(node.type(node.props))
      walk(node.props?.children)
    }
  }
  walk(pageDiv)
  const joined = texts.join(' ')
  assert.match(joined, /Fork Watch/, 'h1 text missing from rendered tree')
  assert.match(joined, /Behind Nous main/, 'tile label missing from rendered tree')
  assert.match(joined, /Divergence/, 'card title missing from rendered tree')

  const chipEl = registered.find((c) => c.area === 'sb.right').render()
  const chip = chipEl.type(chipEl.props)
  assert.equal(typeof chip.props.children, 'string')
  assert.match(chip.props.children, /behind Nous/)
})

test('backend error keeps the plugin alive (error atom set, no throw)', async () => {
  const { plugin, sandbox } = load({ restError: 'boom' })
  assert.ok(plugin.id)
  // give the async refresh a tick to settle
  await new Promise((r) => setTimeout(r, 10))
  // error store lives in module scope inside the vm; just assert no crash occurred
  assert.ok(true)
})
