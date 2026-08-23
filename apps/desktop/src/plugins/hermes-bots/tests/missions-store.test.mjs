import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function loadMissionHelpers() {
  const start = source.indexOf('const MISSIONS_KEY')
  const end = source.indexOf('function botOwner(')

  assert.ok(start >= 0 && end > start, 'mission store must remain an extractable pure block')

  const context = { console, atom: value => ({ get: () => value, set: () => undefined }) }
  vm.runInNewContext(
    `${source.slice(start, end)}
globalThis.__helpers = { normalizeMission, normalizeMissions, applyMissionEvent, missionTimeline, createMission, recordMissionEvent };`,
    context
  )

  return context.__helpers
}

function baseMission() {
  return {
    id: 'm_test',
    title: 'Website redesign',
    goal: '',
    status: 'active',
    autonomy: 'balanced',
    createdAt: 1,
    updatedAt: 1,
    tasks: [
      { id: 't1', title: 'Research competitors', status: 'done', assignee: 'researcher', dependsOn: [], artifact: '', outcome: '' },
      { id: 't2', title: 'Build prototype', status: 'todo', assignee: '', dependsOn: ['t1'], artifact: '', outcome: '' },
      { id: 't3', title: 'Review implementation', status: 'waiting', assignee: 'reviewer', dependsOn: ['t2'], artifact: '', outcome: '' }
    ],
    events: []
  }
}

test('normalizeMission drops garbage and keeps valid missions honest', () => {
  const { normalizeMission } = loadMissionHelpers()

  assert.equal(normalizeMission(null), null)
  assert.equal(normalizeMission('nope'), null)
  assert.equal(normalizeMission({ id: '' }), null)
  assert.equal(normalizeMission({ id: 'bad id!' }), null)

  const mission = normalizeMission(baseMission())
  assert.equal(mission.id, 'm_test')
  assert.equal(mission.status, 'active')
  assert.equal(mission.tasks.length, 3)
  // unknown task status → todo (never invented states)
  const odd = normalizeMission({
    id: 'x1',
    tasks: [{ id: 'a', title: 'T', status: 'vibing' }]
  })
  assert.equal(odd.tasks[0].status, 'todo')
})

test('applyMissionEvent drives task lifecycle without inventing progress', () => {
  const { applyMissionEvent } = loadMissionHelpers()
  let mission = baseMission()

  mission = applyMissionEvent(mission, { missionId: 'm_test', taskId: 't2', kind: 'TASK_STARTED', at: 5 })
  assert.equal(mission.tasks[1].status, 'working')
  assert.equal(mission.events.length, 1)

  // assignment only fills an empty assignee — never overwrites a human decision
  mission = applyMissionEvent(mission, { missionId: 'm_test', taskId: 't2', kind: 'TASK_ASSIGNED', assignee: 'frontend', at: 6 })
  assert.equal(mission.tasks[1].assignee, 'frontend')

  mission = applyMissionEvent(mission, { missionId: 'm_test', taskId: 't2', kind: 'TASK_COMPLETED', summary: 'prototype.zip ready', at: 7 })
  assert.equal(mission.tasks[1].status, 'done')
  assert.equal(mission.tasks[1].outcome, 'prototype.zip ready')

  mission = applyMissionEvent(mission, { missionId: 'm_test', taskId: 't3', kind: 'TASK_FAILED', at: 8 })
  assert.equal(mission.tasks[2].status, 'failed')

  // foreign events are ignored wholesale
  const before = JSON.stringify(mission)
  mission = applyMissionEvent(mission, { missionId: 'other', taskId: 't3', kind: 'TASK_STARTED', at: 9 })
  assert.equal(JSON.stringify(mission), before)

  // unknown task ids change nothing
  mission = applyMissionEvent(mission, { missionId: 'm_test', taskId: 'ghost', kind: 'TASK_STARTED', at: 10 })
  assert.equal(mission.events.length, 4)
})

test('mission auto-completes only when every task is done — never on failure', () => {
  const { applyMissionEvent } = loadMissionHelpers()
  let mission = baseMission()

  mission = applyMissionEvent(mission, { missionId: 'm_test', taskId: 't2', kind: 'TASK_COMPLETED', at: 5 })
  mission = applyMissionEvent(mission, { missionId: 'm_test', taskId: 't3', kind: 'TASK_COMPLETED', at: 6 })
  assert.equal(mission.status, 'done', 'all tasks done flips the mission honestly')
})

test('missionTimeline orders tasks by declared dependencies', () => {
  const { missionTimeline } = loadMissionHelpers()
  const ordered = missionTimeline(baseMission()).map(task => task.id)

  assert.deepEqual([...ordered], ['t1', 't2', 't3'])
  // cycles must not hang or explode
  const cyclic = missionTimeline({
    tasks: [
      { id: 'a', title: 'A', status: 'todo', dependsOn: ['b'] },
      { id: 'b', title: 'B', status: 'todo', dependsOn: ['a'] }
    ]
  })
  assert.equal(cyclic.length, 2)
})

test('ARTIFACT_CREATED records the reference without inventing status', () => {
  const { applyMissionEvent } = loadMissionHelpers()
  let mission = baseMission()

  mission = applyMissionEvent(mission, {
    missionId: 'm_test',
    taskId: 't1',
    kind: 'ARTIFACT_CREATED',
    artifact: 'research-report.md',
    at: 11
  })
  assert.equal(mission.tasks[0].artifact, 'research-report.md')
  assert.equal(mission.tasks[0].status, 'done', 'artifact never flips status by itself')
  assert.equal(mission.events.length, 1)

  // empty/missing artifact refs change nothing
  const before = JSON.stringify(mission)
  mission = applyMissionEvent(mission, { missionId: 'm_test', taskId: 't2', kind: 'ARTIFACT_CREATED', artifact: '   ', at: 12 })
  assert.equal(JSON.stringify(mission), before)
})

test('Bots pane renders Missions strip before Needs you with hydration gate', () => {
  const missionsStrip = source.indexOf('jsx(MissionsStrip, {})')
  const needsYou = source.indexOf('jsx(NeedsYouStrip, {')

  assert.ok(missionsStrip >= 0 && needsYou > missionsStrip, 'missions precede attention strips')
  assert.match(source, /void hydrateMissions\(ctx\.storage\)/)
  assert.match(source, /const \$missionsHydrated = atom\(false\)/)
})
