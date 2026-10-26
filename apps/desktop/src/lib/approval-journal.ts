import type { ForkApproval } from '@hermes/shared'

import type { ApprovalRequest } from '@/store/prompts'

/** Merge live server requests with durable pending rows, preferring the live
 *  request because it carries the response route for its owning socket. */
const LIVE_ONLY_PREFIX = 'live:'

/** The journal id behind a merged approval, or undefined for a live prompt
 *  keyed only by its socket request (no journal row to answer). */
export function journalRequestId(requestId: string | undefined): string | undefined {
  return requestId && !requestId.startsWith(LIVE_ONLY_PREFIX) ? requestId : undefined
}

export function mergePendingApprovals(
  liveRequests: readonly ApprovalRequest[],
  journalRows: readonly ForkApproval[],
  runtimeSessionId: string
): Array<ApprovalRequest & { requestId: string }> {
  const pendingRows = new Map(
    journalRows.filter(row => row.status === 'pending').map(row => [row.request_id, row])
  )

  const merged = new Map<string, ApprovalRequest & { requestId: string }>()

  for (const live of liveRequests) {
    // A gateway without the journal sends no request id; key the live prompt by
    // its socket request so it still shows (answers go back over that socket).
    const requestId = live.requestId || `${LIVE_ONLY_PREFIX}${live.serverRequestId ?? live.sessionId ?? runtimeSessionId}`
    const row = live.requestId ? pendingRows.get(live.requestId) : undefined

    merged.set(requestId, {
      ...live,
      command: live.command || row?.command || '',
      description: live.description || row?.description || '',
      requestId,
      toolName: live.toolName || row?.tool_name
    })
  }

  for (const [requestId, row] of pendingRows) {
    if (merged.has(requestId)) {
      continue
    }

    merged.set(requestId, {
      command: row.command,
      description: row.description,
      requestId,
      sessionId: runtimeSessionId,
      toolName: row.tool_name
    })
  }

  return [...merged.values()]
}
