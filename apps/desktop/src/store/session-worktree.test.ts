import { beforeEach, describe, expect, it, vi } from 'vitest'

import { desktopGit } from '@/lib/desktop-git'
import { makeSessionInfo } from '@/test/session-info'

import { $gateway } from './gateway'
import { $sessions } from './session'
import {
  canIsolateSession,
  isolateSessionToWorktree,
  mergeSessionWorktree,
  restoreSessionWorktree,
  sessionWorktreeInfo,
  worktreeSlug
} from './session-worktree'

vi.mock('@/lib/desktop-fs', () => ({ isDesktopFsRemoteMode: () => false }))
vi.mock('@/lib/desktop-git', () => ({ desktopGit: vi.fn() }))
vi.mock('@/store/projects', () => ({ projectProfile: () => null, refreshWorktrees: vi.fn() }))
vi.mock('@/store/session-gone-latch', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>()

  return {
    ...actual,
    ambientRequestFor:
      (gateway: { request: (method: string, params?: Record<string, unknown>) => Promise<unknown> }) =>
      (method: string, params?: Record<string, unknown>) =>
        gateway.request(method, params)
  }
})

const desktopGitMock = vi.mocked(desktopGit)

const worktreeSession = () =>
  makeSessionInfo({
    cwd: '/repo/.worktrees/session-fix-bug',
    git_branch: 'hermes/session-fix-bug',
    git_repo_root: '/repo',
    id: 's1',
    title: 'Fix bug'
  })

describe('sessionWorktreeInfo', () => {
  it('is null without a cwd or a repo root', () => {
    expect(sessionWorktreeInfo(makeSessionInfo({ cwd: null, git_repo_root: '/repo' }))).toBeNull()
    expect(sessionWorktreeInfo(makeSessionInfo({ cwd: '/repo', git_repo_root: null }))).toBeNull()
  })

  it('is null for the main checkout and for a dir outside .worktrees', () => {
    expect(
      sessionWorktreeInfo(makeSessionInfo({ cwd: '/repo', git_repo_root: '/repo' }))
    ).toBeNull()
    expect(
      sessionWorktreeInfo(makeSessionInfo({ cwd: '/repo/src', git_repo_root: '/repo' }))
    ).toBeNull()
    expect(
      sessionWorktreeInfo(makeSessionInfo({ cwd: '/elsewhere/.worktrees/x', git_repo_root: '/repo' }))
    ).toBeNull()
  })

  it('finds the worktree dir as the first segment under .worktrees', () => {
    const info = sessionWorktreeInfo(worktreeSession())

    expect(info).toEqual({
      branch: 'hermes/session-fix-bug',
      repoRoot: '/repo',
      worktreePath: '/repo/.worktrees/session-fix-bug'
    })
  })

  it('resolves the worktree root when the session cd’d deeper', () => {
    const info = sessionWorktreeInfo(
      makeSessionInfo({
        cwd: '/repo/.worktrees/session-fix-bug/pkg/inner',
        git_branch: 'hermes/session-fix-bug',
        git_repo_root: '/repo'
      })
    )

    expect(info?.worktreePath).toBe('/repo/.worktrees/session-fix-bug')
  })

  it('tolerates Windows separators in the stored paths', () => {
    const info = sessionWorktreeInfo(
      makeSessionInfo({
        cwd: 'C:\\repo\\.worktrees\\sess',
        git_branch: 'b',
        git_repo_root: 'C:\\repo'
      })
    )

    expect(info?.worktreePath).toBe('C:/repo/.worktrees/sess')
  })
})

describe('worktreeSlug / canIsolateSession', () => {
  it('slugifies titles the way the git ops do', () => {
    expect(worktreeSlug('Fix the Login Bug!!')).toBe('fix-the-login-bug')
    expect(worktreeSlug('   ')).toBe('work')
    expect(worktreeSlug('x'.repeat(80))).toHaveLength(40)
  })

  it('offers isolate only for sessions with a cwd that is not a worktree', () => {
    expect(canIsolateSession(makeSessionInfo({ cwd: null }))).toBe(false)
    expect(canIsolateSession(worktreeSession())).toBe(false)
    expect(canIsolateSession(makeSessionInfo({ cwd: '/repo', git_repo_root: '/repo' }))).toBe(true)
  })
})

describe('isolateSessionToWorktree', () => {
  beforeEach(() => {
    $sessions.set([])
    $gateway.set(null)
    desktopGitMock.mockReset()
  })

  it('adds a session-<slug> worktree, then re-homes the row via session.workspace.move', async () => {
    $sessions.set([makeSessionInfo({ cwd: '/repo', git_repo_root: '/repo', id: 's1', title: 'Fix bug' })])

    const worktreeAdd = vi.fn(async () => ({
      branch: 'hermes/session-fix-bug',
      path: '/repo/.worktrees/session-fix-bug',
      repoRoot: '/repo'
    }))

    desktopGitMock.mockReturnValue({ worktreeAdd } as never)

    const request = vi.fn(async () => ({
      branch: 'hermes/session-fix-bug',
      cwd: '/repo/.worktrees/session-fix-bug',
      git_repo_root: '/repo'
    }))

    $gateway.set({ request } as never)

    const branch = await isolateSessionToWorktree('s1')

    expect(worktreeAdd).toHaveBeenCalledWith('/repo', { name: 'session-fix-bug' })
    expect(request).toHaveBeenCalledWith(
      'session.workspace.move',
      expect.objectContaining({ cwd: '/repo/.worktrees/session-fix-bug', session_key: 's1' })
    )
    expect(branch).toBe('hermes/session-fix-bug')
    expect($sessions.get()[0]?.cwd).toBe('/repo/.worktrees/session-fix-bug')
    expect($sessions.get()[0]?.git_branch).toBe('hermes/session-fix-bug')
  })

  it('throws without a git bridge rather than half-moving the session', async () => {
    $sessions.set([makeSessionInfo({ cwd: '/repo', id: 's1' })])
    desktopGitMock.mockReturnValue(undefined as never)

    await expect(isolateSessionToWorktree('s1')).rejects.toThrow()
    expect($sessions.get()[0]?.cwd).toBe('/repo')
  })
})

describe('mergeSessionWorktree / restoreSessionWorktree', () => {
  beforeEach(() => {
    $sessions.set([])
    $gateway.set(null)
    desktopGitMock.mockReset()
  })

  it('merges the worktree path derived from the session row', async () => {
    $sessions.set([worktreeSession()])

    const worktreeMerge = vi.fn(async () => ({
      branch: 'hermes/session-fix-bug',
      into: 'main',
      merged: true,
      repoRoot: '/repo'
    }))

    desktopGitMock.mockReturnValue({ worktreeMerge } as never)

    const into = await mergeSessionWorktree('s1')

    expect(worktreeMerge).toHaveBeenCalledWith('/repo', '/repo/.worktrees/session-fix-bug')
    expect(into).toBe('main')
  })

  it('restores a missing worktree dir and refreshes the row’s branch', async () => {
    $sessions.set([
      makeSessionInfo({
        cwd: '/repo/.worktrees/session-fix-bug',
        git_branch: null,
        git_repo_root: '/repo',
        id: 's1'
      })
    ])

    const worktreeEnsure = vi.fn(async () => ({
      branch: 'hermes/session-fix-bug',
      path: '/repo/.worktrees/session-fix-bug',
      repoRoot: '/repo',
      restored: true
    }))

    desktopGitMock.mockReturnValue({ worktreeEnsure } as never)

    await restoreSessionWorktree($sessions.get()[0]!)

    expect(worktreeEnsure).toHaveBeenCalledWith(
      '/repo',
      '/repo/.worktrees/session-fix-bug',
      ''
    )
    expect($sessions.get()[0]?.git_branch).toBe('hermes/session-fix-bug')
  })

  it('is a no-op for non-worktree sessions and never throws into the open path', async () => {
    const session = makeSessionInfo({ cwd: '/repo', git_repo_root: '/repo', id: 's1' })
    const worktreeEnsure = vi.fn()
    desktopGitMock.mockReturnValue({ worktreeEnsure } as never)

    await restoreSessionWorktree(session)
    expect(worktreeEnsure).not.toHaveBeenCalled()

    // A worktree row whose ensure call explodes still resolves — the chat must open.
    desktopGitMock.mockReturnValue({
      worktreeEnsure: vi.fn(async () => {
        throw new Error('git exploded')
      })
    } as never)
    await expect(restoreSessionWorktree(worktreeSession())).resolves.toBeUndefined()
  })
})
