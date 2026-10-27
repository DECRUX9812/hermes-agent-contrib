'use client'

import type { ApprovalChoice } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { LogView } from '@/components/ui/log-view'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $gateway } from '@/store/gateway'
import {
  answerApproval,
  type ApprovalRequest,
  clearApprovalRequest,
  replayPendingApproval,
  sessionApprovalRequests
} from '@/store/prompts'

/** What an answer did. `approval` is the recorded outcome when the caller keeps one. */
export interface ApprovalDecision {
  approval?: { choice?: ApprovalChoice | null; reason?: string | null; status?: string }
  choice: ApprovalChoice | null
  resolved: boolean
}

const RECENT_DECISION_MS = 1800
const SESSION_STOPPED = 'session_stopped' // a recorded outcome: denied when the turn stopped

export interface ApprovalCardProps {
  /** A live server request, or a pending row a plugin restored from its own store. */
  request: ApprovalRequest & { requestId: string }
  /** Answering stays at the caller's session-owner boundary. */
  onAnswer: (choice: ApprovalChoice) => Promise<ApprovalDecision>
  onSettled?: () => void
  initialDecision?: ApprovalDecision | null
  compact?: boolean
}

/** The only approval decision UI. The compact option is for surfaces that
 *  choose to embed the card; read-only surfaces should show a status mark. */
export function ApprovalCard({
  compact = false,
  initialDecision = null,
  onAnswer,
  onSettled,
  request
}: ApprovalCardProps) {
  const { t } = useI18n()
  const copy = t.assistant.approval
  const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null)
  const [confirmAlways, setConfirmAlways] = useState(false)
  const [error, setError] = useState('')
  const [decision, setDecision] = useState<ApprovalDecision | null>(initialDecision)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!decision) {
      return
    }

    const timer = window.setTimeout(() => onSettled?.(), RECENT_DECISION_MS)

    return () => window.clearTimeout(timer)
  }, [decision, onSettled])

  const answer = useCallback(
    async (choice: ApprovalChoice) => {
      if (submittingRef.current || decision) {
        return
      }

      submittingRef.current = true
      setSubmitting(choice)
      setError('')

      try {
        const result = await onAnswer(choice)

        if (!result.resolved && result.approval?.status === 'pending') {
          throw new Error(copy.sendFailed)
        }

        setDecision(result)
        triggerHaptic(choice === 'deny' ? 'cancel' : 'submit')
      } catch {
        setError(copy.sendFailed)
        submittingRef.current = false
        setSubmitting(null)
      }
    },
    [copy.sendFailed, decision, onAnswer]
  )

  const displayCommand = request.command.trim()
  const syntheticCommand = /^<[^>]+> \(/.test(displayCommand)
  const command = displayCommand && !syntheticCommand ? displayCommand : ''
  const description = request.description.trim()
  const pattern = command || description || request.toolName || copy.command
  const busy = submitting !== null || decision !== null
  const recordedChoice = decision?.approval?.choice ?? decision?.choice ?? null

  const outcome = recordedChoice
    ? copy.decisionRecorded(
        recordedChoice === 'deny' ? copy.deny : recordedChoice === 'always' ? copy.alwaysAllow : copy.allowOnce
      )
    : decision?.approval?.reason === SESSION_STOPPED
      ? copy.deniedSessionStopped
      : decision?.approval?.reason || copy.noLongerPending

  return (
    <article
      aria-label={copy.jumpToApproval}
      className={cn(
        'grid min-w-0 gap-2 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-elevated) p-3',
        compact && 'p-2'
      )}
      data-request-id={request.requestId}
      data-slot="tool-approval-card"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-label={copy.jumpToApproval}
          className="inline-block size-1.5 shrink-0 rounded-full bg-(--ui-yellow)"
          data-status="needs-approval"
          role="img"
        />
        <p className="min-w-0 truncate text-sm font-medium text-(--ui-text-primary)">
          {request.toolName || copy.cardTitle}
        </p>
      </div>

      {command ? (
        <LogView className={cn('max-h-28', compact && 'max-h-20')}>{command}</LogView>
      ) : description ? (
        <p className="whitespace-pre-wrap break-words text-xs text-(--ui-text-secondary)">{description}</p>
      ) : null}

      {decision ? (
        <p aria-live="polite" className="text-xs text-(--ui-text-secondary)" data-approval-outcome="" role="status">
          {outcome}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2" data-slot="tool-approval-actions">
            <Button data-approval-run="" disabled={busy} onClick={() => void answer('once')} size="sm" type="button">
              {copy.allowOnce}
            </Button>
            {request.allowPermanent === false ? null : confirmAlways ? (
              <>
                <span className="min-w-0 flex-1 text-right text-xs text-(--ui-text-secondary)">
                  {copy.alwaysConfirmPrompt(pattern)}
                </span>
                <Button disabled={busy} onClick={() => void answer('always')} size="sm" type="button">
                  {t.common.confirm}
                </Button>
                <Button disabled={busy} onClick={() => setConfirmAlways(false)} size="sm" type="button" variant="ghost">
                  {t.common.cancel}
                </Button>
              </>
            ) : (
              <Button
                disabled={busy}
                onClick={() => setConfirmAlways(true)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {copy.alwaysAllowHere}
              </Button>
            )}
            <Button
              data-approval-deny=""
              disabled={busy}
              onClick={() => void answer('deny')}
              size="sm"
              type="button"
              variant="ghost"
            >
              {copy.deny}
            </Button>
          </div>
          {error ? (
            <p className="text-xs text-(--ui-red)" data-approval-error="" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </article>
  )
}

// Attribute-safe selector fragment. jsdom (vitest) does not ship `CSS.escape`.
const cssEscape = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_:-]/g, ch => `\\${ch}`)

/** The session's approval entry, tagged with its session so a split view never scrolls a sibling's. */
export function findSessionApprovalStack(sessionId: string | null | undefined): HTMLElement | null {
  return sessionId
    ? document.querySelector<HTMLElement>(`[data-approval-stack][data-session-id="${cssEscape(sessionId)}"]`)
    : null
}

/** Scrolls the session's approval entry into view (`nearest`, so no ancestor scroll moves). */
export function scrollToSessionApproval(sessionId: string | null | undefined): boolean {
  const stack = findSessionApprovalStack(sessionId)
  stack?.scrollIntoView({ block: 'nearest' })

  return Boolean(stack)
}

type KeyedApproval = ApprovalRequest & { requestId: string }

interface ApprovalComposerEntryProps {
  runtimeSessionId: string | null
  storedSessionId: string | null
}

/** Session-owned composer entry for the live approval prompts (stock replay restores them after a reload). */
export function ApprovalComposerEntry({ runtimeSessionId, storedSessionId }: ApprovalComposerEntryProps) {
  const gateway = useStore($gateway)
  const live = useStore(useMemo(() => sessionApprovalRequests(runtimeSessionId), [runtimeSessionId]))
  const [recent, setRecent] = useState<{ decision: ApprovalDecision; request: KeyedApproval } | null>(null)
  const clearRecent = useCallback(() => setRecent(null), [])

  useEffect(() => setRecent(null), [runtimeSessionId])

  const answer = useCallback(
    async (request: ApprovalRequest, keyed: KeyedApproval, choice: ApprovalChoice): Promise<ApprovalDecision> => {
      await answerApproval(gateway, request, choice)
      const decision = { choice, resolved: true }
      setRecent({ decision, request: keyed })
      clearApprovalRequest(request.sessionId, request.requestId)
      void replayPendingApproval(gateway, request.sessionId).catch(() => undefined)

      return decision
    },
    [gateway]
  )

  const sessionId = runtimeSessionId || storedSessionId
  const first = live[0]
  // A prompt without a request id is keyed by its socket request; answers go back over that socket.
  const keyed = first && { ...first, requestId: first.requestId || `live:${first.serverRequestId ?? sessionId}` }
  const shown = recent?.request ?? keyed

  if (!sessionId || !shown) {
    return null
  }

  return (
    <div
      className="mx-auto mb-2 w-full max-w-(--composer-width)"
      data-approval-stack=""
      data-session-id={sessionId}
      data-slot="composer-approval-entry"
    >
      <ApprovalCard
        initialDecision={recent?.decision ?? null}
        key={shown.requestId}
        onAnswer={choice => (first && keyed ? answer(first, keyed, choice) : Promise.reject(new Error('gone')))}
        onSettled={clearRecent}
        request={shown}
      />
    </div>
  )
}

/** Approvals render in the composer (ApprovalComposerEntry). The transcript list still mounts
 *  this stock anchor, which now draws nothing, so the list needs no patch of its own. */
export function PendingApprovalStack() {
  return null
}
