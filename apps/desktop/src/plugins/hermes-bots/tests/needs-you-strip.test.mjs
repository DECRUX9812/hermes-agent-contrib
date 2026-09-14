import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

// botNeedsInput + needsInputBots must stay inside the extractable helper block
// so tests execute the real filter instead of asserting on source text.
function loadNeedsInputSlice() {
  const start = source.indexOf('function botNeedsInput(')
  const end = source.indexOf('function activeBots(')

  assert.ok(start >= 0 && end > start, 'botNeedsInput must remain a small extractable pure helper')

  const context = {}
  vm.runInNewContext(
    `${source.slice(start, end)}\nglobalThis.__botNeedsInput = botNeedsInput;\nglobalThis.__needsInputBots = needsInputBots;`,
    context
  )

  return context
}

const loadBotNeedsInput = () => loadNeedsInputSlice().__botNeedsInput
const loadNeedsInputBots = () => loadNeedsInputSlice().__needsInputBots

test('botNeedsInput matches either identity of the canonical Bot Chat', () => {
  const botNeedsInput = loadBotNeedsInput()
  const bot = { canonical_session: { id: 'durable-chat', resolved_id: 'runtime-tip' } }

  assert.equal(botNeedsInput(bot, ['durable-chat']), true)
  assert.equal(botNeedsInput(bot, ['runtime-tip']), true)
  assert.equal(botNeedsInput(bot, ['another-session']), false)
})

test('botNeedsInput never promotes side chats, missing rows, or draft prompts', () => {
  const botNeedsInput = loadBotNeedsInput()

  assert.equal(botNeedsInput({ last_session: { id: 'side-chat' } }, ['side-chat']), false)
  assert.equal(botNeedsInput({ canonical_session: null }, ['']), false)
  assert.equal(botNeedsInput(null, ['runtime-tip']), false)
  assert.equal(botNeedsInput({ canonical_session: { id: 'durable-chat' } }, null), false)
})

test('needsInputBots keeps roster order and returns only parked bots', () => {
  const needsInputBots = loadNeedsInputBots()
  const roster = [
    { name: 'researcher', canonical_session: { id: 'research-chat', resolved_id: 'research-tip' } },
    { name: 'scribe', canonical_session: { id: 'scribe-chat', resolved_id: null } },
    { name: 'analyst', canonical_session: { id: 'analyst-chat', resolved_id: 'analyst-tip' } }
  ]

  // Order follows the roster, and a durable id matches just like a live tip.
  assert.deepEqual(
    needsInputBots(roster, ['analyst-tip', 'research-chat']).map(bot => bot.name),
    ['researcher', 'analyst']
  )
  assert.equal(needsInputBots(roster, []).length, 0)
  assert.equal(needsInputBots(null, ['analyst-tip']).length, 0)
  assert.equal(roster.length, 3, 'the roster is never mutated or reordered')
})

test('Bots pane renders authoritative Needs you before working state without hiding urgent hidden bots', () => {
  const needs = source.indexOf('jsx(NeedsYouStrip')
  const active = source.indexOf('jsx(ActiveNowStrip')
  const search = source.indexOf("placeholder: 'Search bots and group chats…'")

  assert.ok(needs >= 0 && active > needs && search > active, 'attention precedes working state and roster search')
  // The strip reads the FULL roster, the working strip the filtered one: a bot
  // parked on an answer must never be hidden by a gateway filter or a search.
  // (Which roster each strip receives is pane wiring — the chips themselves,
  // their labels and their click targets are asserted by
  // attention-strips-render.test.mjs, which executes both strips.)
  assert.match(source, /jsx\(NeedsYouStrip, \{\s*roster,\s*awaitingInputSessionIds,/)
  assert.match(source, /jsx\(ActiveNowStrip, \{\s*roster: visibleRoster,\s*busyBySession,/)
})

test('BotRow surfaces Needs you where a row can show it without a strip', () => {
  const rowStart = source.indexOf('function BotRow(')
  const row = source.slice(rowStart, rowStart + 12000)

  assert.ok(rowStart >= 0)
  // A parked bot is announced in the row itself (tooltip + chip), not only in
  // the strip: screen readers read the row's label, and the strip can be
  // scrolled out of view on a long roster.
  assert.match(row, /const needsYou = botNeedsInput\(bot, awaitingInputSessionIds\)/)
  assert.match(row, /needsYou \? 'Needs your input' : ''/)
  assert.match(row, /'aria-label': 'Needs your input'/)
})
