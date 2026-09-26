import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/oneshot', () => ({ requestOneShot: vi.fn(async () => '') }))
vi.mock('./coding-status', () => ({ refreshRepoStatus: vi.fn(), repoStatusForCwd: () => ({ get: () => null }) }))

import { clearSessionDraft, takeSessionDraft } from './composer'
import { $reviewScopeTarget, draftDiffComment, formatDiffComment } from './review'
import { $selectedStoredSessionId } from './session'

beforeEach(() => {
  $reviewScopeTarget.set('main')
  $selectedStoredSessionId.set(null)
})

describe('formatDiffComment', () => {
  it('formats a single-line anchor', () => {
    expect(formatDiffComment('src/x.ts', 40, 40, 'why not async?')).toBe('src/x.ts:40 — why not async?')
  })

  it('formats a range anchor', () => {
    expect(formatDiffComment('src/x.ts', 40, 52, 'rename this')).toBe('src/x.ts:40-52 — rename this')
  })
})

describe('draftDiffComment', () => {
  it('stashes onto the selected session when no composer claims the insert', async () => {
    $selectedStoredSessionId.set('s1')
    clearSessionDraft('s1')

    expect(await draftDiffComment('src/x.ts:40 — tighten this')).toBe(true)
    expect(takeSessionDraft('s1').text).toBe('src/x.ts:40 — tighten this')
  })

  it('appends to an existing draft with a blank line', async () => {
    $selectedStoredSessionId.set('s1')
    clearSessionDraft('s1')
    await draftDiffComment('src/x.ts:40 — first')

    expect(await draftDiffComment('src/y.ts:5-9 — second')).toBe(true)
    expect(takeSessionDraft('s1').text).toBe('src/x.ts:40 — first\n\nsrc/y.ts:5-9 — second')
  })

  it('a tile-scoped pane seeds that tile session, not the selected one', async () => {
    $selectedStoredSessionId.set('s-main')
    $reviewScopeTarget.set('tile:t1')
    clearSessionDraft('t1')
    clearSessionDraft('s-main')

    expect(await draftDiffComment('src/x.ts:1 — for the tile')).toBe(true)
    expect(takeSessionDraft('t1').text).toBe('src/x.ts:1 — for the tile')
    expect(takeSessionDraft('s-main').text).toBe('')
  })

  it('returns false when no session resolves at all', async () => {
    expect(await draftDiffComment('src/x.ts:1 — nowhere')).toBe(false)
  })
})
