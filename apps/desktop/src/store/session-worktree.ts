/** Per-session worktree isolation (roadmap #47), opt-in per session.
 *
 *  "Isolate in worktree" re-homes the session's cwd into
 *  `<repo>/.worktrees/session-<slug>` on a `hermes/session-<slug>` branch —
 *  the same shape `startWorkInRepo` produces, so the sidebar's existing
 *  `.worktrees/` lanes and worktree probe pick the session up for free. The
 *  re-home itself is the backend's `session.workspace.move` (it handles a
 *  live agent mid-turn and rewrites the row's git meta).
 *
 *  "Merge back" folds the worktree's live branch into the repo's MAIN
 *  checkout via `git merge --no-edit`. Restore: opening a session whose
 *  worktree dir was deleted recreates it (its branch first, HEAD if the
 *  branch went with it).
 *
 *  Git access goes through `desktopGit()`, which already picks the Electron
 *  IPC bridge locally and the backend's /api/git mirror on a remote gateway —
 *  one code path for both. */
import { translateNow } from '@/i18n'
import { isDesktopFsRemoteMode } from '@/lib/desktop-fs'
import { desktopGit } from '@/lib/desktop-git'
import { isMissingRestEndpoint } from '@/lib/gateway-rpc'
import { cleanPath, isUnderPath } from '@/lib/path-compare'
import { $gateway } from '@/store/gateway'
import { projectProfile, refreshWorktrees } from '@/store/projects'
import { $sessions, sessionMatchesStoredId, setSessions } from '@/store/session'
import { ambientRequestFor } from '@/store/session-gone-latch'
import { requestForOwnedSession } from '@/store/session-states'
import type { SessionInfo } from '@/types/hermes'

export interface SessionWorktreeInfo {
  branch: string
  repoRoot: string
  /** The worktree dir — the session's cwd sits at or under it. */
  worktreePath: string
}

type WorktreeCapableSession = Pick<SessionInfo, 'cwd' | 'git_branch' | 'git_repo_root'>

/** Same slug rule as `worktree add` (electron slugify / web_git._slugify), so
 *  the name we predict here matches the dir/branch the ops actually make. */
export function worktreeSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')

  return slug || 'work'
}

/** Worktree membership, derived entirely from the session row: a cwd parked
 *  under the repo's own `.worktrees/` dir. Git is never probed — the row's
 *  server-resolved `git_repo_root` is authoritative. */
export function sessionWorktreeInfo(session: WorktreeCapableSession): null | SessionWorktreeInfo {
  const cwd = session.cwd?.trim() || ''
  const repoRoot = session.git_repo_root?.trim() || ''

  if (!cwd || !repoRoot) {
    return null
  }

  const worktreeRoot = `${cleanPath(repoRoot)}/.worktrees`

  if (!isUnderPath(worktreeRoot, cwd) || cleanPath(cwd) === worktreeRoot) {
    return null
  }

  // The worktree dir itself is the FIRST path segment under .worktrees/ — the
  // agent may have cd'd deeper during the session.
  const rest = cleanPath(cwd).slice(worktreeRoot.length + 1)

  return {
    branch: session.git_branch?.trim() || '',
    repoRoot,
    worktreePath: `${worktreeRoot}/${rest.split('/')[0]}`
  }
}

/** True when a session CAN be isolated: has a workspace cwd that is not a
 *  worktree already. The git probe stays out of this — a non-repo cwd fails
 *  inside `worktreeAdd` with its own clear error. */
export function canIsolateSession(session: WorktreeCapableSession): boolean {
  return Boolean(session.cwd?.trim()) && !sessionWorktreeInfo(session)
}

function worktreeSession(sessionId: string): SessionInfo | undefined {
  return $sessions.get().find(session => sessionMatchesStoredId(session, sessionId))
}

// A stale backend predates the two new routes; the raw "Expected JSON…"/404
// reads like a git error, so name the remedy instead (same gate as
// startWorkInRepo).
function staleBackendError(err: unknown): never {
  if (isDesktopFsRemoteMode() && isMissingRestEndpoint(err)) {
    throw new Error(translateNow('sidebar.projects.worktreeStaleBackend'))
  }

  throw err
}

/** Opt-in per session: move this conversation's workspace into a fresh
 *  worktree of the repo it already lives in. Returns the new branch for the
 *  caller's toast. Throws on failure — callers toast via notifyError. */
export async function isolateSessionToWorktree(sessionId: string): Promise<string> {
  const session = worktreeSession(sessionId)
  const cwd = session?.cwd?.trim() || ''
  const repoRoot = session?.git_repo_root?.trim() || cwd
  const git = desktopGit()

  if (!session || !cwd || !git) {
    throw new Error(translateNow('sidebar.row.worktreeUnavailable'))
  }

  const name = `session-${worktreeSlug(session.title || session.id)}`

  const added = await git.worktreeAdd(repoRoot, { name }).catch(err => staleBackendError(err))

  const profile = projectProfile()
  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error('Hermes gateway is not connected')
  }

  const res = await requestForOwnedSession<{ branch?: null | string; cwd: string; git_repo_root?: null | string }>(
    sessionId,
    ambientRequestFor(gateway),
    'session.workspace.move',
    { cwd: added.path, session_key: sessionId, ...(profile ? { profile } : {}) }
  )

  const moved = res.cwd || added.path

  setSessions(prev =>
    prev.map(s =>
      sessionMatchesStoredId(s, sessionId)
        ? {
            ...s,
            cwd: moved,
            git_branch: res.branch ?? added.branch,
            git_repo_root: res.git_repo_root ?? added.repoRoot
          }
        : s
    )
  )
  refreshWorktrees()

  return added.branch
}

/** Merge a worktree session's branch back into the repo's main checkout.
 *  Throws (with git's stderr) on conflict — callers toast via notifyError. */
export async function mergeSessionWorktree(sessionId: string): Promise<string> {
  const session = worktreeSession(sessionId)
  const info = session ? sessionWorktreeInfo(session) : null
  const git = desktopGit()

  if (!info || !git) {
    throw new Error(translateNow('sidebar.row.worktreeUnavailable'))
  }

  const res = await git.worktreeMerge(info.repoRoot, info.worktreePath).catch(err => staleBackendError(err))

  refreshWorktrees()

  return res.into
}

/** Restore kick, fired (best-effort, fire-and-forget) when a session whose
 *  stored cwd is a worktree path is opened: if the dir was deleted out from
 *  under the row, recreate it so the session's workspace exists again. Never
 *  throws into the open path — a restore failure must not block the chat. */
export async function restoreSessionWorktree(session: SessionInfo): Promise<void> {
  const info = sessionWorktreeInfo(session)
  const git = desktopGit()

  if (!info || !git) {
    return
  }

  try {
    const res = await git.worktreeEnsure(info.repoRoot, info.worktreePath, info.branch)

    if (res.restored) {
      refreshWorktrees()
      setSessions(prev =>
        prev.map(s => (sessionMatchesStoredId(s, session.id) ? { ...s, git_branch: res.branch || s.git_branch } : s))
      )
    }
  } catch {
    // The session opens anyway — a missing worktree dir surfaces when the
    // agent next writes a file, which is where the error belongs.
  }
}
