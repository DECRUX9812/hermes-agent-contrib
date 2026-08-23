import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function loadDerive() {
  const start = source.indexOf('/** Derive the universal Needs You list')
  const end = source.indexOf('/** Cap what renders inline')

  assert.ok(start >= 0 && end > start, 'deriveNeedsYou must remain an extractable pure block')

  const context = {
    console,
    botNeedsInput: (bot, ids) => Boolean(bot?.canonical_session && ids.includes(bot.canonical_session.id)),
    botRosterKey: bot => String(bot?.name || '')
  }
  vm.runInNewContext(
    `${source.slice(start, end)}\nglobalThis.__derive = deriveNeedsYou;`,
    context
  )

  return context.__derive
}

function missionWith(overrides = {}) {
  return {
    id: 'm1',
    title: 'Website redesign',
    status: 'active',
    tasks: [],
    events: [],
    ...overrides
  }
}

test('derives interactive prompts only for canonical blocked bots — never side chats or focus', () => {
  const derive = loadDerive()
  const roster = [
    { name: 'researcher', canonical_session: { id: 'c1' } },
    { name: 'builder', last_session: { id: 'side' } },
    { name: 'reviewer', canonical_session: { id: '' } }
  ]

  const items = derive({ roster, awaitingInputSessionIds: ['c1'] })
  assert.equal(items.length, 1)
  assert.equal(items[0].category, 'input')
  assert.equal(items[0].who, 'researcher')
  assert.ok(items[0].why && items[0].choicesLabel && items[0].noActionConsequence)
})

test('derives failed and blocked tasks with correct mission/task attribution', () => {
  const derive = loadDerive()
  const missions = [
    missionWith({
      tasks: [
        { id: 't1', title: 'Deploy preview', status: 'failed', assignee: 'ops' },
        { id: 't2', title: 'Build prototype', status: 'blocked', assignee: 'frontend' },
        { id: 't3', title: 'Research competitors', status: 'done', assignee: 'researcher' }
      ]
    })
  ]

  const items = derive({ missions })
  assert.equal(items.length, 2)
  assert.deepEqual(
    [...items.map(item => [item.category, item.taskId, item.missionId])].sort(),
    [['blocked', 't2', 'm1'], ['failed', 't1', 'm1']]
  )
  const failed = items.find(item => item.category === 'failed')
  assert.equal(failed.who, '@ops')
  assert.ok(failed.why.includes('Deploy preview'))
})

test('artifact review appears once per artifact and clears after review', () => {
  const derive = loadDerive()
  const baseTasks = [{ id: 't1', title: 'Research', status: 'done', assignee: 'researcher', artifact: 'report.md' }]
  const withArtifact = derive({ missions: [missionWith({ tasks: baseTasks })] })
  assert.equal(withArtifact.filter(item => item.category === 'review').length, 1)

  const reviewed = derive({
    missions: [missionWith({ tasks: baseTasks, reviewedBy: { t1: 'frontend' } })]
  })
  assert.equal(reviewed.filter(item => item.category === 'review').length, 0)
})

test('repeated failure of the same task yields exactly one decision card (dedupe)', () => {
  const derive = loadDerive()
  const missions = [
    missionWith({
      tasks: [{ id: 't1', title: 'Flaky step', status: 'failed', assignee: 'ops' }],
      events: [
        { kind: 'TASK_FAILED', taskId: 't1', at: 1 },
        { kind: 'TASK_FAILED', taskId: 't1', at: 2 },
        { kind: 'TASK_FAILED', taskId: 't1', at: 3 }
      ]
    })
  ]

  const items = derive({ missions })
  const decisions = items.filter(item => item.category === 'decision')
  assert.equal(decisions.length, 1)
  // the failed card also exists once — no duplicate rows even with 3 events
  assert.equal(items.filter(item => item.category === 'failed').length, 1)
})

test('duplicate derivation passes produce identical lists (idempotent, restart-safe)', () => {
  const derive = loadDerive()
  const state = {
    roster: [{ name: 'researcher', canonical_session: { id: 'c1' } }],
    awaitingInputSessionIds: ['c1'],
    missions: [
      missionWith({
        tasks: [{ id: 't9', title: 'X', status: 'failed', assignee: 'a' }]
      })
    ],
    groupNeedsYou: { DevTeam: true }
  }

  const first = derive(state)
  const second = derive(state)
  assert.deepEqual(first, second)
  // keys are stable across derivations → resolved-then-rederived stays consistent
  assert.deepEqual(first.map(item => item.key), second.map(item => item.key))
})

test('11 simultaneous requests render capped inline + calm overflow summary', () => {
  const derive = loadDerive()
  const roster = Array.from({ length: 11 }, (_, index) => ({
    name: `bot${index}`,
    canonical_session: { id: `c${index}` }
  }))

  const items = derive({ roster, awaitingInputSessionIds: roster.map(bot => bot.canonical_session.id) })
  assert.equal(items.length, 11)

  const panelSource = source.slice(source.indexOf('function UniversalNeedsYouPanel'), source.indexOf('// ── roster pane'))
  assert.match(source, /NEEDS_YOU_INLINE_MAX = 6/)
  assert.match(panelSource, /\+\$\{overflow\} more waiting/)
})
