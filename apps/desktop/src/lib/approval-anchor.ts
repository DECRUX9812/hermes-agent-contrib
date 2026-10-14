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
