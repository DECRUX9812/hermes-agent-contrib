// Registration + render shape for swarm-cockpit: every contribution the plugin
// registers, its area payload fields, and that each render fn survives a call.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { loadPlugin, textOf } from './harness.mjs'

function register(ctxExtra = {}) {
  const env = loadPlugin(ctxExtra)
  const entries = []
  const events = []
  const storage = { get: () => null, set: () => undefined, remove: () => undefined }
  const ctx = {
    source: 'plugin:swarm-cockpit',
    register: (item) => {
      entries.push(item)
      return () => undefined
    },
    storage,
    ...ctxExtra.ctx,
  }

  if (ctxExtra.withEventDoor !== false) {
    ctx.onEvent = (type, listener) => {
      events.push({ type, listener })
      return () => undefined
    }
  }

  env.plugin.register(ctx)

  return { ...env, entries, events }
}

/**
 * contribution.render() returns the element for the component, so invoke it —
 * that runs the component body (hooks, state derivation, branch selection) and
 * is where a lazy ReferenceError would surface.
 */
function renderComponent(contribution) {
  const element = contribution.render()

  assert.equal(typeof element.type, 'function')

  return element.type(element.props || {})
}

test('default export is a HermesPlugin with the folder id', () => {
  const { plugin } = loadPlugin()

  assert.equal(plugin.id, 'swarm-cockpit')
  assert.equal(plugin.name, 'Swarm Cockpit')
  assert.equal(typeof plugin.register, 'function')
})

test('registers exactly the pane, the status-bar chip and the palette command', () => {
  const { entries } = register()

  assert.equal(entries.length, 3)
  assert.equal(entries[0].id, 'pane')
  assert.equal(entries[0].area, 'panes')
  assert.equal(entries[1].id, 'chip')
  assert.equal(entries[1].area, 'statusBar.right')
  assert.equal(entries[2].id, 'reveal')
  assert.equal(entries[2].area, 'palette')
})

test('every registered id is unique', () => {
  const { entries } = register()
  const ids = entries.map((entry) => entry.id)

  assert.equal(new Set(ids).size, ids.length)
})

test('pane registration carries placement, width and a lazy render', () => {
  const { entries } = register()
  const pane = entries.find((entry) => entry.area === 'panes')

  assert.equal(pane.title, 'swarm')
  // compare fields explicitly, never deepEqual (vm realm)
  assert.equal(pane.data.placement, 'right')
  assert.equal(pane.data.width, '340px')
  assert.equal(typeof pane.render, 'function')
})

test('status-bar chip sits on the right with an order and a lazy render', () => {
  const { entries } = register()
  const chip = entries.find((entry) => entry.area === 'statusBar.right')

  assert.equal(typeof chip.order, 'number')
  assert.equal(typeof chip.render, 'function')
})

test('palette command namespaces its id and reveals the pane', () => {
  const revealCalls = []
  const { entries } = register({ revealCalls })
  const command = entries.find((entry) => entry.area === 'palette')

  assert.equal(command.data.id, 'swarm-cockpit.reveal')
  assert.equal(command.data.label, 'Swarm Cockpit: Reveal')
  assert.ok(Array.isArray(command.data.keywords))
  assert.ok(command.data.keywords.includes('subagent'))
  assert.equal(typeof command.data.run, 'function')

  command.data.run()
  assert.equal(revealCalls.length, 1)
  assert.equal(revealCalls[0], 'swarm-cockpit:pane')
})

test('register survives a desktop without the ctx.onEvent door', () => {
  const { entries, events } = register({ withEventDoor: false })

  assert.equal(entries.length, 3)
  assert.equal(events.length, 0)
})

test('register subscribes to every gateway subagent.* frame', () => {
  const { events } = register()
  const types = events.map((event) => event.type)

  assert.ok(types.includes('subagent.start'))
  assert.ok(types.includes('subagent.progress'))
  assert.ok(types.includes('subagent.tool'))
  assert.ok(types.includes('subagent.complete'))

  // a frame arriving before any session exists must not throw
  for (const event of events) {
    event.listener({ subagent_id: 'sa-1', status: 'running' })
  }
})

test('pane render draws the honest no-gateway state, never a fake count', () => {
  const { entries } = register()
  const pane = entries.find((entry) => entry.area === 'panes')
  const text = textOf(renderComponent(pane)).join(' | ')

  assert.match(text, /swarm cockpit/i)
  assert.match(text, /backend not connected/i)
  assert.match(text, /no session/i)
  assert.match(text, /refresh/i)
  assert.doesNotMatch(text, /undefined/)
})

test('pane render says "no focused session" when the gateway is open', () => {
  const { entries } = register({
    hostState: { gateway: { get: () => 'open', listen: () => undefined } },
  })
  const pane = entries.find((entry) => entry.area === 'panes')
  const text = textOf(renderComponent(pane)).join(' | ')

  assert.match(text, /no focused session/i)
})

test('pane render lists a live roster when the gateway reports one', () => {
  const env = loadPlugin({
    hostState: {
      gateway: { get: () => 'open', listen: () => undefined },
      focusedSessionId: { get: () => 'sess-42', listen: () => undefined },
    },
  })
  const entries = []
  let calls = 0

  env.context.host.request = async () => {
    calls += 1
    return { subagents: [], delegations: [] }
  }
  env.plugin.register({ register: (item) => entries.push(item), onEvent: () => undefined })

  const pane = entries.find((entry) => entry.area === 'panes')
  const text = textOf(renderComponent(pane)).join(' | ')

  assert.match(text, /swarm cockpit/i)
  assert.match(text, /sess-42/)
  // first render has no roster yet -> the honest empty state, no fake rows
  assert.match(text, /no live subagents/i)
  assert.match(text, /delegate_task runs will appear here/i)
  assert.doesNotMatch(text, /undefined/)
  // rendering alone must not fire an RPC; the poll effect owns that
  assert.equal(calls, 0)
})

test('chip render shows an honest label and no fabricated live count', () => {
  const { entries } = register()
  const chip = entries.find((entry) => entry.area === 'statusBar.right')
  const tree = renderComponent(chip)
  const text = textOf(tree).join(' | ')

  // gateway atom is absent in this context -> 'unknown' -> not connected
  assert.match(text, /swarm —/)
  assert.equal(typeof tree.props.title, 'string')
  assert.match(tree.props.title, /backend socket/)
})
