import { useStore } from '@nanostores/react'
import { useReducedMotion } from 'motion/react'
import { useMemo, useRef } from 'react'

import { useTranscriptWindow } from '@/components/assistant-ui/thread/transcript-window'
import { Codicon } from '@/components/ui/codicon'
import { AnimatedInt } from '@/components/ui/diff-count'
import { useI18n } from '@/i18n'
import { scrollToSessionApproval } from '@/lib/approval-anchor'
import { triggerHaptic } from '@/lib/haptics'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import { sessionApprovalRequest } from '@/store/prompts'
import {
  $threadJumpButtonVisibleBySession,
  $threadMessagesBelowBySession,
  requestScrollToBottom
} from '@/store/thread-scroll'

import { useComposerSurfaceId } from './composer/scope'

/**
 * Floating "jump to bottom" control. Sits centered just above the composer,
 * clearing the out-of-flow status stack via the same measured-height CSS vars
 * the thread's bottom clearance uses (`--composer-measured-height`, which
 * covers the whole dock), so it never overlaps the queue / subagent
 * / background cards. Visible only while the user has scrolled meaningfully
 * away from the bottom, with an animated count of messages below the viewport.
 * Clicking re-arms sticky-bottom and pins the viewport.
 *
 * While an approval is pending, relabel this control and, instead of jumping
 * to the transcript's true bottom (which can overshoot a mid-transcript
 * approval once newer content lands below it), scroll directly to the
 * session's own approval stack.
 *
 * Enter/exit motion lives in styles.css under `.thread-jump-button` — a
 * directional scale (contract in from 1.1, contract out to 0.9) keyed off
 * `data-state`. `idle` (never-shown) stays silent so it can't flash on mount;
 * `in`/`out` only swap once it has actually appeared.
 */
export function ScrollToBottomButton({ sessionId }: { sessionId: string | null }) {
  const { t } = useI18n()
  const surfaceId = useComposerSurfaceId()
  const scrollSessionId = sessionId ?? surfaceId
  const { isHistorical } = useTranscriptWindow()

  const scrollVisible = useStoreSelector($threadJumpButtonVisibleBySession, map =>
    Boolean(scrollSessionId && map[scrollSessionId])
  )

  const count = useStoreSelector($threadMessagesBelowBySession, map =>
    scrollSessionId ? (map[scrollSessionId] ?? 0) : 0
  )

  const visible = isHistorical || scrollVisible
  const reducedMotion = useReducedMotion()
  const request = useStore(useMemo(() => sessionApprovalRequest(sessionId), [sessionId]))
  // Scrolled away while an approval is pending → the inline Run/Reject bar is
  // below the fold. Relabel so the user knows the session needs them, not just
  // that there's more to read.
  const visibleApproval = Boolean(request)
  const hasShownRef = useRef(false)

  if (visible) {
    hasShownRef.current = true
  }

  const state = visible ? 'in' : hasShownRef.current ? 'out' : 'idle'
  const countLabel = count > 0 ? t.sidebar.messageCount(count) : ''
  const [beforeCount, afterCount] = countLabel ? countLabel.split(String(count)) : ['', '']

  const label = visibleApproval
    ? t.assistant.approval.jumpToApproval
    : countLabel
      ? `${t.assistant.thread.scrollToBottom} · ${countLabel}`
      : t.assistant.thread.scrollToBottom

  return (
    <button
      aria-hidden={!visible}
      aria-label={label}
      className={cn(
        'thread-jump-button absolute left-1/2 z-20 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-pill bg-surface-raised px-3 text-ui-xs font-medium shadow-e2',
        visibleApproval ? 'text-primary hover:bg-primary/10' : 'text-fg-secondary hover:text-fg',
        !visible && 'pointer-events-none'
      )}
      data-state={state}
      onClick={() => {
        triggerHaptic('selection')

        if (visibleApproval && scrollToSessionApproval(request?.sessionId)) {
          return
        }

        requestScrollToBottom(scrollSessionId)
      }}
      style={{
        bottom: 'calc(var(--composer-measured-height) + 1rem)'
      }}
      tabIndex={visible ? 0 : -1}
      type="button"
    >
      <Codicon name="arrow-down" size="0.8125rem" />
      {visibleApproval || count <= 0 ? (
        <span>{label}</span>
      ) : (
        <span aria-hidden className="whitespace-nowrap tabular-nums">
          {beforeCount}
          {!visible || reducedMotion ? count : <AnimatedInt key={sessionId} value={count} />}
          {afterCount}
        </span>
      )}
    </button>
  )
}
