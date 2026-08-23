import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

/** Load every pure Team OS block in dependency order into one sandbox. */
function loadTeamOs() {
  const missionsStart = source.indexOf('const MISSIONS_KEY')
  const iaStart = source.indexOf('// ── slice 6: Team IA')
  const acStart = source.indexOf('// ── slice 7: mission autonomy')
  const rosterPane = source.indexOf('// ── roster pane ──')

  assert.ok(missionsStart >= 0 && iaStart > missionsStart && acStart > iaStart && rosterPane > acStart)

  const context = {
    console,
    Date,
    atom: value => ({ get: () => value, set: () => undefined }),
    pluginCtx: null,
    botNeedsInput: (bot, ids) => Boolean(bot?.canonical_session && ids.includes(bot.canonical_session.id)),
    botSessionBusy: (bot, busy) => Boolean(bot?.canonical_session && busy?.[bot.canonical_session.id]),
    workerActiveAt: bot => (bot?.workerActiveAt ? bot.workerActiveAt : null),
    botRosterKey: bot => String(bot?.name || '')
  }
  vm.runInNewContext(
    `${source.slice(missionsStart, rosterPane)}
globalThis.__os = {
  normalizeMissions, applyMissionEvent, missionTimeline, recordMissionEvent, createMission,
  deriveNeedsYou, TEAM_PRESENCE_ORDER, teamPresence, botCurrentMission, swarmSummary,
  AUTONOMY_LEVELS, autonomyPolicy, requiresHumanApproval,
  createConsensus, addConsensusProposal, decideConsensus
};`,
    context
  )

  return context.__os
}

test('INTEGRATED: Nexus → Research+Frontend parallel → artifact handoff → Reviewer consensus → decision → completion', () => {
  const os = loadTeamOs()

  // ── mission creation with declared dependencies and autonomy ──
  let mission = os.createMission({
    id: 'm_landing',
    title: 'Landing page from competitor research',
    goal: 'Ship reviewed landing page',
    autonomy: 'balanced',
    tasks: [
      { id: 't1', title: 'Research competitors', assignee: 'researcher', dependsOn: [] },
      { id: 't2', title: 'Build prototype', assignee: 'frontend', dependsOn: ['t1'] },
      { id: 't3', title: 'Review implementation', assignee: 'reviewer', dependsOn: ['t2'] }
    ],
    events: []
  })
  assert.ok(mission)

  const roster = [
    { name: 'nexus', canonical_session: { id: 'cn' } },
    { name: 'researcher', canonical_session: { id: 'cr' } },
    { name: 'frontend', canonical_session: { id: 'cf' } },
    { name: 'reviewer', canonical_session: { id: 'cv' } }
  ]
  const busy = {}
  const ctx = state => ({
    awaitingInputSessionIds: [],
    busyBySession: busy,
    missions: state
  })

  // ── phase 1: both workers start in parallel (independent subtrees) ──
  mission = os.applyMissionEvent(mission, { missionId: 'm_landing', taskId: 't1', kind: 'TASK_STARTED' })
  busy.cr = Date.now()
  assert.equal(os.teamPresence(roster[1], ctx([mission])), 'working', 'researcher working via canonical busy')

  // ── phase 2: research artifact lands as a REFERENCE (never a transcript dump) ──
  mission = os.applyMissionEvent(mission, { missionId: 'm_landing', taskId: 't1', kind: 'ARTIFACT_CREATED', artifact: 'research-report.md' })
  mission = os.applyMissionEvent(mission, { missionId: 'm_landing', taskId: 't1', kind: 'TASK_COMPLETED', summary: 'report ready' })
  assert.equal(mission.tasks[0].artifact, 'research-report.md')
  assert.equal(mission.tasks[0].status, 'done')

  // ── phase 3: frontend builds on it; artifact bus records prototype ──
  mission = os.applyMissionEvent(mission, { missionId: 'm_landing', taskId: 't2', kind: 'TASK_STARTED' })
  mission = os.applyMissionEvent(mission, { missionId: 'm_landing', taskId: 't2', kind: 'ARTIFACT_CREATED', artifact: 'prototype.zip' })
  mission = os.applyMissionEvent(mission, { missionId: 'm_landing', taskId: 't2', kind: 'TASK_COMPLETED' })

  // ── phase 4: bounded reviewer consensus over competing proposals ──
  let consensus = os.createConsensus(mission, 't3', ['reviewer', 'ops'], 'Ship prototype.zip or iterate?')
  consensus = os.addConsensusProposal(consensus, 'reviewer', 'Iterate once — nav contrast fails WCAG AA')
  consensus = os.addConsensusProposal(consensus, 'reviewer', 'dup ignored') // idempotent per author
  consensus = os.addConsensusProposal(consensus, 'ops', 'Ship now — traffic is waiting')
  consensus = os.decideConsensus(consensus, 'nexus', 'reviewer', 'Accessibility blocks launch')
  assert.equal(consensus.status, 'decided')
  assert.equal(consensus.decision.winner, 'reviewer')
  assert.equal(consensus.proposals.length, 2)

  // ── phase 5: deploy task fails → universal Needs You with attribution ──
  mission = os.applyMissionEvent(mission, { missionId: 'm_landing', taskId: 't3', kind: 'TASK_FAILED' })
  const needs = os.deriveNeedsYou({ roster, awaitingInputSessionIds: [], missions: [mission], groupNeedsYou: {} })
  const failedCard = needs.find(item => item.category === 'failed')
  assert.ok(failedCard, 'failed task surfaces')
  assert.equal(failedCard.missionId, 'm_landing')
  assert.equal(failedCard.taskId, 't3')
  assert.equal(failedCard.who, '@reviewer')
  assert.ok(failedCard.noActionConsequence)

  // ── phase 6: review gate — done task with artifact asks for review exactly once ──
  const reviewCards = needs.filter(item => item.category === 'review')
  assert.equal(reviewCards.length, 2, 't1+t2 artifacts await judgment')
  assert.ok(reviewCards.every(card => card.missionTitle === 'Landing page from competitor research'))

  // ── phase 7: everything completes → mission flips done honestly ──
  mission = os.applyMissionEvent(mission, { missionId: 'm_landing', taskId: 't3', kind: 'TASK_COMPLETED' })
  assert.equal(mission.status, 'done')
  const afterDone = os.deriveNeedsYou({ missions: [mission] })
  assert.equal(afterDone.filter(item => item.category === 'failed' || item.category === 'blocked').length, 0, 'failed card clears on completion')
  assert.equal(afterDone.filter(item => item.category === 'review').length, 2, 'unreviewed artifacts stay honestly pending')

  // ── phase 8: restart survival — normalize(serialize) round-trip keeps state ──
  const restored = os.normalizeMissions(JSON.parse(JSON.stringify([mission])))
  assert.equal(restored.length, 1)
  assert.equal(restored[0].status, 'done')
  assert.equal(restored[0].tasks[1].artifact, 'prototype.zip', 'artifact refs survive restart')
  assert.equal(os.missionTimeline(restored[0]).map(task => task.id).join(','), 't1,t2,t3', 'dependency order survives')

  // ── privacy invariant: presence derivation never reads private fields ──
  const privateBot = {
    name: 'frontend',
    canonical_session: { id: 'cf' },
    private_memory: 'SECRET-CONTENTS',
    soul: 'SECRET-SOUL',
    private_history: [{ text: 'SECRET-DM' }]
  }
  const presenceCtx = { awaitingInputSessionIds: [], busyBySession: {}, missions: [mission] }
  assert.equal(os.teamPresence(privateBot, presenceCtx), 'unknown')
})

test('INTEGRATED: swarm of 20 compresses while Needs You stays attributable', () => {
  const os = loadTeamOs()
  const rows = Array.from({ length: 20 }, (_, index) => ({ presence: index < 17 ? 'unknown' : index === 17 ? 'working' : 'blocked' }))
  const summary = os.swarmSummary(rows)
  assert.deepEqual([summary.total, summary.done, summary.working, summary.blocked], [20, 17, 1, 2])

  // attribution survives scale: each blocked member maps to its own task card
  const bigMission = {
    id: 'm_swarm', title: 'Research swarm', status: 'active', events: [],
    tasks: Array.from({ length: 3 }, (_, index) => ({
      id: `t${index}`, title: `Task ${index}`, status: 'blocked', assignee: `worker${index}`
    }))
  }
  const cards = os.deriveNeedsYou({ missions: [bigMission] }).filter(item => item.category === 'blocked')
  assert.equal(cards.length, 3)
  assert.deepEqual([...cards.map(card => card.who)].sort(), ['@worker0', '@worker1', '@worker2'])
})
