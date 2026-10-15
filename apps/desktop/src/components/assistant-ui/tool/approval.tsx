'use client'

import type { ApprovalChoice, ForkApproval } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { LogView } from '@/components/ui/log-view'
import { useI18n } from '@/i18n'
import { mergePendingApprovals } from '@/lib/approval-journal'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { $gateway } from '@/store/gateway'
import {
  type ApprovalDecision,
  type ApprovalRequest,
  clearApprovalRequest,
  decideApproval,
  listSessionApprovals,
  sessionApprovalRequests
} from '@/store/prompts'

import { StatusBadge } from '../../status-dot'

const RECENT_DECISION_MS = 1800

export interface ApprovalCardProps {
  /** A live server request or a pending row restored from the journal. */
  request: ApprovalRequest & { requestId: string }
  /** Answering stays at the caller's session-owner boundary. */
  onAnswer: (choice: ApprovalChoice) => Promise<ApprovalDecision>
  onSettled?: () => void
  initialDecision?: ApprovalDecision | null
  compact?: boolean
}

/** The only approval decision UI. The compact option is for surfaces that
 *  choose to embed the card; read-only surfaces should use StatusBadge. */
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
        recordedChoice === 'deny'
          ? copy.deny
          : recordedChoice === 'always'
            ? copy.alwaysAllow
            : copy.allowOnce
      )
    : decision?.approval?.reason || copy.noLongerPending

  return (
    <article
      aria-label={copy.jumpToApproval}
      className={cn(
        'grid min-w-0 gap-2 rounded-card border border-line bg-surface-raised p-3',
        compact && 'p-2'
      )}
      data-request-id={request.requestId}
      data-slot="tool-approval-card"
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusBadge aria-label={copy.jumpToApproval} className="shrink-0" state="needs-approval" />
        <p className="min-w-0 truncate text-ui-sm font-medium text-fg">
          {request.toolName || copy.cardTitle}
        </p>
      </div>

      {command ? (
        <LogView className={cn('max-h-28', compact && 'max-h-20')}>{command}</LogView>
      ) : description ? (
        <p className="whitespace-pre-wrap break-words text-ui-xs text-fg-secondary">{description}</p>
      ) : null}

      {decision ? (
        <p aria-live="polite" className="text-ui-xs text-fg-secondary" data-approval-outcome="" role="status">
          {outcome}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2" data-slot="tool-approval-actions">
            <Button
              data-approval-run=""
              disabled={busy}
              onClick={() => void answer('once')}
              size="sm"
              type="button"
            >
              {copy.allowOnce}
            </Button>
            {confirmAlways ? (
              <>
                <span className="min-w-0 flex-1 text-right text-ui-xs text-fg-secondary">
                  {copy.alwaysConfirmPrompt(pattern)}
                </span>
                <Button disabled={busy} onClick={() => void answer('always')} size="sm" type="button">
                  {t.common.confirm}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setConfirmAlways(false)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
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
            <p className="text-ui-xs text-danger" data-approval-error="" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </article>
  )
}

interface RecentApprovalDecision {
  decision: ApprovalDecision
  request: ApprovalRequest & { requestId: string }
  sessionId: string
}

interface ApprovalComposerEntryProps {
  runtimeSessionId: string | null
  storedSessionId: string | null
}

/** Session-owned composer entry. Live requests paint immediately; durable
 *  pending rows fill the gap after a reload or a backend reconnect. */
export function ApprovalComposerEntry({ runtimeSessionId, storedSessionId }: ApprovalComposerEntryProps) {
  const gateway = useStore($gateway)
  const liveRequests = useStore(useMemo(() => sessionApprovalRequests(runtimeSessionId), [runtimeSessionId]))
  const routeSessionId = runtimeSessionId || storedSessionId

  const [snapshot, setSnapshot] = useState<{ sessionId: string | null; rows: ForkApproval[] }>({
    sessionId: null,
    rows: []
  })

  const [recent, setRecent] = useState<RecentApprovalDecision | null>(null)
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let active = true

    if (!gateway || !routeSessionId || !storedSessionId) {
      setSnapshot({ sessionId: storedSessionId, rows: [] })

      return () => {
        active = false
      }
    }

    setSnapshot(current =>
      current.sessionId === storedSessionId ? current : { sessionId: storedSessionId, rows: [] }
    )

    void listSessionApprovals(gateway, routeSessionId, storedSessionId)
      .then(rows => {
        if (active) {
          setSnapshot({ sessionId: storedSessionId, rows })
        }
      })
      .catch(() => {
        if (active) {
          setSnapshot(current =>
            current.sessionId === storedSessionId ? current : { sessionId: storedSessionId, rows: [] }
          )
        }
      })

    return () => {
      active = false
    }
  }, [gateway, routeSessionId, storedSessionId, liveRequests])

  useEffect(() => {
    setRecent(null)
    setDismissedIds(new Set())
  }, [runtimeSessionId, storedSessionId])

  const pending = useMemo(
    () =>
      mergePendingApprovals(
        liveRequests,
        snapshot.sessionId === storedSessionId ? snapshot.rows : [],
        runtimeSessionId || storedSessionId || ''
      ).filter(request => !dismissedIds.has(request.requestId ?? '')),
    [dismissedIds, liveRequests, runtimeSessionId, snapshot, storedSessionId]
  )

  const answer = useCallback(
    async (request: ApprovalRequest & { requestId: string }, choice: ApprovalChoice) => {
      const result = await decideApproval(gateway, request, choice)
      const terminal = result.resolved || (result.approval && result.approval.status !== 'pending')

      if (!terminal) {
        return result
      }

      const sessionId = request.sessionId ?? runtimeSessionId ?? storedSessionId ?? ''

      setRecent({ decision: result, request, sessionId })
      setDismissedIds(current => new Set(current).add(request.requestId))
      clearApprovalRequest(request.sessionId, request.requestId)

      if (result.approval && storedSessionId) {
        setSnapshot(current =>
          current.sessionId === storedSessionId
            ? {
                ...current,
                rows: current.rows.map(row =>
                  row.request_id === request.requestId ? result.approval! : row
                )
              }
            : current
        )
      }

      return result
    },
    [gateway, runtimeSessionId, storedSessionId]
  )

  const clearRecent = useCallback(() => setRecent(null), [])
  const currentSessionId = runtimeSessionId || storedSessionId

  if (!currentSessionId) {
    return null
  }

  const activeRequest =
    recent?.sessionId === currentSessionId
      ? recent.request
      : pending[0]

  if (!activeRequest) {
    return null
  }

  return (
    <div className="mx-auto mb-2 w-full max-w-(--composer-width)" data-approval-stack="" data-session-id={currentSessionId} data-slot="composer-approval-entry">
      <ApprovalCard
        initialDecision={recent?.sessionId === currentSessionId ? recent.decision : null}
        onAnswer={choice => answer(activeRequest, choice)}
        onSettled={clearRecent}
        request={activeRequest}
      />
    </div>
  )
}
