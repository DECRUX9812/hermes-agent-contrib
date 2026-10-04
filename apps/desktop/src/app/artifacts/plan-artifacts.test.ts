import { describe, expect, it } from 'vitest'

import { isPlanArtifact, planArtifactPath, planWorkspace } from './plan-artifacts'

const file = (value: string) => ({ kind: 'file' as const, value })

describe('planArtifactPath', () => {
  it('matches absolute .hermes/plans paths', () => {
    expect(planArtifactPath(file('/work/repo/.hermes/plans/2026-09-26_120000-fix-auth.md'))).toBe(
      '/work/repo/.hermes/plans/2026-09-26_120000-fix-auth.md'
    )
  })

  it('matches windows and file:// shapes', () => {
    expect(planArtifactPath(file('C:\\ws\\.hermes\\plans\\p.md'))).toBe('C:/ws/.hermes/plans/p.md')
    expect(planArtifactPath(file('file:///ws/.hermes/plans/p.md'))).toBe('/ws/.hermes/plans/p.md')
  })

  it('matches cwd-relative plan paths', () => {
    expect(planArtifactPath(file('.hermes/plans/p.md'))).toBe('.hermes/plans/p.md')
    expect(planArtifactPath(file('./.hermes/plans/p.md'))).toBe('.hermes/plans/p.md')
  })

  it('rejects non-plan files, links, and nested plan-like names', () => {
    expect(planArtifactPath(file('/ws/docs/plans/readme.md'))).toBeNull()
    expect(planArtifactPath(file('/ws/.hermes/plans/not-md.txt'))).toBeNull()
    expect(planArtifactPath(file('/ws/.hermes/plans/nested/p.md'))).toBeNull()
    expect(planArtifactPath(file('https://x.test/.hermes/plans/p.md'))).toBeNull()
    expect(planArtifactPath({ kind: 'link', value: '/ws/.hermes/plans/p.md' })).toBeNull()
  })
})

describe('isPlanArtifact', () => {
  it('is true only for plan file artifacts', () => {
    expect(isPlanArtifact(file('/w/.hermes/plans/a.md'))).toBe(true)
    expect(isPlanArtifact(file('/w/readme.md'))).toBe(false)
  })
})

describe('planWorkspace', () => {
  it('derives the workspace from an absolute plan path', () => {
    expect(planWorkspace(file('/work/repo/.hermes/plans/p.md'))).toEqual({
      relPath: '.hermes/plans/p.md',
      workspace: '/work/repo'
    })
  })

  it('uses the origin session cwd for relative plan paths', () => {
    expect(planWorkspace(file('.hermes/plans/p.md'), '/work/repo')).toEqual({
      relPath: '.hermes/plans/p.md',
      workspace: '/work/repo'
    })
    expect(planWorkspace(file('.hermes/plans/p.md'), '/work/repo/')).toEqual({
      relPath: '.hermes/plans/p.md',
      workspace: '/work/repo'
    })
  })

  it('refuses a relative plan with no resolvable workspace', () => {
    expect(planWorkspace(file('.hermes/plans/p.md'))).toBeNull()
    expect(planWorkspace(file('.hermes/plans/p.md'), '')).toBeNull()
  })

  it('returns null for non-plan artifacts', () => {
    expect(planWorkspace(file('/w/notes.md'), '/w')).toBeNull()
  })
})
