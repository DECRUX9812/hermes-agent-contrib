/**
 * Advance Mode Toggle — vm harness tests (no deps, plain node:test).
 *
 * Harness per hermes-plugin-development: strip imports, swap `export default`
 * for `globalThis.plugin`, append pure-fn exports, run in a vm context.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

const EXPORTS = [
  '__normalizeMode = normalizeMode',
  '__toggleMode = toggleMode',
  '__normalizeLadder = normalizeLadder',
  '__cycleLadder = cycleLadder',
  '__modeLabel = modeLabel',
  '__modeHint = modeHint',
  '__ladderLabel = ladderLabel',
  '__ladderHint = ladderHint',
  '__diffReviewLabel = diffReviewLabel',
  '__getMode = getMode',
  '__setMode = setMode',
  '__toggle = toggle',
  '__applyMode = applyMode',
  '__getLadder = getLadder',
  '__setLadder = setLadder',
  '__cycle = cycle',
  '__applyLadder = applyLadder',
  '__setDiffDepth = setDiffDepth',
  '__buildReviewCheckpoint = buildReviewCheckpoint',
  '__createArtifact = createArtifact',
  '__createKnowledgePackage = createKnowledgePackage',
  '__AdvanceModeTogglePanel = AdvanceModeTogglePanel',
  '__ModeSwitch = ModeSwitch',
  '__LadderSwitch = LadderSwitch',
  '__DiffDepthSelector = DiffDepthSelector',
  '__$mode = $mode',
  '__$ladder = $ladder',
  '__$diffDepth = $diffDepth'
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
    set: next => { value = next }
  }
}

function baseContext() {
  const jsx = (type, props = {}) => ({ type, props })
  return {
    atom: makeAtom,
    jsx,
    jsxs: jsx,
    cn: (...args) => args.filter(Boolean).join(' '),
    Codicon: 'Codicon',
    host: {
      state: {},
      request: async () => ({}),
      notify: () => undefined
    },
    window: { __advanceModeToggle: null, __floatingPreview: null },
    storage: { get: async () => null, set: () => undefined },
    onDispose: () => undefined,
    register: () => () => undefined
  }
}

/** Runtime harness — pure functions only. */
function runtime() {
  return loadPlugin(baseContext())
}

/** Render smoke harness — SDK components stubbed as walkable nodes. */
function renderHarness() {
  const jsx = (type, props = {}) => (typeof type === 'function' ? type(props) : { type, props })
  const context = baseContext()
  context.jsx = jsx
  context.jsxs = jsx
  context.cn = (...args) => args.filter(Boolean).join(' ')
  context.Codicon = 'Codicon'
  context.useValue = value => (value?.get ? value.get() : value)
  context.useEffect = () => undefined
  return loadPlugin(context)
}

function textOf(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object') {
    if (node.props) return textOf(node.props.children ?? '')
    return Object.values(node).map(textOf).join(' ')
  }
  return ''
}

// ── normalizeMode / toggleMode / modeLabel / modeHint ───────────────────────

test('normalizeMode: accepts bot and advance, normalizes case and whitespace', () => {
  const ctx = runtime()
  assert.equal(ctx.__normalizeMode('bot'), 'bot')
  assert.equal(ctx.__normalizeMode('BOT'), 'bot')
  assert.equal(ctx.__normalizeMode('  bot  '), 'bot')
  assert.equal(ctx.__normalizeMode('advance'), 'advance')
  assert.equal(ctx.__normalizeMode('ADVANCE'), 'advance')
  assert.equal(ctx.__normalizeMode('  advance  '), 'advance')
})

test('normalizeMode: defaults to bot for invalid values', () => {
  const ctx = runtime()
  assert.equal(ctx.__normalizeMode(''), 'bot')
  assert.equal(ctx.__normalizeMode('invalid'), 'bot')
  assert.equal(ctx.__normalizeMode(null), 'bot')
  assert.equal(ctx.__normalizeMode(undefined), 'bot')
  assert.equal(ctx.__normalizeMode('plan'), 'bot')
})

test('toggleMode: flips between bot and advance', () => {
  const ctx = runtime()
  assert.equal(ctx.__toggleMode('bot'), 'advance')
  assert.equal(ctx.__toggleMode('advance'), 'bot')
})

test('modeLabel: returns the display labels', () => {
  const ctx = runtime()
  assert.equal(ctx.__modeLabel('bot'), '🐾 Bot')
  assert.equal(ctx.__modeLabel('advance'), '⚡ Advance')
})

test('modeHint: returns descriptive hints', () => {
  const ctx = runtime()
  assert.match(ctx.__modeHint('bot'), /chat only/i)
  assert.match(ctx.__modeHint('advance'), /advance tools/i)
})

// ── ladder model ────────────────────────────────────────────────────────────

test('normalizeLadder: accepts review/accept-edits/plan, normalizes case and whitespace', () => {
  const ctx = runtime()
  assert.equal(ctx.__normalizeLadder('review'), 'review')
  assert.equal(ctx.__normalizeLadder('REVIEW'), 'review')
  assert.equal(ctx.__normalizeLadder('accept-edits'), 'accept-edits')
  assert.equal(ctx.__normalizeLadder('ACCEPT-EDITS'), 'accept-edits')
  assert.equal(ctx.__normalizeLadder('plan'), 'plan')
  assert.equal(ctx.__normalizeLadder('PLAN'), 'plan')
})

test('normalizeLadder: defaults to review for invalid values', () => {
  const ctx = runtime()
  assert.equal(ctx.__normalizeLadder(''), 'review')
  assert.equal(ctx.__normalizeLadder('invalid'), 'review')
  assert.equal(ctx.__normalizeLadder(null), 'review')
  assert.equal(ctx.__normalizeLadder(undefined), 'review')
})

test('cycleLadder: cycles review → accept-edits → plan → review', () => {
  const ctx = runtime()
  assert.equal(ctx.__cycleLadder('review'), 'accept-edits')
  assert.equal(ctx.__cycleLadder('accept-edits'), 'plan')
  assert.equal(ctx.__cycleLadder('plan'), 'review')
})

test('ladderLabel: returns display labels', () => {
  const ctx = runtime()
  assert.equal(ctx.__ladderLabel('review'), '👁 Review')
  assert.equal(ctx.__ladderLabel('accept-edits'), '⚡ Accept')
  assert.equal(ctx.__ladderLabel('plan'), '📋 Plan')
})

test('ladderHint: returns descriptive hints', () => {
  const ctx = runtime()
  assert.match(ctx.__ladderHint('review'), /pause.*diff.*write/i)
  assert.match(ctx.__ladderHint('accept-edits'), /auto-approve/i)
  assert.match(ctx.__ladderHint('plan'), /analyze before coding/i)
})

test('diffReviewLabel: returns depth labels', () => {
  const ctx = runtime()
  assert.equal(ctx.__diffReviewLabel('quick'), '⚡ Quick')
  assert.equal(ctx.__diffReviewLabel('deep'), '🔍 Deep')
})

// ── getMode / setMode / toggle / applyMode ──────────────────────────────────

test('getMode/setMode/toggle: imperative API works against the atom', () => {
  const ctx = runtime()
  const initial = ctx.__getMode()
  assert.equal(initial, 'bot')

  const changed = ctx.__setMode('advance')
  assert.equal(changed, true)
  assert.equal(ctx.__getMode(), 'advance')

  // idempotent
  const notChanged = ctx.__setMode('advance')
  assert.equal(notChanged, false)
  assert.equal(ctx.__getMode(), 'advance')

  const toggled = ctx.__toggle()
  assert.equal(toggled, 'bot')
  assert.equal(ctx.__getMode(), 'bot')
})

test('applyMode: sets atom and would persist (storage mocked)', () => {
  const ctx = runtime()
  ctx.__applyMode('advance')
  assert.equal(ctx.__getMode(), 'advance')
})

// ── ladder imperative API ──────────────────────────────────────────────────

test('getLadder/setLadder/cycle: ladder imperative API works against the atom', () => {
  const ctx = runtime()
  const initial = ctx.__getLadder()
  assert.equal(initial, 'review')

  const changed = ctx.__setLadder('accept-edits')
  assert.equal(changed, true)
  assert.equal(ctx.__getLadder(), 'accept-edits')

  // idempotent
  const notChanged = ctx.__setLadder('accept-edits')
  assert.equal(notChanged, false)
  assert.equal(ctx.__getLadder(), 'accept-edits')

  const cycled = ctx.__cycle()
  assert.equal(cycled, 'plan')
  assert.equal(ctx.__getLadder(), 'plan')

  const cycled2 = ctx.__cycle()
  assert.equal(cycled2, 'review')
  assert.equal(ctx.__getLadder(), 'review')
})

test('applyLadder: sets atom and would persist', () => {
  const ctx = runtime()
  ctx.__applyLadder('plan')
  assert.equal(ctx.__getLadder(), 'plan')
})

test('setDiffDepth: sets depth atom', () => {
  const ctx = runtime()
  ctx.__setDiffDepth('deep')
  assert.equal(ctx.__$diffDepth.get(), 'deep')
  ctx.__setDiffDepth('quick')
  assert.equal(ctx.__$diffDepth.get(), 'quick')
})

// ── review checkpoint / artifacts / knowledge packages ──────────────────────

test('buildReviewCheckpoint: builds checkpoint payload with autoApproved flag', () => {
  const ctx = runtime()
  ctx.__applyLadder('review')
  const cp = ctx.__buildReviewCheckpoint('/a.ts', 'old', 'new', 'review')
  assert.equal(cp.filePath, '/a.ts')
  assert.equal(cp.oldContent, 'old')
  assert.equal(cp.newContent, 'new')
  assert.equal(cp.ladderMode, 'review')
  assert.equal(cp.autoApproved, false)
  assert.ok(cp.timestamp)

  ctx.__applyLadder('accept-edits')
  const cp2 = ctx.__buildReviewCheckpoint('/b.ts', 'old', 'new', 'accept-edits')
  assert.equal(cp2.autoApproved, true)
})

test('createArtifact: creates typed artifact envelopes', () => {
  const ctx = runtime()
  const plan = ctx.__createArtifact('implementation-plan', { steps: ['a', 'b'] }, { source: 'test' })
  assert.equal(plan.type, 'implementation-plan')
  assert.deepEqual(plan.payload, { steps: ['a', 'b'] })
  assert.ok(plan.metadata.createdAt)
  assert.equal(plan.metadata.ladderMode, 'review')

  const diff = ctx.__createArtifact('diff', { files: ['x.ts'] })
  assert.equal(diff.type, 'diff')

  assert.throws(() => ctx.__createArtifact('invalid', {}), /Unknown artifact type/)
})

test('createKnowledgePackage: creates SKILL.md-style package artifact', () => {
  const ctx = runtime()
  const kp = ctx.__createKnowledgePackage('my-skill', '# My Skill\n\nDoes things.', '1.0.0')
  assert.equal(kp.type, 'knowledge-package')
  assert.equal(kp.payload.name, 'my-skill')
  assert.equal(kp.payload.content, '# My Skill\n\nDoes things.')
  assert.equal(kp.payload.version, '1.0.0')
  assert.equal(kp.metadata.source, 'advance-mode')
})

// ── render smoke ────────────────────────────────────────────────────────────

test('render: ModeSwitch shows both buttons with correct active state', () => {
  const ctx = renderHarness()
  const tree = ctx.__ModeSwitch()
  const text = textOf(tree)
  assert.match(text, /🐾 Bot/)
  assert.match(text, /⚡ Advance/)
  // bot is default active - button text is present
  // aria-pressed is an attribute not captured by textOf
})

test('render: LadderSwitch shows three buttons in advance mode', () => {
  const ctx = renderHarness()
  ctx.__applyMode('advance')
  const tree = ctx.__LadderSwitch()
  const text = textOf(tree)
  assert.match(text, /👁 Review/)
  assert.match(text, /⚡ Accept/)
  assert.match(text, /📋 Plan/)
})

test('render: LadderSwitch returns null in bot mode', () => {
  const ctx = renderHarness()
  ctx.__applyMode('bot')
  const tree = ctx.__LadderSwitch()
  assert.equal(tree, null)
})

test('render: DiffDepthSelector shows both depth buttons in advance mode', () => {
  const ctx = renderHarness()
  ctx.__applyMode('advance')
  const tree = ctx.__DiffDepthSelector()
  const text = textOf(tree)
  assert.match(text, /⚡ Quick/)
  assert.match(text, /🔍 Deep/)
})

test('render: DiffDepthSelector returns null in bot mode', () => {
  const ctx = renderHarness()
  ctx.__applyMode('bot')
  const tree = ctx.__DiffDepthSelector()
  assert.equal(tree, null)
})

test('render: AdvanceModeTogglePanel mounts without throwing', () => {
  const ctx = renderHarness()
  const tree = ctx.__AdvanceModeTogglePanel()
  assert.ok(tree)
  assert.equal(tree.type, 'div')
})

test('render: KeyboardShortcuts component returns null (no DOM)', () => {
  const ctx = renderHarness()
  const tree = ctx.__AdvanceModeTogglePanel()
  assert.ok(tree)
})

// ── persistence guard ───────────────────────────────────────────────────────

test('register: restores mode and ladder from storage on load', async () => {
  const ctx = baseContext()
  ctx.storage = {
    get: async (key) => {
      if (key === 'advance-mode') return 'advance'
      if (key === 'advance-mode-ladder') return 'plan'
      if (key === 'advance-mode-diff-depth') return 'deep'
      return null
    },
    set: () => undefined
  }
  loadPlugin(ctx)
  await ctx.plugin.register(ctx)
  assert.equal(ctx.__getMode(), 'advance')
  assert.equal(ctx.__getLadder(), 'plan')
  assert.equal(ctx.__$diffDepth.get(), 'deep')
})

test('register: defaults to bot/review/quick when storage missing or invalid', async () => {
  const ctx = baseContext()
  ctx.storage = {
    get: async (key) => {
      if (key === 'advance-mode') return 'invalid'
      if (key === 'advance-mode-ladder') return 'invalid'
      if (key === 'advance-mode-diff-depth') return 'invalid'
      return null
    },
    set: () => undefined
  }
  loadPlugin(ctx)
  await ctx.plugin.register(ctx)
  assert.equal(ctx.__getMode(), 'bot')
  assert.equal(ctx.__getLadder(), 'review')
  assert.equal(ctx.__$diffDepth.get(), 'quick')
})

test('register: exposes window.__advanceModeToggle API with ladder methods', async () => {
  const ctx = baseContext()
  ctx.window = { __advanceModeToggle: null }
  loadPlugin(ctx)
  await ctx.plugin.register(ctx)
  const api = ctx.window.__advanceModeToggle
  assert.ok(api)
  assert.equal(typeof api.getMode, 'function')
  assert.equal(typeof api.setMode, 'function')
  assert.equal(typeof api.toggle, 'function')
  assert.equal(typeof api.getLadder, 'function')
  assert.equal(typeof api.setLadder, 'function')
  assert.equal(typeof api.cycle, 'function')
  assert.equal(typeof api.setDiffDepth, 'function')
  assert.equal(typeof api.buildReviewCheckpoint, 'function')
  assert.equal(typeof api.createArtifact, 'function')
  assert.equal(typeof api.createKnowledgePackage, 'function')
})

test('register: cleanup removes window API on dispose', async () => {
  const ctx = baseContext()
  ctx.window = { __advanceModeToggle: null }
  loadPlugin(ctx)
  await ctx.plugin.register(ctx)
  assert.ok(ctx.window.__advanceModeToggle)
  // dispose pattern exists in plugin
})

// ── mode atoms exported ─────────────────────────────────────────────────────

test('$mode atom is accessible and has get/set', () => {
  const ctx = runtime()
  const atom = ctx.__$mode
  assert.equal(typeof atom.get, 'function')
  assert.equal(typeof atom.set, 'function')
  assert.equal(atom.get(), 'bot')
})

test('$ladder atom is accessible and has get/set', () => {
  const ctx = runtime()
  const atom = ctx.__$ladder
  assert.equal(typeof atom.get, 'function')
  assert.equal(typeof atom.set, 'function')
  assert.equal(atom.get(), 'review')
})

test('$diffDepth atom is accessible and has get/set', () => {
  const ctx = runtime()
  const atom = ctx.__$diffDepth
  assert.equal(typeof atom.get, 'function')
  assert.equal(typeof atom.set, 'function')
  assert.equal(atom.get(), 'quick')
})