'use strict'

import { isOfficialSshRemote, OFFICIAL_REPO_HTTPS_URL } from './update-remote'

/**
 * update-heal.ts
 *
 * Self-heal for the tracked update branch, extracted from main.ts so the
 * decision is unit testable without booting Electron (main.ts
 * requires('electron') at load).
 *
 * If origin no longer publishes the configured branch (e.g. bb/gui was merged
 * into main and deleted), fall back to main and persist so every later
 * check/apply follows main — no manual flip, even for already-installed
 * clients. Read-only ls-remote probe; only flips on a definitive "ref absent"
 * (exit 2), never on a transient network error, so a flaky connection can't
 * strand a user on the wrong branch.
 */

export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

export interface ResolveHealedBranchDeps {
  runGit: (args: string[], options: { cwd: string }) => Promise<GitRunResult>
  readConfig: () => { branch: string }
  writeConfig: (config: { branch: string }) => void
  log?: (line: string) => void
}

async function getOriginUrl(deps: ResolveHealedBranchDeps, updateRoot: string): Promise<string> {
  const origin = await deps.runGit(['remote', 'get-url', 'origin'], { cwd: updateRoot })

  return origin.code === 0 ? origin.stdout.trim() : ''
}

// ls-remote --exit-code returns 2 both for "merged and deleted" AND for
// "never pushed". Healing a never-pushed branch would re-pin the user to main
// and rewrite their update config off a branch that only ever existed
// locally. Before healing, require evidence the branch once had an upstream:
// a leftover remote-tracking ref, or the branch.<name>.* config git writes
// when the branch is pushed with -u / tracks a remote head.
async function onceHadUpstream(deps: ResolveHealedBranchDeps, updateRoot: string, branch: string): Promise<boolean> {
  const trackingRef = await deps.runGit(
    ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
    { cwd: updateRoot }
  )

  if (trackingRef.code === 0) {
    return true
  }

  const upstreamConfig = await deps.runGit(['config', '--get', `branch.${branch}.remote`], { cwd: updateRoot })

  return upstreamConfig.code === 0 && upstreamConfig.stdout.trim().length > 0
}

export async function resolveHealedBranch(
  deps: ResolveHealedBranchDeps,
  updateRoot: string,
  branch: string
): Promise<string> {
  if (!branch || branch === 'main') {
    return branch || 'main'
  }

  const originUrl = await getOriginUrl(deps, updateRoot)
  const remote = isOfficialSshRemote(originUrl) ? OFFICIAL_REPO_HTTPS_URL : 'origin'
  const probe = await deps.runGit(['ls-remote', '--exit-code', '--heads', remote, branch], { cwd: updateRoot })

  if (probe.code !== 2) {
    return branch
  }

  if (!(await onceHadUpstream(deps, updateRoot, branch))) {
    deps.log?.(`[updates] ${branch} is absent upstream but was never pushed; keeping it`)

    return branch
  }

  deps.log?.(`[updates] origin/${branch} is gone (merged?); falling back to main`)
  const config = deps.readConfig()

  if (config.branch !== 'main') {
    deps.writeConfig({ ...config, branch: 'main' })
  }

  return 'main'
}
