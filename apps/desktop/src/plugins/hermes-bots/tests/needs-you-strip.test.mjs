import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function loadBotNeedsInput() {
  const start = source.indexOf('function botNeedsInput(')
  const end = source.indexOf('/** Bots that are working right now', start)

  assert.ok(start >= 0 && end > start, 'botNeedsInput must remain a small extractable pure helper')

  const context = {}
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.__botNeedsInput = botNeedsInput;`, context)

  return context.__botNeedsInput
}

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

test('Bots pane renders authoritative Needs you before working state without hiding urgent hidden bots', () => {
  const needs = source.indexOf('jsx(NeedsYouStrip')
  const active = source.indexOf('jsx(ActiveNowStrip')
  const search = source.indexOf("placeholder: 'Search bots and group chats…'")

  assert.ok(needs >= 0 && active > needs && search > active, 'attention precedes working state and roster search')
  assert.match(source, /const awaitingInputSessionIds = useValue\(\$awaitingInputSessionIds\)/)
  assert.match(source, /jsx\(NeedsYouStrip, \{\s*roster,\s*awaitingInputSessionIds,/)
  assert.match(source, /children: 'Needs you'/)
  assert.match(source, /'aria-label': `Open \$\{label\}'s chat — needs your input`/)
})
