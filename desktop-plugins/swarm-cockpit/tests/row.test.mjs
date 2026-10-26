// Render tests for one roster row: what a collapsed row shows, what the expanded
// row adds (transcript tail + steer + confirm-interrupt), and the honest copy for a
// worker that is no longer accepting steer. SubagentRow is invoked directly with a
// normalized row, so no React runtime is needed.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { findElements, loadPlugin, textOf } from './harness.mjs'

const { helpers } = loadPlugin()

const noop = () => undefined

function makeRow(over = {}) {
  return helpers.normalizeRow({
    subagent_id: 'sa-1',
    goal: 'audit the repo',
    status: 'running',
    started_at: 1726800000,
    tool_count: 3,
    last_tool: 'read_file',
    accepting_steer: true,
    ...over,
  })
}

function renderRow(row, over = {}) {
  return helpers.SubagentRow({
    node: { row, indent: 1 },
    nowMs: 1726800000 * 1000 + 12000,
    tail: null,
    notice: null,
    busy: null,
    confirming: false,
    draft: '',
    onToggle: noop,
    onDraft: noop,
    onSteer: noop,
    onAskInterrupt: noop,
    onCancelInterrupt: noop,
    onConfirmInterrupt: noop,
    ...over,
  })
}

test('a collapsed row shows goal, status, age, tool count and the controls', () => {
  const text = textOf(renderRow(makeRow())).join(' | ')

  assert.match(text, /audit the repo/)
  assert.match(text, /running/)
  assert.match(text, /12s elapsed/)
  assert.match(text, /3 tools/)
  assert.match(text, /read_file/)
  assert.match(text, /inspect/)
  assert.match(text, /interrupt…/)
  assert.doesNotMatch(text, /confirm interrupt/)
  assert.doesNotMatch(text, /undefined/)
})

test('a terminal row offers no interrupt and says it is finished', () => {
  const text = textOf(renderRow(makeRow({ status: 'completed' }))).join(' | ')

  assert.match(text, /completed/)
  assert.match(text, /started 12s ago/)
  assert.match(text, /finished/)
  assert.doesNotMatch(text, /interrupt…/)
})

test('the confirm step replaces the interrupt button and can be cancelled', () => {
  const text = textOf(renderRow(makeRow(), { confirming: true })).join(' | ')

  assert.match(text, /confirm interrupt/)
  assert.match(text, /cancel/)
  assert.doesNotMatch(text, /interrupt…/)
})

test('an expanded row renders the transcript tail and the steer box', () => {
  const tree = renderRow(makeRow(), {
    tail: { available: true, text: 'picked 6 files\nrunning node --test', truncated: false, error: null },
    draft: 'tighten the tests',
  })
  const text = textOf(tree).join(' | ')
  const inputs = findElements(tree, (element) => typeof element.props.placeholder === 'string')

  assert.match(text, /running node --test/)
  assert.match(text, /steer/)
  assert.match(text, /id sa-1/)
  assert.equal(inputs.length, 1)
  assert.match(inputs[0].props.placeholder, /steer this worker/)
  assert.equal(inputs[0].props.value, 'tighten the tests')
  assert.equal(inputs[0].props.disabled, false)
})

test('an empty tail says so instead of pretending to stream', () => {
  const text = textOf(renderRow(makeRow(), { tail: { available: true, text: '', truncated: false, error: null } })).join(' | ')

  assert.match(text, /live transcript is empty so far/)
})

test('a missing tail and a failed tail get different copy', () => {
  const missing = textOf(renderRow(makeRow(), { tail: { available: false, text: '', truncated: false, error: null } })).join(' | ')
  const failed = textOf(renderRow(makeRow(), { tail: { available: false, text: '', truncated: false, error: 'boom' } })).join(' | ')

  assert.match(missing, /live transcript not available yet/)
  assert.match(failed, /transcript unavailable: boom/)
})

test('a truncated tail is labelled', () => {
  const text = textOf(renderRow(makeRow(), { tail: { available: true, text: 'x', truncated: true, error: null } })).join(' | ')

  assert.match(text, /truncated to the last 16KB/)
})

test('a worker that stopped accepting steer gets no live steer control', () => {
  const tree = renderRow(makeRow({ accepting_steer: false }), { tail: { available: true, text: 'x', truncated: false, error: null } })
  const inputs = findElements(tree, (element) => typeof element.props.placeholder === 'string')
  const steerButton = findElements(tree, (element) => element.props.children === 'steer')

  assert.equal(inputs.length, 1)
  assert.match(inputs[0].props.placeholder, /not accepting steer/)
  assert.equal(inputs[0].props.disabled, true)
  assert.equal(steerButton.length, 1)
  assert.equal(steerButton[0].props.disabled, true)
})

test('a steer notice is rendered with its honest outcome text', () => {
  const text = textOf(
    renderRow(makeRow(), { notice: { kind: 'warn', text: 'steer rejected (rejected) — the child is past its final tool batch' } })
  ).join(' | ')

  assert.match(text, /steer rejected \(rejected\)/)
})

test('an in-flight action disables the controls instead of double-firing', () => {
  const tree = renderRow(makeRow(), { busy: 'steer', tail: { available: true, text: 'x', truncated: false, error: null } })
  const inputs = findElements(tree, (element) => typeof element.props.placeholder === 'string')

  assert.equal(inputs[0].props.disabled, true)
})

test('indent drives the visual nesting offset', () => {
  const nested = renderRow(makeRow(), {})
  const root = helpers.SubagentRow({
    node: { row: makeRow(), indent: 0 },
    nowMs: 1726800000 * 1000 + 12000,
    tail: null,
    notice: null,
    busy: null,
    confirming: false,
    draft: '',
    onToggle: noop,
    onDraft: noop,
    onSteer: noop,
    onAskInterrupt: noop,
    onCancelInterrupt: noop,
    onConfirmInterrupt: noop,
  })

  assert.equal(nested.props.style.paddingLeft, '18px')
  assert.equal(root.props.style.paddingLeft, '6px')
})
