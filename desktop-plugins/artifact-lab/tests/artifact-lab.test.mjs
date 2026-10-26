/**
 * artifact-lab desktop plugin — vm-harness tests.
 *
 * Reads plugin.js as text, strips the runtime specifiers, runs the module in a node:vm context and
 * pokes the real internals: the registration shape, the pair detector, the kind/format/state
 * classifiers, plus the two safety invariants the brief cares about (sandboxed frames only, theme
 * variables only — no hardcoded colors).
 */

import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')
/** Source with comments stripped — safety invariants must hold in code, not in prose. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** vm values come from another realm; normalise before structural assertions. */
const plain = (value) => JSON.parse(JSON.stringify(value))

function runtime(options = {}) {
  const atom = (value) => ({ get: () => value, set: () => undefined })
  const jsx = (type, props = {}) => ({ type, props })
  const context = {
    atom,
    jsx,
    jsxs: jsx,
    PANES_AREA: 'panes',
    PALETTE_AREA: 'palette',
    Button: (props) => (props ? props.children : null),
    Separator: () => null,
    useQuery: () => options.query || { data: null, isLoading: false, isError: false },
    useValue: (v) => (v && v.get ? v.get() : null),
    useState: (v) => [typeof v === 'function' ? v() : v, () => undefined],
    useEffect: () => undefined,
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    host: { request: () => undefined, paneVisibility: undefined },
    queryClient: { invalidateQueries: () => undefined },
    haptic: () => undefined,
    cn: (...parts) => parts.filter(Boolean).join(' '),
    console,
  }
  const code = source
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat(
      '\nglobalThis.__pure = { kindFor, stemOf, dirOf, variantBase, detectPairs, sortNewestFirst, previewModeFor, errorStateFor, shortRoot, tilde, formatSize, formatAge };\n',
    )
  vm.runInNewContext(code, context)
  return context
}

function registered() {
  const ctx = runtime()
  const entries = []
  ctx.plugin.register({ register: (item) => entries.push(item) })
  return { ctx, entries }
}

/** Render the pane's component with a stubbed query result and walk the element tree. */
function renderPane(query) {
  const ctx = runtime({ query })
  const entries = []
  ctx.plugin.register({ register: (item) => entries.push(item) })
  const pane = entries.find((e) => e.area === 'panes')
  const element = pane.render()
  return element.type(element.props)
}

function walk(node, out = []) {
  if (node == null || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (typeof node === 'object' && node.type !== undefined) {
    out.push(node)
    walk(node.props ? node.props.children : null, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node))
  return out
}

/**
 * Call every function component in the tree once (the hook stubs make this safe: they never run
 * effects or dispatch state) so nested components' text shows up in the assertions.
 */
function renderTree(node) {
  if (node == null || typeof node === 'boolean') return null
  if (Array.isArray(node)) return node.map(renderTree)
  if (typeof node === 'object' && node.type !== undefined) {
    const props = { ...(node.props || {}) }
    if (typeof node.type === 'function') {
      const out = node.type(props)
      return { type: node.type, props: { ...props, children: renderTree(out) } }
    }
    return { type: node.type, props: { ...props, children: renderTree(props.children) } }
  }
  return node
}

const textOf = (tree) => walk(renderTree(tree)).filter((n) => typeof n === 'string').join(' ')
const countType = (tree, name) =>
  walk(renderTree(tree)).filter((n) => typeof n === 'object' && typeof n.type === 'function' && n.type.name === name).length

const row = (path, mtime, kind = 'png') => ({
  path,
  name: path.split('/').pop(),
  kind,
  size: 1024,
  mtime,
  root: '/home/user/.hermes/cache/scratch',
})

const payload = (overrides = {}) => ({
  ok: true,
  window_hours: 48,
  limit: 60,
  count: 2,
  total_all: 2,
  total_in_window: 2,
  newest_iso: '2026-09-20T23:53:22+00:00',
  capped: false,
  files_seen: 20786,
  dirs_seen: 2361,
  candidates: 753,
  roots: [
    { path: '/home/user/.hermes/cache/scratch', exists: true, artifacts: 2 },
    { path: '/home/user/.hermes/artifacts', exists: false, artifacts: 0 },
  ],
  items: [row('/roots/scratch/poster-v2.png', 200), row('/roots/scratch/poster-v1.png', 100)],
  ...overrides,
})

/* ------------------------------------------------------------------ registration */

test('module exports the plugin contract', () => {
  const { ctx } = registered()
  assert.equal(ctx.plugin.id, 'artifact-lab')
  assert.equal(ctx.plugin.name, 'Artifact Lab')
  assert.equal(typeof ctx.plugin.description, 'string')
  assert.ok(ctx.plugin.description.length > 20)
  assert.equal(typeof ctx.plugin.register, 'function')
})

test('registers a right-rail pane and a palette command with unique ids', () => {
  const { entries } = registered()
  assert.equal(entries.length, 2)

  const pane = entries.find((e) => e.area === 'panes')
  assert.ok(pane, 'no pane registered')
  assert.equal(pane.id, 'bench')
  assert.equal(pane.title, 'Artifact Lab')
  assert.equal(pane.data.placement, 'right')
  assert.equal(pane.data.width, '360px')
  assert.equal(typeof pane.render, 'function')

  const command = entries.find((e) => e.area === 'palette')
  assert.ok(command, 'no palette command registered')
  assert.equal(command.data.id, 'artifact-lab.refresh')
  assert.match(command.data.label, /^Artifact Lab:/)
  assert.ok(Array.isArray(command.data.keywords) && command.data.keywords.includes('artifact'))
  assert.equal(typeof command.data.run, 'function')
  assert.doesNotThrow(() => command.data.run())

  const ids = entries.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate contribution ids')
})

test('the pane render is lazy but returns the real component element', () => {
  const { entries } = registered()
  const pane = entries.find((e) => e.area === 'panes')
  const element = pane.render()
  assert.equal(typeof element.type, 'function', 'render must hand back the component, not run it')
  assert.equal(element.type.name, 'BenchPane')
})

/* ------------------------------------------------------------------ safety invariants */

test('frames are sandboxed with allow-scripts and nothing that can steer the app', () => {
  assert.match(code, /sandbox: 'allow-scripts'/)
  for (const forbidden of ['allow-top-navigation', 'allow-same-origin', 'allow-popups', 'allow-modals', 'allow-forms']) {
    assert.equal(code.includes(forbidden), false, `frame sandbox must not grant ${forbidden}`)
  }
  assert.equal(/window\.open|shell\.open|openExternal/.test(code), false, 'guest content must never open an OS window')
})

test('colors come from theme variables only', () => {
  const hexes = code.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  assert.deepEqual(hexes, [], `hardcoded colors found: ${hexes.join(', ')}`)
  assert.ok(code.includes('var(--foreground)'))
  assert.ok(code.includes('var(--muted-foreground)'))
  assert.ok(code.includes('var(--border)'))
  assert.ok(code.includes('var(--card)'))
  assert.ok(code.includes('var(--accent)'))
})

/* ------------------------------------------------------------------ pure helpers */

test('kindFor maps the artifact extensions and rejects everything else', () => {
  const { kindFor } = runtime().__pure
  assert.equal(kindFor('poster.html'), 'html')
  assert.equal(kindFor('poster.svg'), 'svg')
  assert.equal(kindFor('notes.md'), 'md')
  assert.equal(kindFor('shot.png'), 'image')
  assert.equal(kindFor('shot.JPG'), 'image')
  assert.equal(kindFor('shot.jpeg'), 'image')
  assert.equal(kindFor('shot.webp'), 'image')
  assert.equal(kindFor('notes.txt'), null)
  assert.equal(kindFor('run.sh'), null)
  assert.equal(kindFor('binary'), null)
  assert.equal(kindFor(''), null)
  assert.equal(kindFor(undefined), null)
})

test('stemOf and dirOf split names the way the pair detector needs', () => {
  const { stemOf, dirOf } = runtime().__pure
  assert.equal(stemOf('poster-v2.png'), 'poster-v2')
  assert.equal(stemOf('notes'), 'notes')
  assert.equal(stemOf('.hidden.md'), '.hidden')
  assert.equal(dirOf('/a/b/c.html'), '/a/b')
  assert.equal(dirOf('/c.html'), '')
})

test('variantBase strips version and draft tokens, and refuses ordinary names', () => {
  const { variantBase } = runtime().__pure
  assert.equal(variantBase('poster-v1'), 'poster')
  assert.equal(variantBase('poster-v2'), 'poster')
  assert.equal(variantBase('report-final'), 'report')
  assert.equal(variantBase('draft-report'), 'report')
  assert.equal(variantBase('old_notes'), 'notes')
  assert.equal(variantBase('slide-12'), 'slide')
  assert.equal(variantBase('poster'), null)
  assert.equal(variantBase('canvas-gallery-dark'), null)
  assert.equal(variantBase('card-canvas-20260920-022712-2'), 'card-canvas-20260920-022712')
  assert.equal(variantBase('card-canvas-20260920-022717-2'), 'card-canvas-20260920-022717')
  assert.equal(variantBase('v2'), null)
  assert.equal(variantBase(''), null)
})

test('detectPairs finds real version pairs and never invents one', () => {
  const { detectPairs } = runtime().__pure
  const dir = '/roots/scratch'

  const versioned = detectPairs([
    row(`${dir}/poster-v1.png`, 100),
    row(`${dir}/poster-v2.png`, 200),
    row(`${dir}/unrelated.png`, 300),
  ])
  assert.equal(versioned.length, 1)
  assert.equal(versioned[0].a.name, 'poster-v2.png', 'the newest member leads the pair')
  assert.equal(versioned[0].b.name, 'poster-v1.png')
  assert.equal(versioned[0].label, 'poster-v2.png ↔ poster-v1.png')

  const draftFinal = detectPairs([
    row(`${dir}/draft-report.md`, 100, 'md'),
    row(`${dir}/final-report.md`, 150, 'md'),
  ])
  assert.equal(draftFinal.length, 1)
  assert.equal(draftFinal[0].b.name, 'draft-report.md')

  const plainAndVariant = detectPairs([row(`${dir}/poster.png`, 100), row(`${dir}/poster-v3.png`, 50)])
  assert.equal(plainAndVariant.length, 1)
  assert.equal(plainAndVariant[0].a.name, 'poster.png')

  // No fake pairs: single files, unrelated siblings, and same stem in different directories.
  assert.equal(detectPairs([row(`${dir}/lonely-v1.png`, 100)]).length, 0)
  assert.equal(detectPairs([row(`${dir}/a.png`, 100), row(`${dir}/b.png`, 90)]).length, 0)
  assert.equal(
    detectPairs([row(`${dir}/poster-v1.png`, 100), row(`/roots/other/poster-v2.png`, 200)]).length,
    0,
    'pairs must be same-directory',
  )
  assert.equal(detectPairs([]).length, 0)
  assert.equal(detectPairs(undefined).length, 0)
  assert.equal(
    detectPairs([row(`${dir}/canvas-gallery-dark.html`, 100, 'html'), row(`${dir}/canvas-gallery-light.html`, 90, 'html')]).length,
    0,
    'dark/light are not version tokens — do not fake a pair',
  )
})

test('detectPairs orders newest-first and respects the cap', () => {
  const { detectPairs } = runtime().__pure
  const dir = '/roots/scratch'
  // Distinct bases (letter-suffixed ids survive token stripping), two versions each.
  const many = []
  for (let i = 0; i < 12; i += 1) {
    many.push(row(`${dir}/pair-${i}b-v1.png`, 1000 + i))
    many.push(row(`${dir}/pair-${i}b-v2.png`, 1000 + i + 0.5))
  }
  const all = detectPairs(many, 12)
  assert.equal(all.length, 12, 'every distinct base is its own pair')
  const pairs = detectPairs(many, 3)
  assert.equal(pairs.length, 3)
  const mtimes = plain(pairs.map((p) => p.mtime))
  assert.deepEqual(mtimes, [...mtimes].sort((a, b) => b - a))
  assert.equal(pairs[0].a.name, 'pair-11b-v2.png')
})

test('previewModeFor picks frame / img / text', () => {
  const { previewModeFor } = runtime().__pure
  assert.equal(previewModeFor('html'), 'frame')
  assert.equal(previewModeFor('svg'), 'frame')
  assert.equal(previewModeFor('md'), 'text')
  assert.equal(previewModeFor('image'), 'img')
  assert.equal(previewModeFor(null), 'frame')
})

test('errorStateFor separates "backend not mounted" from a backend refusal', () => {
  const { errorStateFor } = runtime().__pure
  assert.equal(errorStateFor('Error invoking remote method \'hermes:api\': Error: 404: {"detail":"Not Found"}'), 'not-mounted')
  assert.equal(errorStateFor('404: {"ok":false,"error":"not a file"}'), 'refused')
  assert.equal(errorStateFor('ECONNREFUSED 127.0.0.1'), 'error')
  assert.equal(errorStateFor(''), 'error')
  assert.equal(errorStateFor(undefined), 'error')
})

test('formatSize renders bytes, kilobytes and megabytes', () => {
  const { formatSize } = runtime().__pure
  assert.equal(formatSize(0), '0 B')
  assert.equal(formatSize(512), '512 B')
  assert.equal(formatSize(2048), '2.0 kB')
  assert.equal(formatSize(15360), '15 kB')
  assert.equal(formatSize(2.5 * 1024 * 1024), '2.5 MB')
  assert.equal(formatSize(-1), '—')
  assert.equal(formatSize('nope'), '—')
})

test('formatAge renders just now / minutes / hours / days', () => {
  const { formatAge } = runtime().__pure
  const now = 1_800_000_000_000 // ms
  const secsAgo = (s) => now / 1000 - s
  assert.equal(formatAge(secsAgo(5), now), 'just now')
  assert.equal(formatAge(secsAgo(600), now), '10m ago')
  assert.equal(formatAge(secsAgo(7200), now), '2h ago')
  assert.equal(formatAge(secsAgo(3 * 86400), now), '3d ago')
  assert.equal(formatAge(0, now), '—')
  assert.equal(formatAge(undefined, now), '—')
})

test('shortRoot and tilde keep the display honest', () => {
  const { shortRoot, tilde } = runtime().__pure
  assert.equal(shortRoot('/home/user/.hermes/profiles/ops/workspace'), 'profile:ops')
  assert.equal(shortRoot('/home/user/.hermes/cache/scratch'), 'scratch')
  assert.equal(shortRoot('/home/user/.hermes/canvas'), 'canvas')
  assert.equal(shortRoot(''), '')
  assert.equal(tilde('/home/user/.hermes/cache/scratch/a.png'), '~/.hermes/cache/scratch/a.png')
  assert.equal(tilde('/etc/hostname'), '/etc/hostname')
})

test('sortNewestFirst is newest-first and stable', () => {
  const { sortNewestFirst } = runtime().__pure
  const sorted = sortNewestFirst([row('/r/b.png', 100), row('/r/a.png', 300), row('/r/c.png', 100)])
  assert.deepEqual(
    plain(sorted.map((r) => r.name)),
    ['a.png', 'b.png', 'c.png'],
  )
  assert.deepEqual(plain(sortNewestFirst(undefined)), [])
})

/* ------------------------------------------------------------------ pane render */

test('pane renders one row per artifact and the count line', () => {
  const tree = renderPane({ data: payload(), isLoading: false, isError: false })
  assert.equal(countType(tree, 'Row'), 2)
  const text = textOf(tree)
  assert.match(text, /artifact lab/)
  assert.match(text, /2 of 2/)
  assert.match(text, /20786 files seen/)
  assert.match(text, /poster-v2\.png/)
  assert.match(text, /scratch/)
})

test('compare toggle appears only when a real pair exists', () => {
  const withPair = renderPane({ data: payload(), isLoading: false, isError: false })
  assert.match(textOf(withPair), /compare 1/)

  const noPair = renderPane({
    data: payload({ items: [row('/roots/scratch/alpha.png', 200), row('/roots/scratch/beta.png', 100)] }),
    isLoading: false,
    isError: false,
  })
  assert.equal(textOf(noPair).includes('compare'), false, 'no pair -> no compare affordance')
  assert.equal(countType(noPair, 'Row'), 2)
})

test('empty scan names the roots instead of pretending', () => {
  const tree = renderPane({
    data: payload({ items: [], count: 0, total_all: 0, total_in_window: 0 }),
    isLoading: false,
    isError: false,
  })
  const text = textOf(tree)
  assert.match(text, /no artifacts in the watched roots/)
  assert.match(text, /roots scanned/)
  assert.match(text, /~\/\.hermes\/cache\/scratch/)
  assert.match(text, /~\/\.hermes\/artifacts/)
  assert.equal(countType(tree, 'Row'), 0)
})

test('an empty window offers to widen instead of claiming there is nothing', () => {
  const tree = renderPane({
    data: payload({ items: [], count: 0, total_all: 7, total_in_window: 0 }),
    isLoading: false,
    isError: false,
  })
  const text = textOf(tree)
  assert.match(text, /no artifacts in the watched roots inside the 48h window/)
  assert.match(text, /7 older artifacts exist/)
  assert.match(text, /widen to all time/)
})

test('a 404 from the backend namespace is reported as "backend not mounted yet"', () => {
  const tree = renderPane({
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error('Error invoking remote method \'hermes:api\': Error: 404: {"detail":"Not Found"}'),
  })
  const text = textOf(tree)
  assert.match(text, /backend not mounted yet/)
  assert.match(text, /plugins\.enabled/)
  assert.match(text, /retry/)
})

test('a backend refusal is quoted, not mislabelled as a missing backend', () => {
  const tree = renderPane({
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error('403: {"ok":false,"error":"path is outside the watched artifact roots"}'),
  })
  const text = textOf(tree)
  assert.match(text, /the backend refused the request/)
  assert.match(text, /path is outside the watched artifact roots/)
  assert.equal(text.includes('backend not mounted yet'), false)
})

test('a capped scan says so', () => {
  const tree = renderPane({ data: payload({ capped: true }), isLoading: false, isError: false })
  assert.match(textOf(tree), /partial scan/)
})

test('the pane text names the roots and the honest states', () => {
  assert.match(code, /backend not mounted yet/)
  assert.match(code, /no artifacts in the watched roots/)
  assert.match(code, /roots scanned/)
  assert.match(code, /partial scan/)
  assert.match(code, /refetchInterval: visible \? REFRESH_MS : false/)
})
