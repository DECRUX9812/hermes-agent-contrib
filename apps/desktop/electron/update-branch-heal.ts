/**
 * Branch-pin healing decision for the self-update flow (resolveHealedBranch
 * in main.ts).
 *
 * The healer probes `git ls-remote --exit-code --heads <remote> <branch>`;
 * exit code 2 means only "no matching ref on the remote". That is true for a
 * branch deleted after merge — the case the healer was built for — but
 * equally true for a branch that was NEVER PUSHED: every purely local
 * branch. Treating both as "merged, gone" silently re-pins the update to
 * main and moves the running code off the user's only copy of their local
 * commits (#105042).
 *
 * The remote cannot tell the two apart, but local git state can:
 *
 *  - `refs/remotes/origin/<branch>` existing (or a configured
 *    `<branch>@{upstream}`) proves the branch published at some point — so a
 *    now-absent remote ref really was deleted upstream;
 *  - `git rev-list --count origin/main..<branch>` > 0 proves the branch still
 *    carries commits main lacks — healing would move the running code off
 *    them.
 *
 * Only a branch that demonstrably published AND carries nothing main lacks
 * heals to main. Everything else keeps the pin: a never-pushed branch is the
 * user's work-in-place, a deleted branch with unmerged commits must fail
 * loudly at fetch rather than silently retarget, and an unverifiable count
 * must not re-pin the checkout on a guess — healing needs positive proof,
 * not absence of disproof.
 *
 * Pure (no I/O of its own) so the decision is unit-testable without booting
 * Electron (main.ts requires('electron') at load); main.ts gathers the git
 * facts via gatherBranchHealFacts and wires them in.
 */

export const HEAL_TARGET_BRANCH = 'main'

export type GitRunner = (
  args: string[],
  options: { cwd: string }
) => Promise<{ code: number | null; stdout: string; stderr: string }>

export interface BranchHealFacts {
  /**
   * Exit code of `git ls-remote --exit-code --heads <remote> <branch>`.
   * 2 is the ONLY definitive "no such ref" answer; 0 means the ref exists,
   * anything else (network, auth, missing remote) is inconclusive.
   */
  lsRemoteExitCode: number | null
  /** `refs/remotes/origin/<branch>` exists locally: proof the branch published once. */
  hasRemoteTrackingRef: boolean
  /** `<branch>@{upstream}` resolves: an upstream is configured for the branch. */
  hasConfiguredUpstream: boolean
  /** `git rev-list --count origin/main..<branch>`; null when unverifiable. */
  commitsNotInMain: number | null
}

export interface BranchHealDecision {
  /** The branch the update should target — the pin itself, or 'main' when healed. */
  branch: string
  /** Log-worthy rationale; null when the remote answered anything but "absent". */
  reason: string | null
}

/**
 * All four probes, run together: the remote `ls-remote` plus the three local
 * reads that separate "deleted after merge" from "never pushed". The local
 * reads key on the remote NAME ('origin') — remote-tracking refs live under
 * the name, never under the anonymous HTTPS URL the caller may substitute
 * for an SSH origin.
 */
export async function gatherBranchHealFacts(
  runGit: GitRunner,
  { cwd, remote, branch }: { cwd: string; remote: string; branch: string }
): Promise<BranchHealFacts> {
  const [probe, trackingRef, upstream, ahead] = await Promise.all([
    runGit(['ls-remote', '--exit-code', '--heads', remote, branch], { cwd }),
    runGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd }),
    runGit(['rev-parse', '--verify', '--quiet', `${branch}@{upstream}`], { cwd }),
    runGit(['rev-list', '--count', `origin/${HEAL_TARGET_BRANCH}..${branch}`], { cwd })
  ])

  const aheadCount = ahead.code === 0 ? Number.parseInt(ahead.stdout.trim(), 10) : Number.NaN

  return {
    lsRemoteExitCode: probe.code,
    hasRemoteTrackingRef: trackingRef.code === 0,
    hasConfiguredUpstream: upstream.code === 0,
    commitsNotInMain: Number.isFinite(aheadCount) ? aheadCount : null
  }
}

export function decideHealedBranch(branch: string, facts: BranchHealFacts): BranchHealDecision {
  // A present ref (0) or any inconclusive probe keeps the pin untouched —
  // only a definitive "no such ref" (2) may heal at all.
  if (facts.lsRemoteExitCode !== 2) {
    return { branch, reason: null }
  }

  if (!facts.hasRemoteTrackingRef && !facts.hasConfiguredUpstream) {
    return {
      branch,
      reason:
        `origin/${branch} is absent but no remote-tracking ref or upstream exists — ` +
        'the branch was never pushed, not deleted; keeping the branch pin'
    }
  }

  if (facts.commitsNotInMain === null) {
    return {
      branch,
      reason:
        `origin/${branch} is gone but the branch's history could not be checked against ` +
        `origin/${HEAL_TARGET_BRANCH}; keeping the branch pin`
    }
  }

  if (facts.commitsNotInMain > 0) {
    return {
      branch,
      reason:
        `origin/${branch} is gone but ${facts.commitsNotInMain} commit(s) are not in ` +
        `origin/${HEAL_TARGET_BRANCH}; keeping the branch pin`
    }
  }

  return {
    branch: HEAL_TARGET_BRANCH,
    reason: `origin/${branch} is gone (merged?); falling back to ${HEAL_TARGET_BRANCH}`
  }
}
