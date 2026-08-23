import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function loadTeamIa() {
  const start = source.indexOf('// ── slice 6: Team IA')
  const end = source.indexOf('// ── slice 7: mission autonomy')

  assert.ok(start >= 0 && end > start, 'team IA block must remain extractable')

  const context = {
    console,
    botNeedsInput: (bot, ids) => Boolean(bot?.canonical_session && ids.includes(bot.canonical_session.id)),
    botSessionBusy: (bot, busy) => Boolean(bot?.canonical_session && busy?.[bot.canonical_session.id]),
    workerActiveAt: bot => (bot?.workerActiveAt ? bot.workerActiveAt : null)
  }
  vm.runInNewContext(
    `${source.slice(start, end)}
globalThis.__ia = { TEAM_PRESENCE_ORDER, teamPresence, botCurrentMission, swarmSummary };`,
    context
  )

  return context.__ia
}

test('presence precedence: needs-you > working > blocked > waiting > unknown', () => {
  const { teamPresence } = loadTeamIa()
  const ctx = {
    awaitingInputSessionIds: ['c1'],
    busyBySession: {},
    missions: []
  }

  const promptBot = { name: 'a', canonical_session: { id: 'c1' }, workerActiveAt: 999 }
  assert.equal(teamPresence(promptBot, ctx), 'needs-you', 'pending input outranks even live work')

  const workCtx = { awaitingInputSessionIds: [], busyBySession: { c2: true }, missions: [] }
  assert.equal(teamPresence({ name: 'b', canonical_session: { id: 'c2' } }, workCtx), 'working')
  assert.equal(teamPresence({ name: 'b', workerActiveAt: 1234567890 }, workCtx), 'working', 'worker heartbeat counts as working')

  const missions = [{
    id: 'm1', title: 'X', status: 'active',
    tasks: [
      { id: 't1', title: 'A', status: 'blocked', assignee: 'ops' },
      { id: 't2', title: 'B', status: 'waiting', assignee: 'reviewer' },
      { id: 't3', title: 'C', status: 'done', assignee: 'researcher' }
    ]
  }]
  const mctx = { awaitingInputSessionIds: [], busyBySession: {}, missions }
  assert.equal(teamPresence({ name: 'ops' }, mctx), 'blocked', 'assigned blocked task shows blocked with a quiet chat')
  assert.equal(teamPresence({ name: 'reviewer' }, mctx), 'waiting')
  assert.equal(teamPresence({ name: 'researcher' }, mctx), 'unknown', 'done task never fakes presence')

  // unread/activity are NOT inputs anywhere — a quiet bot stays unknown
  assert.equal(teamPresence({ name: 'idle', last_session: { id: 'z', last_active: Date.now() } }, mctx), 'unknown')
})

test('botCurrentMission names the active mission owning a non-done task; empty when none', () => {
  const { botCurrentMission } = loadTeamIa()
  const missions = [
    { id: 'm1', title: 'Website redesign', status: 'active', tasks: [
      { id: 't1', title: 'Build', status: 'working', assignee: 'frontend' }
    ] },
    { id: 'm2', title: 'Old thing', status: 'done', tasks: [
      { id: 't9', title: 'Z', status: 'failed', assignee: 'frontend' }
    ] }
  ]

  assert.equal(botCurrentMission({ name: 'frontend' }, missions), 'Website redesign')
  assert.equal(botCurrentMission({ name: 'nobody' }, missions), '')
  // done-only assignees get no invented mission
  const allDone = [{ id: 'm3', title: 'W', status: 'active', tasks: [
    { id: 't1', title: 'D', status: 'done', assignee: 'researcher' }
  ] }]
  assert.equal(botCurrentMission({ name: 'researcher' }, allDone), '')
})

test('swarm compression kicks in at 9+ and counts honestly; smaller teams stay null', () => {
  const { swarmSummary } = loadTeamIa()

  const small = [
    { presence: 'working' }, { presence: 'unknown' }, { presence: 'needs-you' }
  ]
  assert.equal(swarmSummary(small), null)

  const big = Array.from({ length: 20 }, (_, index) => ({
    presence: index < 17 ? 'unknown' : index === 17 ? 'working' : 'blocked'
  }))
  const summary = swarmSummary(big)
  assert.equal(summary.total, 20)
  assert.equal(summary.done, 17)
  assert.equal(summary.working, 1)
  assert.equal(summary.blocked, 2)
})
