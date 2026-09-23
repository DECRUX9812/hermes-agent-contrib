/**
 * Tests for electron/update-branch-heal.ts — the branch-pin healing decision
 * behind resolveHealedBranch() in main.ts (#105042).
 *
 * Why this matters: `git ls-remote --exit-code` exit 2 means only "no matching
 * ref on the remote". It is true for a branch deleted after merge AND for a
 * branch that was never pushed. Healing a never-pushed branch to main moves
 * the running code off the user's only copy of their local commits — quietly:
 * clean tree, no error, one log line. The remote answer cannot separate the
 * two cases, so the decision keys on local facts: did the branch ever publish
 * (remote-tracking ref or configured upstream), and does it still carry
 * commits origin/main lacks.
 */

import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { decideHealedBranch, gatherBranchHealFacts, HEAL_TARGET_BRANCH } from './update-branch-heal'

// ── Pure decision matrix ────────────────────────────────────────────────

const facts = (over: object) => ({
  lsRemoteExitCode: 2,
  hasRemoteTrackingRef: false,
  hasConfiguredUpstream: false,
  commitsNotInMain: null,
  ...over
})

test('a ref still on the remote keeps the pin with nothing to log', () => {
  const decision = decideHealedBranch('feature', facts({ lsRemoteExitCode: 0 }))

  assert.equal(decision.branch, 'feature')
  assert.equal(decision.reason, null)
})

test('an inconclusive probe (network/auth failure) keeps the pin', () => {
  // Only a definitive exit 2 may heal; 128 is a transport/auth error.
  for (const lsRemoteExitCode of [1, 128, null]) {
    const decision = decideHealedBranch('feature', facts({ lsRemoteExitCode }))

    assert.equal(decision.branch, 'feature')
    assert.equal(decision.reason, null)
  }
})

test('a never-pushed branch keeps the pin — exit 2 alone is not "merged, gone" (#105042)', () => {
  // No remote-tracking ref, no upstream: this branch has NEVER published, so
  // the absent remote ref proves nothing. Both the work-carrying case and the
  // zero-commit case keep the pin — the user's checkout intent is explicit
  // either way.
  for (const commitsNotInMain of [3, 0, null]) {
    const decision = decideHealedBranch(
      'hermes-local',
      facts({ lsRemoteExitCode: 2, hasRemoteTrackingRef: false, hasConfiguredUpstream: false, commitsNotInMain })
    )

    assert.equal(decision.branch, 'hermes-local')
    assert.ok(decision.reason)
  }
})

test('a published branch whose deletion left unmerged commits keeps the pin', () => {
  // Tracking ref exists (was pushed) but the branch carries commits main
  // lacks — healing would move the running code off work that never merged.
  const decision = decideHealedBranch(
    'wip',
    facts({ lsRemoteExitCode: 2, hasRemoteTrackingRef: true, commitsNotInMain: 2 })
  )

  assert.equal(decision.branch, 'wip')
  assert.ok(decision.reason)
})

test('a published branch with unverifiable history keeps the pin', () => {
  const decision = decideHealedBranch(
    'wip',
    facts({ lsRemoteExitCode: 2, hasRemoteTrackingRef: true, commitsNotInMain: null })
  )

  assert.equal(decision.branch, 'wip')
  assert.ok(decision.reason)
})

test('a published, fully-merged branch deleted upstream still heals to main', () => {
  // The case the healer exists for: tracking ref proves it published, and
  // nothing on the branch is missing from origin/main.
  for (const proof of [
    { hasRemoteTrackingRef: true, hasConfiguredUpstream: false },
    { hasRemoteTrackingRef: false, hasConfiguredUpstream: true }
  ]) {
    const decision = decideHealedBranch(
      'merged-branch',
      facts({ lsRemoteExitCode: 2, commitsNotInMain: 0, ...proof })
    )

    assert.equal(decision.branch, HEAL_TARGET_BRANCH)
    assert.ok(decision.reason)
  }
})

// ── Real git: gatherBranchHealFacts → decideHealedBranch ────────────────

const realRunGit = (args: string[], { cwd }: { cwd: string }) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0

      resolve({ code, stdout, stderr })
    })
  })

const realRunGitSync = (cwd: string, args: string[]) => {
  try {
    return {
      code: 0,
      stdout: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
      stderr: ''
    }
  } catch (error: any) {
    return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

const gitSync = (cwd: string, ...args: string[]) => {
  const result = realRunGitSync(cwd, args)

  assert.equal(result.code, 0, `git ${args.join(' ')} failed: ${result.stderr}`)

  return result.stdout
}

/**
 * Build a work repo cloned from a local bare "remote" so every git call —
 * including `ls-remote` — runs against real plumbing with no network.
 * Returns { work, remote } paths; the work clone starts on main with one
 * commit already pushed (so refs/remotes/origin/main exists).
 */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-heal-'))
  const remote = path.join(root, 'remote.git')
  const seed = path.join(root, 'seed')
  const work = path.join(root, 'work')

  gitSync(root, 'init', '--bare', '-b', 'main', remote)
  gitSync(root, 'init', '-b', 'main', seed)
  gitSync(seed, 'config', 'user.email', 'test@example.com')
  gitSync(seed, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(seed, 'file.txt'), 'seed\n')
  gitSync(seed, 'add', 'file.txt')
  gitSync(seed, 'commit', '-m', 'seed')
  gitSync(seed, 'remote', 'add', 'origin', remote)
  gitSync(seed, 'push', 'origin', 'main')
  gitSync(root, 'clone', remote, work)
  gitSync(work, 'config', 'user.email', 'test@example.com')
  gitSync(work, 'config', 'user.name', 'Test')

  return { root, remote, work }
}

const commitOnBranch = (work: string, branch: string, file: string) => {
  gitSync(work, 'checkout', '-b', branch)
  fs.writeFileSync(path.join(work, file), `${file}\n`)
  gitSync(work, 'add', file)
  gitSync(work, 'commit', '-m', `add ${file}`)
}

test('real git: a never-pushed local branch resolves facts that keep the pin', async () => {
  const { remote, work } = makeRepo()

  commitOnBranch(work, 'hermes-local', 'local-only.txt')

  const resolved = await gatherBranchHealFacts(realRunGit, { cwd: work, remote, branch: 'hermes-local' })
  // The premise: ls-remote exit 2 on a branch that was never pushed.
  assert.equal(resolved.lsRemoteExitCode, 2)
  assert.equal(resolved.hasRemoteTrackingRef, false)
  assert.equal(resolved.hasConfiguredUpstream, false)
  assert.equal(resolved.commitsNotInMain, 1)

  const decision = decideHealedBranch('hermes-local', resolved)

  assert.equal(decision.branch, 'hermes-local')
})

test('real git: a pushed-then-merged-then-deleted branch still heals to main', async () => {
  const { remote, work } = makeRepo()

  commitOnBranch(work, 'merged-branch', 'merged.txt')
  gitSync(work, 'push', 'origin', 'merged-branch')
  // Merge into main on the remote and delete the branch ref there; a local
  // fetch updates origin/main while the stale tracking ref survives — the
  // exact shape of "pushed, merged, deleted".
  gitSync(work, 'checkout', 'main')
  gitSync(work, 'merge', '--no-edit', 'merged-branch')
  gitSync(work, 'push', 'origin', 'main')
  gitSync(remote, 'update-ref', '-d', 'refs/heads/merged-branch')
  gitSync(work, 'fetch', 'origin')
  gitSync(work, 'checkout', 'merged-branch')

  const resolved = await gatherBranchHealFacts(realRunGit, { cwd: work, remote, branch: 'merged-branch' })

  assert.equal(resolved.lsRemoteExitCode, 2)
  assert.equal(resolved.hasRemoteTrackingRef, true)
  assert.equal(resolved.commitsNotInMain, 0)

  const decision = decideHealedBranch('merged-branch', resolved)

  assert.equal(decision.branch, HEAL_TARGET_BRANCH)
})

test('real git: a pushed-then-deleted branch with unmerged commits keeps the pin', async () => {
  const { remote, work } = makeRepo()

  commitOnBranch(work, 'closed-unmerged', 'wip.txt')
  gitSync(work, 'push', 'origin', 'closed-unmerged')
  // Deleted upstream WITHOUT merging (e.g. a closed PR). The stale tracking
  // ref remains locally; the commits are nowhere in origin/main.
  gitSync(remote, 'update-ref', '-d', 'refs/heads/closed-unmerged')
  gitSync(work, 'fetch', 'origin')

  const resolved = await gatherBranchHealFacts(realRunGit, { cwd: work, remote, branch: 'closed-unmerged' })

  assert.equal(resolved.lsRemoteExitCode, 2)
  assert.equal(resolved.hasRemoteTrackingRef, true)
  assert.equal(resolved.commitsNotInMain, 1)

  const decision = decideHealedBranch('closed-unmerged', resolved)

  assert.equal(decision.branch, 'closed-unmerged')
})
