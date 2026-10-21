import type { DelegationReport } from '@hermes/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  $delegationReportsBySession,
  $dismissedDelegationReports,
  dismissDelegationReport,
  forgetDelegationReports,
  refreshDelegationReports,
  reportChildSessionId,
  visibleDelegationReports
} from './delegation-reports'

const report = (id: string, extra: Partial<DelegationReport> = {}): DelegationReport => ({
  delegation_id: id,
  state: 'completed',
  outcome: 'done',
  title: `task ${id}`,
  summary: 'finished cleanly',
  summary_source: 'heuristic',
  task_count: 1,
  completed_count: 1,
  failed_count: 0,
  ...extra
})

describe('delegation report store', () => {
  beforeEach(() => {
    $delegationReportsBySession.set({})
    $dismissedDelegationReports.set({})
  })

  it('dismisses a card in its own profile bucket only', () => {
    $delegationReportsBySession.set({ s1: [report('d1'), report('d2')] })

    dismissDelegationReport('work', 'd1')

    expect(visibleDelegationReports('s1', 'work').map(r => r.delegation_id)).toEqual(['d2'])
    // Profiles are islands: the same delegation id stays visible elsewhere.
    expect(visibleDelegationReports('s1', 'personal').map(r => r.delegation_id)).toEqual(['d1', 'd2'])
  })

  it('normalizes the absent-profile bucket the same way on read and dismiss', () => {
    $delegationReportsBySession.set({ s1: [report('d1')] })
    dismissDelegationReport(null, 'd1')

    expect(visibleDelegationReports('s1', undefined)).toEqual([])
  })

  it('picks the lowest-indexed worker session for the open action', () => {
    expect(reportChildSessionId(report('d1', { child_session_ids: { '1': 'sess-b', '0': 'sess-a' } }))).toBe('sess-a')
    expect(reportChildSessionId(report('d1', { child_session_ids: {} }))).toBeNull()
    expect(reportChildSessionId(report('d1'))).toBeNull()
  })

  it('drops only the target session feed on forget', () => {
    $delegationReportsBySession.set({ s1: [report('d1')], s2: [report('d2')] })
    forgetDelegationReports('s1')
    forgetDelegationReports('missing')

    expect($delegationReportsBySession.get()).toEqual({ s2: [report('d2')] })
  })

  it('resolves quietly with no gateway bound and never drops the feed', async () => {
    $delegationReportsBySession.set({ s1: [report('d1')] })
    // No gateway in tests → early return. A transport blip must not blank
    // cards the user hasn't dismissed yet.
    await expect(refreshDelegationReports('s1')).resolves.toBeUndefined()
    expect($delegationReportsBySession.get().s1).toHaveLength(1)
  })
})
