// Pure-logic tests for swarm-cockpit: status derivation, age formatting, sorting,
// tree building, roster tallies and RPC error copy. Every value under test is built
// inside the vm realm, so assertions compare FIELDS explicitly — never deepEqual.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { loadPlugin } from './harness.mjs'

const { helpers } = loadPlugin()

const row = (over = {}) => helpers.normalizeRow({ subagent_id: 'sa', status: 'running', ...over })

/* ---------------------------------------------------------------- status */

test('statusKey maps the gateway enum and folds cancelled onto interrupted', () => {
  assert.equal(helpers.statusKey('queued'), 'queued')
  assert.equal(helpers.statusKey('running'), 'running')
  assert.equal(helpers.statusKey('completed'), 'completed')
  assert.equal(helpers.statusKey('failed'), 'failed')
  assert.equal(helpers.statusKey('error'), 'error')
  assert.equal(helpers.statusKey('timeout'), 'timeout')
  assert.equal(helpers.statusKey('interrupted'), 'interrupted')
  assert.equal(helpers.statusKey('CANCELLED'), 'interrupted')
  assert.equal(helpers.statusKey('canceled'), 'interrupted')
  assert.equal(helpers.statusKey(''), 'unknown')
  assert.equal(helpers.statusKey(undefined), 'unknown')
  assert.equal(helpers.statusKey(null), 'unknown')
})

test('an unrecognised status keeps its own label instead of inventing one', () => {
  const meta = helpers.statusMeta('quarantined')

  assert.equal(meta.key, 'quarantined')
  assert.equal(meta.label, 'quarantined')
  assert.equal(meta.tone, 'text-(--ui-text-quaternary)')
})

test('known statuses carry theme-var tones and dots, never hex colors', () => {
  for (const status of ['queued', 'running', 'completed', 'failed', 'error', 'timeout', 'interrupted']) {
    const meta = helpers.statusMeta(status)

    assert.match(meta.tone, /^text-\(--ui-[a-z-]+\)$/)
    assert.match(meta.dot, /^var\(--ui-[a-z-]+\)$/)
  }
})

test('isLiveRow is true only for queued and running', () => {
  assert.equal(helpers.isLiveRow(row({ status: 'running' })), true)
  assert.equal(helpers.isLiveRow(row({ status: 'queued' })), true)
  assert.equal(helpers.isLiveRow(row({ status: 'completed' })), false)
  assert.equal(helpers.isLiveRow(row({ status: 'timeout' })), false)
})

/* ---------------------------------------------------------------- rows */

test('normalizeRow converts started_at seconds to ms and keeps the roster fields', () => {
  const normalized = helpers.normalizeRow({
    subagent_id: 'sa-7',
    parent_id: 'sa-1',
    depth: 2,
    goal: '  audit the repo  ',
    delegation_id: 'batch-9',
    model: 'deepseek-v4.1-flash',
    started_at: 1726800000.5,
    status: 'running',
    tool_count: 4,
    last_tool: 'read_file',
    accepting_steer: true,
  })

  assert.equal(normalized.id, 'sa-7')
  assert.equal(normalized.parentId, 'sa-1')
  assert.equal(normalized.depth, 2)
  assert.equal(normalized.goal, 'audit the repo')
  assert.equal(normalized.delegationId, 'batch-9')
  assert.equal(normalized.model, 'deepseek-v4.1-flash')
  assert.equal(normalized.startedAtMs, 1726800000500)
  assert.equal(normalized.status, 'running')
  assert.equal(normalized.toolCount, 4)
  assert.equal(normalized.lastTool, 'read_file')
  assert.equal(normalized.acceptingSteer, true)
})

test('accepting_steer is tri-state: absent stays null, false stays false', () => {
  assert.equal(row({ accepting_steer: undefined }).acceptingSteer, null)
  assert.equal(row({ accepting_steer: false }).acceptingSteer, false)
  assert.equal(row({ accepting_steer: true }).acceptingSteer, true)
})

test('a snapshot with no goal or no start time degrades honestly', () => {
  const bare = helpers.normalizeRow({ subagent_id: 'sa-2' })

  assert.equal(bare.goal, 'untitled goal')
  assert.equal(bare.startedAtMs, null)
  assert.equal(bare.status, 'unknown')
  assert.equal(bare.toolCount, null)
})

test('sortRows puts live workers first, then oldest first, then by id', () => {
  const rows = [
    row({ subagent_id: 'b-done', status: 'completed', started_at: 10 }),
    row({ subagent_id: 'a-run', status: 'running', started_at: 40 }),
    row({ subagent_id: 'c-run', status: 'queued', started_at: 20 }),
    row({ subagent_id: 'd-run', status: 'running', started_at: 20 }),
    row({ subagent_id: 'e-done', status: 'failed', started_at: 5 }),
  ]
  const ids = helpers.sortRows(rows).map((item) => item.id)

  // compare fields explicitly, never deepEqual
  assert.equal(ids.join(','), 'c-run,d-run,a-run,e-done,b-done')
})

test('sortRows does not mutate the caller list and tolerates junk input', () => {
  const rows = [row({ subagent_id: 'x', status: 'running' }), row({ subagent_id: 'y', status: 'completed' })]
  const before = rows.map((item) => item.id).join(',')

  helpers.sortRows(rows)
  assert.equal(rows.map((item) => item.id).join(','), before)
  assert.equal(helpers.sortRows(undefined).length, 0)
})

/* ---------------------------------------------------------------- tree */

test('buildForest nests children under their parent and flattens in order', () => {
  const rows = [
    row({ subagent_id: 'child', parent_id: 'root', status: 'running', started_at: 20 }),
    row({ subagent_id: 'root', status: 'running', started_at: 10 }),
    row({ subagent_id: 'grand', parent_id: 'child', status: 'queued', started_at: 30 }),
  ]
  const forest = helpers.buildForest(rows)

  assert.equal(forest.length, 1)
  assert.equal(forest[0].row.id, 'root')
  assert.equal(forest[0].children.length, 1)
  assert.equal(forest[0].children[0].row.id, 'child')
  assert.equal(forest[0].children[0].children[0].row.id, 'grand')

  const flat = helpers.flattenForest(forest)

  assert.equal(flat.length, 3)
  assert.equal(flat[0].row.id, 'root')
  assert.equal(flat[0].indent, 0)
  assert.equal(flat[1].row.id, 'child')
  assert.equal(flat[1].indent, 1)
  assert.equal(flat[2].row.id, 'grand')
  assert.equal(flat[2].indent, 2)
})

test('an orphan or self-parented row stays a root', () => {
  const forest = helpers.buildForest([
    row({ subagent_id: 'orphan', parent_id: 'gone' }),
    row({ subagent_id: 'self', parent_id: 'self' }),
  ])

  assert.equal(forest.length, 2)
  assert.equal(forest.map((node) => node.row.id).join(','), 'orphan,self')
})

test('a cyclic parent link cannot hang or swallow rows', () => {
  const forest = helpers.buildForest([
    row({ subagent_id: 'a', parent_id: 'b' }),
    row({ subagent_id: 'b', parent_id: 'a' }),
  ])
  const flat = helpers.flattenForest(forest)

  // both links are refused, so both rows stay visible as roots
  assert.equal(flat.length, 2)
  assert.equal(flat.map((item) => item.row.id).join(','), 'a,b')
  assert.equal(forest.length, 2)
  assert.equal(forest[0].children.length, 0)
  assert.equal(forest[1].children.length, 0)
})

test('rows without an id are ignored by the forest', () => {
  const forest = helpers.buildForest([row({ subagent_id: '' }), row({ subagent_id: 'ok' })])

  assert.equal(forest.length, 1)
  assert.equal(forest[0].row.id, 'ok')
})

/* ---------------------------------------------------------------- age */

test('formatAge is compact and zero-padded', () => {
  assert.equal(helpers.formatAge(0), '0s')
  assert.equal(helpers.formatAge(5), '5s')
  assert.equal(helpers.formatAge(59), '59s')
  assert.equal(helpers.formatAge(60), '1m00s')
  assert.equal(helpers.formatAge(65), '1m05s')
  assert.equal(helpers.formatAge(3725), '1h02m')
  assert.equal(helpers.formatAge(60 * 60 * 49), '2d01h')
  assert.equal(helpers.formatAge(-4), '0s')
  assert.equal(helpers.formatAge(undefined), '0s')
})

test('ageSeconds returns null when the roster reported no start time', () => {
  assert.equal(helpers.ageSeconds(null, 1000), null)
  assert.equal(helpers.ageSeconds(undefined, 1000), null)
  assert.equal(helpers.ageSeconds(1000, 6500), 5)
  assert.equal(helpers.ageSeconds(9000, 1000), 0)
})

test('ageLine says elapsed for live rows and started-ago for terminal rows', () => {
  const now = 100000

  assert.equal(helpers.ageLine(row({ status: 'running', started_at: 88 }), now), '12s elapsed')
  assert.equal(helpers.ageLine(row({ status: 'completed', started_at: 88 }), now), 'started 12s ago')
  assert.equal(helpers.ageLine(row({ status: 'running', started_at: undefined }), now), 'start time not reported')
})

test('metaLine only reports what the roster sent', () => {
  const now = 100000

  assert.equal(
    helpers.metaLine(row({ status: 'running', started_at: 88, tool_count: 3, last_tool: 'read_file' }), now),
    '12s elapsed · 3 tools · read_file'
  )
  assert.equal(
    helpers.metaLine(row({ status: 'running', started_at: 88, tool_count: 1 }), now),
    '12s elapsed · 1 tool'
  )
  assert.equal(helpers.metaLine(row({ status: 'running', started_at: 88 }), now), '12s elapsed')
})

/* ---------------------------------------------------------------- activity */

test('tailLines keeps the last non-empty lines, normalised', () => {
  const lines = helpers.tailLines('first\n\n  second   line  \nthird\n')

  assert.equal(lines.length, 3)
  assert.equal(lines[0], 'first')
  assert.equal(lines[1], 'second line')
  assert.equal(lines[2], 'third')
  assert.equal(helpers.tailLines('a\nb\nc\nd', 2).join(','), 'c,d')
  assert.equal(helpers.tailLines(undefined).length, 0)
})

test('clip trims and truncates with an ellipsis', () => {
  assert.equal(helpers.clip('  a   b  '), 'a b')
  assert.equal(helpers.clip('abcdef', 4), 'abc…')
  assert.equal(helpers.clip(undefined), '')
})

test('activityLine prefers the live transcript, then the last tool, then honest copy', () => {
  assert.equal(helpers.activityLine(row({ last_tool: 'grep' }), 'wrote file\nran tests'), 'ran tests')
  assert.equal(helpers.activityLine(row({ last_tool: 'grep' }), ''), 'last tool: grep')
  assert.equal(helpers.activityLine(row({ status: 'queued' }), ''), 'queued — waiting for a slot')
  assert.equal(helpers.activityLine(row({ status: 'running' }), ''), 'running — no live transcript yet')
  assert.equal(helpers.activityLine(row({ status: 'completed' }), ''), 'no live transcript (child finished)')
})

/* ---------------------------------------------------------------- tallies */

test('counts buckets the roster and totals live workers', () => {
  const tally = helpers.counts([
    row({ status: 'running' }),
    row({ status: 'queued' }),
    row({ status: 'completed' }),
    row({ status: 'failed' }),
    row({ status: 'timeout' }),
    row({ status: 'interrupted' }),
  ])

  // compare fields explicitly, never deepEqual (vm realm)
  assert.equal(tally.total, 6)
  assert.equal(tally.live, 2)
  assert.equal(tally.running, 1)
  assert.equal(tally.queued, 1)
  assert.equal(tally.completed, 1)
  assert.equal(tally.failed, 2)
  assert.equal(tally.interrupted, 1)
  assert.equal(tally.other, 0)
})

test('chipLabel reports live, done, failed and idle honestly', () => {
  assert.equal(helpers.chipLabel(helpers.counts([])), 'idle')
  assert.equal(helpers.chipLabel(helpers.counts([row({ status: 'running' }), row({ status: 'queued' })])), '2 live')
  assert.equal(helpers.chipLabel(helpers.counts([row({ status: 'completed' })])), '1 done')
  assert.equal(helpers.chipLabel(helpers.counts([row({ status: 'failed' }), row({ status: 'completed' })])), '1 failed')
})

test('chipTitle carries the breakdown, the session and the socket state', () => {
  const title = helpers.chipTitle(
    helpers.counts([row({ status: 'running' }), row({ status: 'completed' })]),
    'abcdef123456',
    'open'
  )

  assert.match(title, /session abcdef12/)
  assert.match(title, /1 live \(1 running, 0 queued\)/)
  assert.match(title, /1 completed/)
  assert.match(title, /reveal the pane/)
  assert.doesNotMatch(title, /backend socket/)

  const offline = helpers.chipTitle(helpers.counts([]), null, 'connecting')

  assert.match(offline, /backend socket: connecting/)
  assert.doesNotMatch(offline, /session /)
})

/* ---------------------------------------------------------------- errors */

test('rpcErrorCopy explains an ownership refusal and a missing method', () => {
  assert.match(
    helpers.rpcErrorCopy(new Error('session not found or not owned by this transport')),
    /does not own this session/
  )
  assert.match(helpers.rpcErrorCopy({ message: 'Method not found' }), /no subagent\.list RPC/)
  assert.match(helpers.rpcErrorCopy({ data: { message: 'text is required' } }), /steer text was empty/)
  assert.equal(helpers.rpcErrorCopy('boom'), 'boom')
  assert.equal(helpers.rpcErrorCopy(undefined), 'unknown RPC error')
})
