import type { ForkApproval } from '@hermes/shared'

import type { ApprovalRequest } from '@/store/prompts'

/** Merge live server requests with durable pending rows, preferring the live
 *  request because it carries the response route for its owning socket. */
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
    if (!live.requestId) {
      continue
    }

    const row = pendingRows.get(live.requestId)

    merged.set(live.requestId, {
      ...live,
      command: live.command || row?.command || '',
      description: live.description || row?.description || '',
      requestId: live.requestId,
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
