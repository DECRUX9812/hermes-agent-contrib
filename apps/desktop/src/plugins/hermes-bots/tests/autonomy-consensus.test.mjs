import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../plugin.js', import.meta.url), 'utf8')

function loadAutonomyConsensus() {
  const start = source.indexOf('// ── slice 7: mission autonomy + bounded consensus')
  const end = source.indexOf('// ── roster pane ──')

  assert.ok(start >= 0 && end > start, 'slice-7 block must remain extractable')

  const context = { console }
  vm.runInNewContext(
    `${source.slice(start, end)}
globalThis.__ac = {
  AUTONOMY_LEVELS, autonomyPolicy, requiresHumanApproval,
  CONSENSUS_MAX_PROPOSALS, createConsensus, addConsensusProposal, decideConsensus
};`,
    context
  )

  return context.__ac
}

test('autonomy levels exist with safe defaults and bounded policies', () => {
  const { AUTONOMY_LEVELS, autonomyPolicy } = loadAutonomyConsensus()

  assert.deepEqual([...AUTONOMY_LEVELS], ['guided', 'balanced', 'autonomous'])
  // unknown/missing level → balanced (safe default)
  assert.equal(autonomyPolicy('bogus'), autonomyPolicy('balanced'))
  assert.equal(autonomyPolicy(undefined), autonomyPolicy('balanced'))

  // monotonic loosening, hard-capped
  assert.ok(autonomyPolicy('guided').maxRounds < autonomyPolicy('balanced').maxRounds)
  assert.ok(autonomyPolicy('balanced').maxRounds < autonomyPolicy('autonomous').maxRounds)
  assert.ok(autonomyPolicy('autonomous').maxAgents <= 12)
})

test('secrets and sudo ALWAYS require approval — no autonomy level bypasses', () => {
  const { requiresHumanApproval } = loadAutonomyConsensus()

  for (const level of ['guided', 'balanced', 'autonomous']) {
    assert.equal(requiresHumanApproval({ kind: 'secret' }, level), true)
    assert.equal(requiresHumanApproval({ kind: 'sudo' }, level), true)
    assert.equal(requiresHumanApproval(null, level), true, 'garbage fails closed to asking')
  }

  // external side effects follow the policy
  assert.equal(requiresHumanApproval({ kind: 'external' }, 'guided'), true)
  assert.equal(requiresHumanApproval({ kind: 'external' }, 'balanced'), true)
  assert.equal(requiresHumanApproval({ kind: 'external' }, 'autonomous'), false)
})

test('consensus is bounded at creation and cannot exceed the proposal cap', () => {
  const { createConsensus, addConsensusProposal, CONSENSUS_MAX_PROPOSALS } = loadAutonomyConsensus()

  const mission = { id: 'm1' }
  const consensus = createConsensus(mission, 't1', ['a', 'researcher', 'reviewer', 'ops', 'frontend', 'x'], 'Which design?')
  assert.ok(consensus, 'valid inputs produce a frame')
  assert.equal(consensus.targets.length, CONSENSUS_MAX_PROPOSALS, 'targets capped')
  assert.equal(consensus.status, 'open')

  assert.equal(createConsensus(mission, 't1', [], '?'), null, 'no targets → null')
  assert.equal(createConsensus(mission, 't1', ['a'], '   '), null, 'empty question → null')
  assert.equal(createConsensus(null, 't1', ['a'], 'q'), null)

  // duplicate authors collapse; cap enforced (cap is 4, frame has 3 targets)
  let frame = createConsensus(mission, 't1', ['a', 'b', 'c'], 'Pick one')
  frame = addConsensusProposal(frame, 'a', 'proposal A')
  frame = addConsensusProposal(frame, 'a', 'dup ignored')
  frame = addConsensusProposal(frame, 'b', 'proposal B')
  frame = addConsensusProposal(frame, 'c', 'proposal C')
  assert.equal(frame.proposals.length, 3)
  assert.ok(!frame.proposals.some(entry => entry.author === 'dup'))

  // a 4-target frame fills to the cap and rejects a 5th author
  let full = createConsensus(mission, 't1', ['w', 'x', 'y', 'z'], 'Pick')
  for (const who of ['w', 'x', 'y', 'z']) {
    full = addConsensusProposal(full, who, `p-${who}`)
  }
  full = addConsensusProposal(full, 'extra', 'over cap, rejected')
  assert.equal(full.proposals.length, CONSENSUS_MAX_PROPOSALS)
  assert.ok(!full.proposals.some(entry => entry.author === 'extra'))
})

test('decision closes the consensus; late proposals are ignored forever', () => {
  const { createConsensus, addConsensusProposal, decideConsensus } = loadAutonomyConsensus()

  let frame = createConsensus({ id: 'm1' }, 't1', ['a', 'b'], 'Architecture?')
  frame = addConsensusProposal(frame, 'a', 'Option A')
  frame = addConsensusProposal(frame, 'b', 'Option B')

  frame = decideConsensus(frame, 'reviewer', 'b', 'B handles a11y better')
  assert.equal(frame.status, 'decided')
  assert.equal(frame.decision.winner, 'b')
  assert.equal(frame.decision.judge, 'reviewer')

  const before = JSON.stringify(frame)
  frame = addConsensusProposal(frame, 'c', 'too late')
  frame = decideConsensus(frame, 'other-judge', 'a', 're-decide attempt')
  assert.equal(JSON.stringify(frame), before, 'decided frame is immutable to new proposals/re-decisions')

  // unknown winner records an honest null rather than inventing a winner
  let orphan = createConsensus({ id: 'm2' }, 't9', ['a'], 'q')
  orphan = decideConsensus(orphan, 'j', 'ghost', 'n/a')
  assert.equal(orphan.decision.winner, null)
})
