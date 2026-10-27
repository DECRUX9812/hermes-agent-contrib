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

// Attribute-safe selector fragment. jsdom (vitest) does not ship `CSS.escape`.
const cssEscape = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }

  return value.replace(/[^a-zA-Z0-9_:-]/g, ch => `\\${ch}`)
}

/**
 * The pending-approval stack renders once per pane, tagged with the owning
 * session so a split view can't jump one pane's arrow into a sibling's
 * approval. `nearest` keeps this a minimal scroll within the transcript's own
 * scroll container instead of an unqualified scrollIntoView, which would also
 * nudge any overflow-hidden ancestor's programmatic scroll offset.
 */
export function findSessionApprovalStack(sessionId: string | null | undefined): HTMLElement | null {
  if (!sessionId) {
    return null
  }

  return document.querySelector<HTMLElement>(`[data-approval-stack][data-session-id="${cssEscape(sessionId)}"]`)
}

/**
 * Scrolls the session's pending approval stack into view (`block: 'nearest'`).
 * Returns true if the approval stack element was found and scrolled, false otherwise.
 */
export function scrollToSessionApproval(sessionId: string | null | undefined): boolean {
  const stack = findSessionApprovalStack(sessionId)

  if (!stack) {
    return false
  }

  stack.scrollIntoView({ block: 'nearest' })

  return true
}
