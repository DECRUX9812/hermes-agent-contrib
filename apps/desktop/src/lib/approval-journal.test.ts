import type { ForkApproval } from '@hermes/shared'
import { describe, expect, it } from 'vitest'

import { mergePendingApprovals } from './approval-journal'

const journalRow = (requestId: string, status: ForkApproval['status'] = 'pending'): ForkApproval => ({
  command: `echo ${requestId}`,
  created_at: 1,
  description: `Run ${requestId}`,
  request_id: requestId,
  status,
  tool_call_id: `call-${requestId}`,
  tool_name: 'terminal'
})

describe('mergePendingApprovals', () => {
  it('merges live requests with pending journal rows once by request_id', () => {
    const live = [
      {
        command: 'echo live',
        description: '',
        requestId: 'same',
        serverRequestId: 'srq-live',
        sessionId: 'runtime-1'
      }
    ]

    const merged = mergePendingApprovals(
      live,
      [journalRow('same'), journalRow('restored'), journalRow('already-answered', 'allowed')],
      'runtime-1'
    )

    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({
      command: 'echo live',
      description: 'Run same',
      requestId: 'same',
      serverRequestId: 'srq-live',
      toolName: 'terminal'
    })
    expect(merged[1]).toMatchObject({
      command: 'echo restored',
      requestId: 'restored',
      sessionId: 'runtime-1',
      toolName: 'terminal'
    })
  })
})
