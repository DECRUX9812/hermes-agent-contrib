import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

// Rendered-behavior tests for the two roster strips.
//
// The plugin draws with bare jsx()/jsxs() calls, so the components can be
// executed for real in a vm with those two functions stubbed to record the
// tree React would receive — no DOM, no React, no source-text matching. The
// pure helpers they lean on are sliced in from plugin.js itself, so the tests
// exercise the shipped filter, not a re-implementation of it.

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

const jsx = (type, props = {}, key) => ({ key, props, type })
const jsxs = jsx

function loadStrips(overrides = {}) {
  const helpersStart = source.indexOf('const ACTIVE_WINDOW_S')
  const helpersEnd = source.indexOf('// ── bot row ─')
  const stripsStart = source.indexOf('function NeedsYouStrip(')
  const stripsEnd = source.indexOf('function GroupDialog(')

  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'liveness helpers must stay extractable')
  assert.ok(stripsStart >= 0 && stripsEnd > stripsStart, 'both strips must stay extractable')

  const context = {
    BotFace: 'BotFace',
    Tip: 'Tip',
    botAppearance: () => ({ color: '#8b5cf6', image: null, shape: 'cloud' }),
    botRosterKey: bot => `bot:${bot.name}`,
    botRosterMeta: (bot, metaByName) => metaByName?.[bot.name] || {},
    cn: (...parts) => parts.filter(Boolean).join(' '),
    displayName: (bot, meta) => meta?.displayName || bot.name,
    isBackfilledFacePng: () => false,
    jsx,
    jsxs,
    ...overrides
  }

  vm.runInNewContext(
    `${source.slice(helpersStart, helpersEnd)}\n${source.slice(stripsStart, stripsEnd)}\n` +
      'globalThis.__NeedsYouStrip = NeedsYouStrip;\nglobalThis.__ActiveNowStrip = ActiveNowStrip;',
    context
  )

  return context
}

// The recorded tree: walk children, tag each node by the type it was rendered
// with ('div', 'span', 'button', or a component stub name). Everything is
// re-hosted (`Array.from`) because an array built inside the vm realm is not
// reference-equal to a host one and trips assert.deepEqual.
const tag = node => (typeof node?.type === 'string' ? node.type : node?.type)
const asArray = value => (Array.isArray(value) ? Array.from(value) : value == null ? [] : [value])
const children = node => asArray(node?.props?.children).filter(Boolean)
// Text labels of a node: raw strings AND the `children` of single-text child
// nodes (the plugin wraps every label in a span).
const texts = node =>
  children(node)
    .map(kid => (typeof kid === 'string' ? kid : kid?.props?.children))
    .filter(text => typeof text === 'string')

const roster = [
  { name: 'analyst', canonical_session: { id: 'analyst-chat', resolved_id: 'analyst-tip' }, last_session: null },
  { name: 'researcher', canonical_session: { id: 'research-chat', resolved_id: 'research-tip' }, last_session: null },
  { name: 'scribe', canonical_session: { id: 'scribe-chat', resolved_id: 'scribe-tip' }, last_session: null }
]

test('Needs you renders one chip per parked bot, in roster order, and opens that bot', () => {
  const { __NeedsYouStrip: NeedsYouStrip } = loadStrips()
  const opened = []

  const strip = NeedsYouStrip({
    awaitingInputSessionIds: ['scribe-chat', 'research-tip'],
    metaByName: {},
    onOpen: bot => opened.push(bot.name),
    roster
  })

  assert.equal(tag(strip), 'div')
  assert.equal(strip.props.role, 'status')
  assert.equal(strip.props['aria-live'], 'polite')
  assert.equal(strip.props['aria-label'], 'Bots needing input')

  // 'Needs you' label, then the chips — parked bots first-to-last as the
  // roster orders them, not as the id list did.
  assert.deepEqual(texts(strip), ['Needs you'])
  const chips = children(strip).filter(kid => tag(kid) === 'button')
  assert.deepEqual(
    chips.map(chip => chip.props['aria-label']),
    ["Open researcher's chat — needs your input", "Open scribe's chat — needs your input"]
  )
  // Roster order beats id-order: researcher (position 2) before scribe (3),
  // and analyst (never parked) is absent.
  assert.equal(chips.length, 2)

  chips.forEach(chip => chip.props.onClick())
  assert.deepEqual(opened, ['researcher', 'scribe'])
})

test('Needs you renders nothing at all when no bot is parked', () => {
  const { __NeedsYouStrip: NeedsYouStrip } = loadStrips()

  assert.equal(NeedsYouStrip({ awaitingInputSessionIds: [], metaByName: {}, onOpen: () => {}, roster }), null)
  // A busy bot is working, not waiting: it must not light the attention strip.
  assert.equal(
    NeedsYouStrip({ awaitingInputSessionIds: [], metaByName: {}, onOpen: () => {}, roster }),
    null
  )
  assert.equal(NeedsYouStrip({ metaByName: {}, onOpen: () => {}, roster }), null)
})

test('Working now renders only for a live turn or a live worker, never for fresh activity', () => {
  const { __ActiveNowStrip: ActiveNowStrip } = loadStrips()
  const now = 1_000_000_000_000
  const fresh = roster.map(bot => ({ ...bot, last_session: { last_active: now / 1000 - 10 } }))

  // A reply 10 seconds ago is RECENT ACTIVITY. The old rule flashed it as
  // working; this is the regression the strip exists to prevent.
  assert.equal(ActiveNowStrip({ busyBySession: {}, metaByName: {}, onOpen: () => {}, roster: fresh }), null)

  const busy = ActiveNowStrip({
    busyBySession: { 'scribe-tip': true },
    metaByName: {},
    onOpen: () => {},
    roster: fresh
  })

  assert.equal(tag(busy), 'div')
  assert.equal(busy.props['aria-label'], 'Working now')
  assert.deepEqual(texts(busy), ['Working now'])

  const tip = children(busy).find(kid => tag(kid) === 'Tip')
  assert.equal(tip.props.label, "Open scribe's chat — working now")
  // The key rides as jsx()'s THIRD argument, never a prop: as a prop React
  // ignores it and the chips lose identity across roster refreshes.
  assert.equal(tip.key, 'bot:scribe')
  assert.equal('key' in tip.props, false)
  const chip = tip.props.children
  assert.equal(chip.props['aria-label'], "Open scribe's chat — working now")

  // The face wears the working mood, so the chip cannot look idle.
  const face = children(chip).find(kid => tag(kid) === 'BotFace')
  assert.equal(face.props.mood, 'work')

  const opened = []
  ActiveNowStrip({ busyBySession: { 'scribe-tip': true }, metaByName: {}, onOpen: b => opened.push(b.name), roster: fresh })
    .props.children.filter(kid => tag(kid) === 'Tip')[0]
    .props.children.props.onClick()
  assert.deepEqual(opened, ['scribe'])

  // A live worker heartbeat counts even with no turn in flight (#90268).
  const worker = roster.map(bot =>
    bot.name === 'analyst'
      ? { ...bot, worker_session: { id: 'w1', last_active: Date.now() / 1000 - 10 } }
      : bot
  )
  const workerStrip = ActiveNowStrip({ busyBySession: {}, metaByName: {}, onOpen: () => {}, roster: worker })
  assert.deepEqual(texts(workerStrip), ['Working now'])
  assert.equal(children(workerStrip).filter(kid => tag(kid) === 'Tip').length, 1)
})
