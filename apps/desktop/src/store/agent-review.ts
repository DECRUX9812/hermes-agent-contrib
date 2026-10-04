import type { DelegationReport } from '@hermes/shared'
import { atom } from 'nanostores'

import { getSessionMessages } from '@/api/sessions'
import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { translateNow } from '@/i18n'
import { attachmentId } from '@/lib/chat-runtime'
import { desktopGit } from '@/lib/desktop-git'
import type { SessionMessage } from '@/types/hermes'

import { type ComposerAttachment, NEW_SESSION_DRAFT_KEY, onNewSessionDraftAdopted, stashSessionDraft } from './composer'
import { normalizeProfileKey, pinNewChatProfile, requestFreshSession } from './profile'
import { $reviewScopeTarget, reviewRepoCwd } from './review'
import { sessionIdForReviewTarget } from './review-session'
import { $sessions, idsShareLineage, sessionMatchesStoredId, setNewChatWorkspaceTarget } from './session'
import { $sessionStates } from './session-states'
import { markSessionUnreadFinished } from './session-unread'

/**
 * AGENT REVIEW PASS — "Have <profile> review this diff" from the review pane.
 *
 * The pick seeds a FRESH session draft on the chosen profile: the working-tree
 * diff is written to a Hermes composer-pastes file and attached as a `@file:`
 * chip on a seeded review prompt, then `pinNewChatProfile` + `requestFreshSession`
 * surface that draft for the user to send. The reviewed session's live context
 * is never touched (prompt caching is sacred) — the review runs in a separate
 * session anchored to the reviewed workspace.
 *
 * The seeded draft's first send mints the review session; the composer's
 * `__new__:<profile>` → stored-id adoption names it, the link is recorded, and
 * the review session's busy→idle edge lands a renderer-synthesized
 * `DelegationReport` on the ORIGIN session — the same card surface the real
 * `delegation.reports` feed paints — and flags the origin row unread so the
 * attention fold surfaces it. Dismissal shares the persisted delegation
 * dismissal buckets via `visibleDelegationReports` (which unions these in).
 *
 * Everything below is in-memory: the link is a renderer concern, and a restart
 * mid-review simply drops the pending card — the review session's own row
 * still gets its normal unread finish marker.
 */

interface PendingAgentReview {
  /** Stored id of the session whose working tree was reviewed — the card's fold row. */
  originStoredId: null | string
  /** The origin row's own profile (unread-marker bucket), never the ambient gateway's. */
  originProfile: null | string
  /** Profile the review session runs on. */
  reviewerProfile: string
  /** Display name for the card title. */
  reviewerLabel: string
}

/** Draft bucket (`__new__:<profile>`) → review seeded there but not yet sent. */
const pendingByDraftKey = new Map<string, PendingAgentReview>()

/** Review session (stored/composer key) → link, while its turn is in flight. */
const linkedBySessionKey = new Map<string, PendingAgentReview>()

// The maps track one in-flight user action each; a runaway loop of seeds or
// adoptions without sends would still stay tiny.
const PENDING_CAP = 50

/** origin stored session id → synthesized report cards awaiting the fold. */
export const $agentReviewReportsBySession = atom<Record<string, DelegationReport[]>>({})

function rememberPending(draftKey: string, pending: PendingAgentReview): void {
  pendingByDraftKey.delete(draftKey)
  pendingByDraftKey.set(draftKey, pending)

  while (pendingByDraftKey.size > PENDING_CAP) {
    pendingByDraftKey.delete(pendingByDraftKey.keys().next().value ?? '')
  }
}

/** The session the pane is reviewing: a tile-scoped pane names its session in
 *  the target (`tile:<storedId>`); the default scope reviews the selected chat. */
function reviewOriginSessionId(): null | string {
  return sessionIdForReviewTarget($reviewScopeTarget.get())
}

/**
 * Seed a review session for the pane's current diff on `reviewerName`'s
 * profile. Returns false (caller toasts) when the pane has no repo, no diff,
 * or the paste bridge is unavailable.
 */
export async function seedAgentReview(reviewerName: string, reviewerLabel?: string): Promise<boolean> {
  const reviewer = normalizeProfileKey(reviewerName)
  const cwd = reviewRepoCwd()
  const review = desktopGit()?.review
  const savePastedText = window.hermesDesktop?.savePastedText

  if (!reviewer || !cwd || !review?.commitContext || !savePastedText) {
    return false
  }

  const { diff } = await review.commitContext(cwd)

  if (!diff.trim()) {
    return false
  }

  // Same staging the composer's large-paste path uses: the diff becomes a
  // Hermes-managed text file so it rides the @file: attach pipeline (remote
  // upload included) instead of inflating the prompt inline.
  const savedPath = await savePastedText(diff)

  if (!savedPath) {
    return false
  }

  const originStoredId = reviewOriginSessionId()

  const originRow = originStoredId
    ? $sessions.get().find(session => sessionMatchesStoredId(session, originStoredId))
    : undefined

  const attachment: ComposerAttachment = {
    id: attachmentId('file', savedPath),
    kind: 'file',
    label: translateNow('statusStack.coding.agentReviewAttachment'),
    refText: `@file:${formatRefValue(savedPath)}`,
    path: savedPath
  }

  const draftKey = `${NEW_SESSION_DRAFT_KEY}:${reviewer}`

  stashSessionDraft(draftKey, translateNow('statusStack.coding.agentReviewPrompt'), [attachment])
  rememberPending(draftKey, {
    originStoredId: originRow?.id ?? originStoredId,
    originProfile: originRow?.profile ?? null,
    reviewerProfile: reviewer,
    reviewerLabel: reviewerLabel?.trim() || reviewer
  })

  // Anchor the fresh chat to the repo under review so the diff's paths — and
  // any file reads the reviewer does on its own — resolve in the same tree.
  setNewChatWorkspaceTarget(cwd)
  pinNewChatProfile(reviewer)
  requestFreshSession()

  return true
}

// ── Link + settle watch ──────────────────────────────────────────────────────

onNewSessionDraftAdopted(({ draftKey, sessionKey }) => {
  const pending = pendingByDraftKey.get(draftKey)

  if (!pending) {
    return
  }

  pendingByDraftKey.delete(draftKey)

  if (!pending.originStoredId) {
    // No origin row to report to — the review still ran as a normal session.
    return
  }

  linkedBySessionKey.set(sessionKey, pending)
  ensureSettleWatch()
})

let unsubscribeSettleWatch: (() => void) | null = null

function ensureSettleWatch(): void {
  unsubscribeSettleWatch ??= $sessionStates.subscribe((states, previous) => {
    if (!linkedBySessionKey.size) {
      return
    }

    const sessions = $sessions.get()

    for (const [sessionKey, pending] of linkedBySessionKey) {
      for (const [runtimeId, next] of Object.entries(states)) {
        // sessionKey is the composer's pin (lineage-root) id; compression can
        // rotate the runtime's storedSessionId tip mid-turn, so match by
        // lineage, not string equality.
        if (!next.storedSessionId || !idsShareLineage(next.storedSessionId, sessionKey, sessions)) {
          continue
        }

        const wasWorking = previous?.[runtimeId]?.busy ?? false

        if (wasWorking && !next.busy) {
          linkedBySessionKey.delete(sessionKey)
          void settleAgentReview(sessionKey, pending, Boolean(next.needsInput))
        }
      }
    }
  })
}

/** First substantive line of the reviewer's last assistant message — the same
 *  heuristic a backend report's `summary_source: 'heuristic'` applies. */
function reviewSummaryText(messages: readonly SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]

    if (message.role !== 'assistant') {
      continue
    }

    const candidates = [message.display_content, message.content]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return firstLine(candidate)
      }

      if (Array.isArray(candidate)) {
        const text = candidate
          .map((part: unknown) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
          .join('')
          .trim()

        if (text) {
          return firstLine(text)
        }
      }
    }
  }

  return ''
}

const firstLine = (text: string): string => (text.split('\n').find(line => line.trim()) ?? '').trim().slice(0, 200)

async function settleAgentReview(
  reviewSessionKey: string,
  pending: PendingAgentReview,
  needsInput: boolean
): Promise<void> {
  let summary = ''

  try {
    // The review session lives on the reviewer's profile — scope the read.
    const tail = await getSessionMessages(reviewSessionKey, pending.reviewerProfile, {
      limit: 20,
      order: 'latest'
    })

    summary = reviewSummaryText(tail.messages)
  } catch {
    // A missing/failed read lands a card without a summary rather than no card.
  }

  const report: DelegationReport = {
    child_session_ids: { '0': reviewSessionKey },
    completed_at: Date.now() / 1000,
    completed_count: 1,
    delegation_id: `agent-review:${reviewSessionKey}`,
    failed_count: 0,
    outcome: needsInput ? 'needs_decision' : 'done',
    state: 'completed',
    summary,
    summary_source: 'heuristic',
    task_count: 1,
    title: translateNow('statusStack.coding.agentReviewReportTitle', pending.reviewerLabel)
  }

  const originId = pending.originStoredId

  if (!originId) {
    return
  }

  $agentReviewReportsBySession.set({
    ...$agentReviewReportsBySession.get(),
    [originId]: [...($agentReviewReportsBySession.get()[originId] ?? []), report]
  })

  // The card renders inside the origin row's attention fold — flag the row
  // unread (bucketed under the origin's own profile) so it surfaces there.
  markSessionUnreadFinished(originId, pending.originProfile)
}

/** Drop a session's synthesized cards + any links pointing at it (session
 *  deleted/archived) — mirrors `forgetDelegationReports`, called alongside it. */
export function forgetAgentReviewReports(sessionId: string): void {
  linkedBySessionKey.delete(sessionId)

  const map = $agentReviewReportsBySession.get()

  if (Object.hasOwn(map, sessionId)) {
    const { [sessionId]: _drop, ...rest } = map
    $agentReviewReportsBySession.set(rest)
  }
}
