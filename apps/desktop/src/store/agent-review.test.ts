import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as SessionsApi from '@/api/sessions'
import { createClientSessionState } from '@/lib/chat-runtime'

import { $agentReviewReportsBySession, forgetAgentReviewReports, seedAgentReview } from './agent-review'
import { adoptNewSessionDraft, announceNewSessionDraftKey, stashSessionDraft, takeSessionDraft } from './composer'
import { $dismissedDelegationReports, dismissDelegationReport, visibleDelegationReports } from './delegation-reports'
import { $newChatProfile } from './profile'
import { $reviewScopeCwd, $reviewScopeTarget } from './review'
import { $selectedStoredSessionId, $sessions, $unreadFinishedSessionIds } from './session'
import { $sessionStates } from './session-states'
import { $unreadFinishedMarkers } from './session-unread'

vi.mock('@/api/sessions', async importOriginal => {
  const actual = await importOriginal<typeof SessionsApi>()

  return {
    ...actual,
    getSessionMessages: vi.fn(async () => ({ messages: [] }))
  }
})

import { getSessionMessages } from '@/api/sessions'

const DIFF = 'diff --git a/x.ts b/x.ts\n+broken'

const savePastedText = vi.fn<(text: string) => Promise<string>>(async () => '/tmp/review-diff.txt')
const commitContext = vi.fn(async () => ({ diff: DIFF, recent: [] }))

function stubBridge() {
  vi.stubGlobal('window', {
    hermesDesktop: {
      savePastedText,
      git: { review: { commitContext } }
    }
  })
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('agent review pass', () => {
  beforeEach(() => {
    stubBridge()
    vi.clearAllMocks()
    savePastedText.mockResolvedValue('/tmp/review-diff.txt')
    commitContext.mockResolvedValue({ diff: DIFF, recent: [] })

    $reviewScopeCwd.set('/repo')
    $reviewScopeTarget.set('main')
    $selectedStoredSessionId.set('origin-1')
    $sessions.set([])
    $sessionStates.set({})
    $agentReviewReportsBySession.set({})
    $dismissedDelegationReports.set({})
    $unreadFinishedSessionIds.set([])
    $unreadFinishedMarkers.set({})
    stashSessionDraft('__new__:reviewer', '', [])
  })

  it('seeds a fresh draft on the reviewer profile carrying the diff attachment', async () => {
    await expect(seedAgentReview('reviewer', 'Reviewer Bot')).resolves.toBe(true)

    expect(savePastedText).toHaveBeenCalledWith(DIFF)
    expect(commitContext).toHaveBeenCalledWith('/repo')

    const draft = takeSessionDraft('__new__:reviewer')

    expect(draft.text).toContain('attached file')
    expect(draft.attachments).toHaveLength(1)
    expect(draft.attachments[0]).toMatchObject({ kind: 'file', path: '/tmp/review-diff.txt' })
    expect(draft.attachments[0].refText).toBe('@file:/tmp/review-diff.txt')

    // The next new-session send is pinned to the reviewer + the repo's cwd.
    expect($newChatProfile.get()).toBe('reviewer')
  })

  it('refuses when the pane has no diff to review', async () => {
    commitContext.mockResolvedValue({ diff: '   ', recent: [] })

    await expect(seedAgentReview('reviewer')).resolves.toBe(false)
    expect(savePastedText).not.toHaveBeenCalled()
  })

  it('refuses without a repo scope', async () => {
    $reviewScopeCwd.set(null)
    $selectedStoredSessionId.set(null)

    await expect(seedAgentReview('reviewer')).resolves.toBe(false)
  })

  it('lands a report card on the origin session once the review settles', async () => {
    vi.mocked(getSessionMessages).mockResolvedValue({
      messages: [
        { role: 'user', content: 'review this', created_at: 1 },
        { role: 'assistant', content: 'Looks fine.\nNit: naming.', created_at: 2 }
      ]
    } as never)

    await seedAgentReview('reviewer', 'Reviewer Bot')

    // First send mints the session: the composer announces its durable key and
    // the `__new__:reviewer` bucket adopts onto it.
    announceNewSessionDraftKey('sess-review-1')
    expect(adoptNewSessionDraft('sess-review-1')).toBe(true)
    expect(takeSessionDraft('sess-review-1').attachments).toHaveLength(1)

    // busy → idle edge on the review session.
    $sessionStates.set({
      'rt-1': { ...createClientSessionState('sess-review-1'), busy: true }
    })
    $sessionStates.set({
      'rt-1': { ...createClientSessionState('sess-review-1'), busy: false }
    })
    await flush()

    const reports = $agentReviewReportsBySession.get()['origin-1']

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      delegation_id: 'agent-review:sess-review-1',
      outcome: 'done',
      summary: 'Looks fine.',
      summary_source: 'heuristic',
      title: 'Review by Reviewer Bot'
    })
    expect(reports[0].child_session_ids).toEqual({ '0': 'sess-review-1' })

    // The origin row is flagged unread so the attention fold surfaces it.
    expect($unreadFinishedSessionIds.get()).toContain('origin-1')

    // The card unions into the shared visible feed and respects dismissal.
    expect(visibleDelegationReports('origin-1', null).map(r => r.delegation_id)).toEqual(['agent-review:sess-review-1'])
    dismissDelegationReport(null, 'agent-review:sess-review-1')
    expect(visibleDelegationReports('origin-1', null)).toEqual([])
  })

  it('marks needs_decision when the review session ends awaiting input', async () => {
    await seedAgentReview('reviewer')

    announceNewSessionDraftKey('sess-review-2')
    adoptNewSessionDraft('sess-review-2')

    $sessionStates.set({ 'rt-2': { ...createClientSessionState('sess-review-2'), busy: true } })
    $sessionStates.set({
      'rt-2': { ...createClientSessionState('sess-review-2'), busy: false, needsInput: true }
    })
    await flush()

    expect($agentReviewReportsBySession.get()['origin-1']?.[0].outcome).toBe('needs_decision')
  })

  it('drops the card feed with the origin session', async () => {
    await seedAgentReview('reviewer')
    announceNewSessionDraftKey('sess-review-3')
    adoptNewSessionDraft('sess-review-3')

    $sessionStates.set({ 'rt-3': { ...createClientSessionState('sess-review-3'), busy: true } })
    $sessionStates.set({ 'rt-3': { ...createClientSessionState('sess-review-3'), busy: false } })
    await flush()

    forgetAgentReviewReports('origin-1')
    expect($agentReviewReportsBySession.get()['origin-1']).toBeUndefined()
  })

  it('scopes a tile-targeted pane to its owning session, not the selection', async () => {
    $reviewScopeTarget.set('tile:tile-origin-9')
    $selectedStoredSessionId.set('other-1')

    await seedAgentReview('reviewer')
    announceNewSessionDraftKey('sess-review-4')
    adoptNewSessionDraft('sess-review-4')

    $sessionStates.set({ 'rt-4': { ...createClientSessionState('sess-review-4'), busy: true } })
    $sessionStates.set({ 'rt-4': { ...createClientSessionState('sess-review-4'), busy: false } })
    await flush()

    expect($agentReviewReportsBySession.get()['tile-origin-9']).toHaveLength(1)
    expect($agentReviewReportsBySession.get()['other-1']).toBeUndefined()
  })
})
