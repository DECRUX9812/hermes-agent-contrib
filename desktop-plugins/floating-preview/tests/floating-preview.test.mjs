/**
 * Floating Preview Panel — vm harness tests (no deps, plain node:test).
 *
 * Harness per hermes-plugin-development: strip imports, swap `export default`
 * for `globalThis.plugin`, append pure-fn exports, run in a vm context. Two
 * harnesses: a runtime one for the pure target model, and a render smoke one
 * that stubs the SDK components and walks the emitted jsx tree.
 *
 * Run: node --test tests/*.test.mjs   (the GLOB is required)
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

const EXPORTS = [
  '__normalizeTarget = normalizeTarget',
  '__compactUrl = compactUrl',
  '__byteSizeHint = byteSizeHint',
  '__kindLabel = kindLabel',
  '__isLiveTarget = isLiveTarget',
  '__webviewProps = webviewProps',
  '__targetTitle = targetTitle',
  '__targetSubtitle = targetSubtitle',
  '__formatHint = formatHint',
  '__coerceTarget = coerceTarget',
  '__handlePreviewOpen = handlePreviewOpen',
  '__pointAt = pointAt',
  '__getState = getState',
  '__atoms = { $target, $expanded, $follow, $loading, $loadError, $currentUrl, $restart }',
  '__FloatingPreviewPanel = FloatingPreviewPanel'
]

function loadPlugin(context) {
  const code = source
    .replace(/^import\s+\{[\s\S]*?\}\s+from '@hermes\/plugin-sdk'\r?\n/m, '')
    .replace(/^import .* from 'react'\r?\n/m, '')
    .replace(/^import .* from 'react\/jsx-runtime'\r?\n/m, '')
    .replace('export default {', 'globalThis.plugin = {')
    .concat(`\n${EXPORTS.map(name => `globalThis.${name};`).join('\n')}`)
  vm.runInNewContext(code, context)
  return context
}

function makeAtom(initial) {
  let value = initial
  return {
    get: () => value,
    set: next => {
      value = next
    },
    listen: () => () => undefined
  }
}

function baseContext() {
  const jsx = (type, props = {}) => ({ type, props })
  return {
    atom: makeAtom,
    jsx,
    jsxs: jsx,
    // `URL` is a Node/WHATWG global, NOT an ECMA-262 intrinsic — a bare vm
    // context lacks it and compactUrl/normalizeTarget would silently fall back.
    URL,
    console,
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => undefined } },
    host: {
      state: {
        cwd: { get: () => '', listen: () => undefined },
        activeSessionId: { get: () => null, listen: () => undefined }
      },
      onEvent: () => () => undefined,
      request: async () => ({}),
      notify: () => undefined,
      notifyError: () => undefined
    },
    window: { __floatingPreview: null }
  }
}

/** Runtime harness — pure functions only. */
function runtime() {
  return loadPlugin(baseContext())
}

/** Render smoke harness — SDK components stubbed as walkable nodes. */
function renderHarness() {
  // Function types are invoked (like React), string types become walkable nodes.
  const jsx = (type, props = {}) => (typeof type === 'function' ? type(props) : { type, props })
  const context = baseContext()
  context.jsx = jsx
  context.jsxs = jsx
  context.cn = (...args) => args.filter(Boolean).join(' ')
  context.Codicon = 'Codicon'
  context.EmptyState = props => ({ type: 'div', props: { children: [props.title, props.description] } })
  context.GlyphSpinner = 'GlyphSpinner'
  context.Input = 'Input'
  context.Tip = 'Tip'
  context.useValue = value => (value?.get ? value.get() : value)
  context.useState = value => [value, () => undefined]
  context.useCallback = fn => fn
  context.useEffect = () => undefined
  context.useRef = () => ({ current: null })
  return loadPlugin(context)
}

function textOf(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object') {
    if (node.props) {
      const extra = [node.props.placeholder, node.props.title].filter(v => typeof v === 'string').join(' ')
      return `${textOf(node.props.children ?? '')} ${extra}`.trim()
    }
    return Object.values(node).map(textOf).join(' ')
  }
  return ''
}

// ── normalizeTarget: the point-at-anything ladder ───────────────────────────

test('normalizeTarget: explicit http(s) URLs are url kind', () => {
  const ctx = runtime()
  const out = ctx.__normalizeTarget('https://cnn.com/story?q=1', '')
  assert.equal(out.kind, 'url')
  assert.equal(out.url, 'https://cnn.com/story?q=1')
  assert.equal(out.source, 'https://cnn.com/story?q=1')

  const http = ctx.__normalizeTarget('http://127.0.0.1:8080', '')
  assert.equal(http.kind, 'url')
  assert.equal(http.url, 'http://127.0.0.1:8080')
})

test('normalizeTarget: localhost ladder becomes http', () => {
  const ctx = runtime()
  for (const raw of ['localhost:3000', 'localhost:3000/', '127.0.0.1:5173', 'localhost:3000/app']) {
    const out = ctx.__normalizeTarget(raw, '')
    assert.equal(out.kind, 'url', raw)
    assert.ok(out.url.startsWith('http://'), `${raw} -> ${out.url}`)
  }
})

test('normalizeTarget: file: URLs and absolute paths are file kind', () => {
  const ctx = runtime()
  const fileUrl = ctx.__normalizeTarget('file:///tmp/a.html', '')
  assert.equal(fileUrl.kind, 'file')
  assert.equal(fileUrl.previewKind, 'html')
  assert.equal(fileUrl.path, '/tmp/a.html')

  const abs = ctx.__normalizeTarget('/srv/index.html', '')
  assert.equal(abs.kind, 'file')
  assert.equal(abs.path, '/srv/index.html')

  const rel = ctx.__normalizeTarget('./notes.md', '')
  assert.equal(rel.kind, 'file')
})

test('normalizeTarget: relative paths join the cwd', () => {
  const ctx = runtime()
  const out = ctx.__normalizeTarget('src/store/preview.ts', '/home/me/app')
  assert.equal(out.kind, 'file')
  assert.equal(out.path, '/home/me/app/src/store/preview.ts')
  assert.equal(out.previewKind, 'text')
})

test('normalizeTarget: bare domains become https; empty input is null', () => {
  const ctx = runtime()
  const domain = ctx.__normalizeTarget('www.cnn.com', '')
  assert.equal(domain.kind, 'url')
  assert.equal(domain.url, 'https://www.cnn.com')

  const tld = ctx.__normalizeTarget('example.org:8080/path', '')
  assert.equal(tld.url, 'https://example.org:8080/path')

  assert.equal(ctx.__normalizeTarget('', ''), null)
  assert.equal(ctx.__normalizeTarget('   ', ''), null)
  assert.equal(ctx.__normalizeTarget(undefined, ''), null)
})

test('normalizeTarget: backticked input is stripped', () => {
  const ctx = runtime()
  const out = ctx.__normalizeTarget('`https://example.com/x`', '')
  assert.equal(out.url, 'https://example.com/x')
})

// ── compactUrl / byteSizeHint / kindLabel ───────────────────────────────────

test('compactUrl: host+path+search for http, decoded path for file:', () => {
  const ctx = runtime()
  assert.equal(ctx.__compactUrl('https://example.com/a/b?q=1'), 'example.com/a/b?q=1')
  assert.equal(ctx.__compactUrl('file:///tmp/hello%20world.html'), '/tmp/hello world.html')
  assert.equal(ctx.__compactUrl('not a url'), 'not a url')
})

test('byteSizeHint: formats and stays quiet for unknown sizes', () => {
  const ctx = runtime()
  assert.equal(ctx.__byteSizeHint(512), '512 B')
  assert.equal(ctx.__byteSizeHint(1234), '1.2 KB')
  assert.equal(ctx.__byteSizeHint(5 * 1024 * 1024), '5.0 MB')
  assert.equal(ctx.__byteSizeHint(undefined), '')
  assert.equal(ctx.__byteSizeHint(-1), '')
})

test('kindLabel maps the three kinds', () => {
  const ctx = runtime()
  assert.equal(ctx.__kindLabel('url'), 'URL')
  assert.equal(ctx.__kindLabel('file'), 'FILE')
  assert.equal(ctx.__kindLabel('artifact'), 'ARTIFACT')
  assert.equal(ctx.__kindLabel('bogus'), 'PREVIEW')
})

// ── the preview-infra reuse invariants ──────────────────────────────────────

test('isLiveTarget: url and html files render live; others are cards', () => {
  const ctx = runtime()
  assert.equal(ctx.__isLiveTarget({ kind: 'url', url: 'https://x.com' }), true)
  assert.equal(ctx.__isLiveTarget({ kind: 'file', previewKind: 'html', url: 'file:///a.html' }), true)
  assert.equal(ctx.__isLiveTarget({ kind: 'file', previewKind: 'text', url: 'file:///a.tsx' }), false)
  assert.equal(ctx.__isLiveTarget({ kind: 'artifact', url: 'id' }), false)
  assert.equal(ctx.__isLiveTarget(null), false)
})

test('webviewProps reuses the core preview partition and stays sandboxed', () => {
  const ctx = runtime()
  const props = ctx.__webviewProps({ kind: 'url', url: 'https://example.com' })
  assert.equal(props.partition, 'persist:hermes-preview')
  assert.equal(props.src, 'https://example.com')
  assert.ok(props.webpreferences.includes('sandbox=yes'))
  assert.ok(props.webpreferences.includes('nodeIntegration=no'))
})

test('targetTitle/targetSubtitle/formatHint summarize the target', () => {
  const ctx = runtime()
  const url = ctx.__normalizeTarget('https://example.com/a/b', '')
  assert.equal(ctx.__targetTitle(url), 'b')
  assert.equal(ctx.__targetSubtitle(url), 'example.com/a/b')
  assert.equal(ctx.__formatHint(url), 'LIVE')

  const file = ctx.__normalizeTarget('/tmp/x.tsx', '')
  assert.equal(ctx.__formatHint(file), 'TEXT')

  const html = ctx.__normalizeTarget('/tmp/x.html', '')
  assert.equal(ctx.__formatHint(html), 'HTML')
})

// ── coerceTarget: accept already-normalized targets ─────────────────────────

test('coerceTarget validates object targets and fills defaults', () => {
  const ctx = runtime()
  const good = ctx.__coerceTarget({ kind: 'artifact', label: 'Chart', url: 'artifact:123' })
  assert.equal(good.kind, 'artifact')
  assert.equal(good.label, 'Chart')
  assert.equal(good.source, 'artifact:123')

  assert.equal(ctx.__coerceTarget({ kind: 'nope', url: 'x' }), null)
  assert.equal(ctx.__coerceTarget({ kind: 'url' }), null)
  assert.equal(ctx.__coerceTarget(null), null)
  assert.equal(ctx.__coerceTarget('https://x.com'), null)
})

// ── pointAt / handlePreviewOpen ─────────────────────────────────────────────

test('pointAt: string input normalizes and lands in state (compact first)', () => {
  const ctx = runtime()
  const ok = ctx.__pointAt('https://example.com')
  assert.equal(ok, true)
  const state = ctx.__getState()
  assert.equal(state.target.kind, 'url')
  assert.equal(state.target.url, 'https://example.com')
  assert.equal(state.expanded, false) // collapsed-by-default + expand-to-inspect
  assert.equal(state.loadError, null)
})

test('pointAt: object input is accepted; junk returns false without touching state', () => {
  const ctx = runtime()
  assert.equal(ctx.__pointAt({ kind: 'url', label: 'Doc', url: 'https://example.com/doc' }), true)
  assert.equal(ctx.__getState().target.label, 'Doc')
  assert.equal(ctx.__pointAt(''), false)
  assert.equal(ctx.__pointAt({ kind: 'bogus', url: 'x' }), false)
  assert.equal(ctx.__getState().target.label, 'Doc') // unchanged
})

test('handlePreviewOpen: mirrors preview.open events when following', () => {
  const ctx = runtime()
  const target = ctx.__handlePreviewOpen({ url: 'localhost:3000', label: 'Dev server' })
  assert.ok(target)
  assert.equal(target.kind, 'url')
  assert.equal(target.url, 'http://localhost:3000')
  assert.equal(target.label, 'Dev server')
  assert.equal(ctx.__getState().target.url, 'http://localhost:3000')

  // No churn: re-opening the same target does not replace the state object.
  const before = ctx.__getState().target
  const again = ctx.__handlePreviewOpen({ url: 'localhost:3000' })
  assert.ok(again)
  assert.equal(ctx.__getState().target, before)
})

test('handlePreviewOpen: empty url is ignored; follow=false blocks mirroring', () => {
  const ctx = runtime()
  assert.equal(ctx.__handlePreviewOpen({ url: '   ' }), null)
  assert.equal(ctx.__handlePreviewOpen({}), null)
  assert.equal(ctx.__handlePreviewOpen(null), null)

  ctx.__atoms.$follow.set(false)
  assert.equal(ctx.__handlePreviewOpen({ url: 'https://cnn.com' }), null)
  assert.equal(ctx.__getState().target, null)
})

// ── render smoke ────────────────────────────────────────────────────────────

test('render: empty state before anything is pointed at', () => {
  const ctx = renderHarness()
  const node = ctx.__FloatingPreviewPanel()
  const text = textOf(node)
  assert.match(text, /Nothing previewed yet/)
  assert.match(text, /URL, file path, or localhost:3000/) // the input placeholder
  assert.match(text, /Follow/)
})

test('render: compact tile shows label, compact url, and LIVE hint', () => {
  const ctx = renderHarness()
  assert.equal(ctx.__pointAt('https://example.com/a/b'), true)
  const text = textOf(ctx.__FloatingPreviewPanel())
  assert.match(text, /b/) // basename label
  assert.match(text, /example\.com\/a\/b/)
  assert.match(text, /LIVE/)
  assert.match(text, /URL/) // kind pill
})

test('render: expanding a url target shows the live-details chrome', () => {
  const ctx = renderHarness()
  ctx.__pointAt('https://example.com')
  ctx.__atoms.$expanded.set(true)
  const text = textOf(ctx.__FloatingPreviewPanel())
  assert.match(text, /example\.com/)
  assert.match(text, /Reload/)
  assert.match(text, /Open in browser/)
})

test('render: load errors surface with retry + restart affordances', () => {
  const ctx = renderHarness()
  ctx.__pointAt('https://example.com')
  ctx.__atoms.$expanded.set(true)
  ctx.__atoms.$loadError.set({ code: -105, description: 'ERR_NAME_NOT_RESOLVED' })
  const text = textOf(ctx.__FloatingPreviewPanel())
  assert.match(text, /ERR_NAME_NOT_RESOLVED/)
  assert.match(text, /Retry/)
  assert.match(text, /Ask Hermes to restart/)
})

test('render: a text-file target expands to the file card, not a webview', () => {
  const ctx = renderHarness()
  ctx.__pointAt('/tmp/notes.md')
  ctx.__atoms.$expanded.set(true)
  const text = textOf(ctx.__FloatingPreviewPanel())
  assert.match(text, /notes\.md/)
  assert.match(text, /Reveal in file manager/)
  assert.match(text, /Copy path/)
  assert.doesNotMatch(text, /Reload/)
})

test('render: closing clears the panel back to the empty state', () => {
  const ctx = renderHarness()
  ctx.__pointAt('https://example.com')
  ctx.__atoms.$target.set(null)
  const text = textOf(ctx.__FloatingPreviewPanel())
  assert.match(text, /Nothing previewed yet/)
})

// ── register: the contribution contract + event wiring ──────────────────────

test('register: mounts a floating pane contribution and the global door', () => {
  const ctx = baseContext()
  const contributions = []
  const disposers = []
  const win = { __floatingPreview: null }
  ctx.window = win
  ctx.register = contribution => {
    contributions.push(contribution)
    return () => undefined
  }
  ctx.onDispose = fn => {
    disposers.push(fn)
  }
  ctx.storage = { get: () => null, set: () => undefined }
  ctx.os = { revealPath: async () => true, openExternal: async () => true, writeClipboard: async () => true }
  loadPlugin(ctx)

  assert.equal(typeof ctx.plugin.register, 'function')
  ctx.plugin.register(ctx)

  const pane = contributions.find(c => c.id === 'panel')
  assert.ok(pane, 'panel contribution registered')
  assert.equal(pane.area, 'panes')
  assert.equal(pane.data.placement, 'floating')
  assert.equal(pane.data.anchor, 'top-right')
  assert.equal(pane.data.width, '360px')
  assert.equal(typeof pane.render, 'function')

  assert.equal(typeof win.__floatingPreview.pointAt, 'function')
  assert.equal(disposers.length, 1)

  // Disposing must not throw (event disposers + restore are all optional).
  disposers[0]()
})

test('register: restores the last pointed-at target from storage', () => {
  const ctx = baseContext()
  const win = { __floatingPreview: null }
  ctx.window = win
  ctx.register = () => () => undefined
  ctx.onDispose = () => undefined
  ctx.storage = { get: (key, fallback) => (key === 'last-target' ? 'https://cnn.com' : fallback), set: () => undefined }
  ctx.os = { revealPath: async () => true, openExternal: async () => true, writeClipboard: async () => true }
  loadPlugin(ctx)
  ctx.plugin.register(ctx)

  const state = ctx.__getState()
  assert.equal(state.target.kind, 'url')
  assert.equal(state.target.url, 'https://cnn.com')
  assert.equal(state.expanded, false)
})
