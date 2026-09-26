import type { DelegationReport, DelegationReportOutcome } from '@hermes/shared'
import { useStore } from '@nanostores/react'

import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $agentReviewReportsBySession } from '@/store/agent-review'
import {
  $delegationReportsBySession,
  $dismissedDelegationReports,
  dismissDelegationReport,
  reportChildSessionId,
  visibleDelegationReports
} from '@/store/delegation-reports'
import { openSessionInNewWindow } from '@/store/windows'
import type { SessionInfo } from '@/types/hermes'

// The card borrows the dots' palette so the fold speaks one status language:
// needs-input amber asks for a human; success emerald is a clean finish;
// destructive red is a run that produced nothing.
const OUTCOME_VARIANTS: Record<DelegationReportOutcome, { className: string; icon: string }> = {
  done: { className: 'text-(--ui-success)', icon: 'check' },
  needs_decision: { className: 'text-amber-500', icon: 'warning' },
  failed: { className: 'text-destructive', icon: 'error' }
}

interface DelegationReportCardProps {
  profile: null | string | undefined
  report: DelegationReport
}

function DelegationReportCard({ profile, report }: DelegationReportCardProps) {
  const { t } = useI18n()
  const labels = t.sidebar.delegationReports
  const variant = OUTCOME_VARIANTS[report.outcome] ?? OUTCOME_VARIANTS.needs_decision

  const outcomeLabel =
    report.outcome === 'done' ? labels.done : report.outcome === 'failed' ? labels.failed : labels.needsDecision

  const childSessionId = reportChildSessionId(report)

  return (
    <div
      className="group/card grid gap-0.5 rounded-md border border-(--ui-border-subtle) bg-(--ui-surface-raised) px-2 py-1.5"
      data-delegation-report={report.delegation_id}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Codicon className={cn('shrink-0', variant.className)} name={variant.icon} size={11} />
        <span className={cn('shrink-0 text-[0.625rem] font-medium uppercase tracking-wide', variant.className)}>
          {outcomeLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-(--ui-text-primary)" title={report.title}>
          {report.title}
        </span>
        <button
          aria-label={labels.dismiss}
          className="shrink-0 rounded p-0.5 text-(--ui-text-quaternary) opacity-0 transition-opacity hover:text-(--ui-text-secondary) focus-visible:opacity-100 group-hover/card:opacity-100"
          onClick={() => dismissDelegationReport(profile, report.delegation_id)}
          title={labels.dismiss}
          type="button"
        >
          <Codicon name="close" size={11} />
        </button>
      </div>
      {report.summary ? (
        <p className="truncate pl-4.5 text-[0.6875rem] leading-snug text-(--ui-text-secondary)" title={report.summary}>
          {report.summary}
        </p>
      ) : null}
      <div className="flex items-center gap-2 pl-4.5">
        {report.task_count > 1 ? (
          <span className="text-[0.625rem] text-(--ui-text-tertiary)">
            {labels.tasks(report.task_count, report.completed_count)}
          </span>
        ) : null}
        {childSessionId ? (
          <button
            className="inline-flex items-center gap-1 text-[0.625rem] text-(--ui-accent) hover:underline"
            onClick={() => void openSessionInNewWindow(childSessionId, { watch: true })}
            type="button"
          >
            <Codicon name="link-external" size={10} />
            {labels.openSubagent}
          </button>
        ) : null}
      </div>
    </div>
  )
}

interface SidebarDelegationReportsProps {
  /** The fold's sessions, in fold order — cards follow the same ranking. */
  sessions: readonly SessionInfo[]
}

/**
 * Report-back cards inside the attention fold: for each flagged session, the
 * settled background delegations it spawned. Content only — nothing opens,
 * steals focus, or toasts; a stale or old backend simply renders nothing.
 */
export function SidebarDelegationReports({ sessions }: SidebarDelegationReportsProps) {
  const reports = useStore($delegationReportsBySession)
  // Synthesized cards (agent review) live in their own atom — subscribe so a
  // freshly landed report repaints the fold.
  useStore($agentReviewReportsBySession)
  const dismissed = useStore($dismissedDelegationReports)

  const cards = sessions.flatMap(session =>
    visibleDelegationReports(session.id, session.profile, reports, dismissed).map(report => (
      <DelegationReportCard key={report.delegation_id} profile={session.profile} report={report} />
    ))
  )

  return cards.length ? <div className="grid gap-1 px-1 pb-1">{cards}</div> : null
}
