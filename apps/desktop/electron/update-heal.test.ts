/**
 * Tests for electron/update-heal.ts — the tracked-branch self-heal decision.
 *
 * Run with: npx vitest run --project electron electron/update-heal.test.ts
 *
 * `git ls-remote --exit-code` returns 2 both when a branch was merged and
 * deleted AND when it was never pushed. Healing on the second case re-pins a
 * user's private/local branch to main and rewrites their update config —
 * treating a branch that never existed upstream as "merged". The heal must
 * only fire when the branch once had a remote ref (remote-tracking ref or
 * branch.<name>.* upstream config); a never-pushed branch keeps its branch.
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import { resolveHealedBranch } from './update-heal'

function fakeGit(script: Array<{ match: string[], result: { code: number, stdout?: string, stderr?: string } }>) {
  const calls: string[][] = []

  const runGit = async (args: string[]) => {
    calls.push(args)

    for (const { match, result } of script) {
      if (match.every(m => args.includes(m))) {
        return { code: result.code, stdout: result.stdout || '', stderr: result.stderr || '' }
      }
    }

    return { code: 1, stdout: '', stderr: 'unexpected git args' }
  }

  return { runGit, calls }
}

function fakeConfig(branch: string) {
  const writes: Array<{ branch: string }> = []

  return {
    readConfig: () => ({ branch }),
    writeConfig: (config: { branch: string }) => writes.push(config),
    writes
  }
}

test('heals to main when the branch is absent upstream AND once had a remote ref', async () => {
  const { runGit } = fakeGit([
    { match: ['remote', 'get-url'], result: { code: 0, stdout: 'https://example.com/fork/repo.git\n' } },
    { match: ['ls-remote'], result: { code: 2 } },
    { match: ['rev-parse'], result: { code: 0, stdout: 'abc123\n' } }
  ])

  const { readConfig, writeConfig, writes } = fakeConfig('bb/gui')

  const healed = await resolveHealedBranch({ runGit, readConfig, writeConfig }, '/repo', 'bb/gui')

  assert.equal(healed, 'main')
  assert.deepEqual(writes, [{ branch: 'main' }])
})

test('keeps a never-pushed local branch instead of healing to main', async () => {
  const { runGit } = fakeGit([
    { match: ['remote', 'get-url'], result: { code: 0, stdout: 'https://example.com/fork/repo.git\n' } },
    { match: ['ls-remote'], result: { code: 2 } },
    // No refs/remotes/origin/<branch> and no branch.<name>.* upstream config.
    { match: ['rev-parse'], result: { code: 128 } },
    { match: ['config'], result: { code: 1 } }
  ])

  const { readConfig, writeConfig, writes } = fakeConfig('wip-local')

  const healed = await resolveHealedBranch({ runGit, readConfig, writeConfig }, '/repo', 'wip-local')

  assert.equal(healed, 'wip-local')
  assert.deepEqual(writes, [])
})

test('does not heal on a transient ls-remote failure (non-2 exit)', async () => {
  const { runGit } = fakeGit([
    { match: ['remote', 'get-url'], result: { code: 0, stdout: 'https://example.com/fork/repo.git\n' } },
    { match: ['ls-remote'], result: { code: 128, stderr: 'Could not resolve host' } }
  ])

  const { readConfig, writeConfig, writes } = fakeConfig('bb/gui')

  const healed = await resolveHealedBranch({ runGit, readConfig, writeConfig }, '/repo', 'bb/gui')

  assert.equal(healed, 'bb/gui')
  assert.deepEqual(writes, [])
})

test('main and empty branch short-circuit without any git probes', async () => {
  const { runGit, calls } = fakeGit([])
  const { readConfig, writeConfig, writes } = fakeConfig('main')

  assert.equal(await resolveHealedBranch({ runGit, readConfig, writeConfig }, '/repo', 'main'), 'main')
  assert.equal(await resolveHealedBranch({ runGit, readConfig, writeConfig }, '/repo', ''), 'main')
  assert.deepEqual(calls, [])
  assert.deepEqual(writes, [])
})
