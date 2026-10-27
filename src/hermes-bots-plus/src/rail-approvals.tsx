import { ApprovalCard, cn, Codicon, host, useQuery, useValue } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { useBots } from './i18n'
import {
  decideJournal,
  type JournalChoice,
  type JournalRow,
  journalView,
  listJournal,
  outcomeTone
} from './rail-approvals-model'

const POLL_MS = 4000

const TONE_CLASS = { bad: 'hbp-fg-danger', muted: 'text-(--ui-text-quaternary)', ok: 'hbp-fg-ok' } as const
const TONE_ICON = { bad: 'circle-slash', muted: 'circle-large-outline', ok: 'check' } as const

const request = <T,>(method: string, params: Record<string, unknown>) => host.request<T>(method, params)

/** The focused chat's journal rows; `null` when the gateway keeps none. Polls
 *  only while the Approvals tab is mounted. */
export function useJournalRows(storedSessionId: string) {
  return useQuery({
    enabled: Boolean(storedSessionId),
    queryFn: () => listJournal(request, storedSessionId),
    queryKey: ['hbp-approvals-journal', storedSessionId],
    refetchInterval: POLL_MS,
    retry: false
  })
}

/** Waiting approvals as the app's own inline card, then the last few
 *  decisions. Answers go through the journal so every surface agrees. */
export function JournalApprovals({ rows, storedSessionId }: { rows: JournalRow[]; storedSessionId: string }) {
  const b = useBots()
  const a = b.activity
  const runtimeSessionId = useValue(host.state.focusedSessionId) as null | string
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set())
  const { pending, recent } = journalView(rows, answered)

  if (!pending.length && !recent.length) {
    return null
  }

  return (
    <div className="grid gap-2" data-testid="rail-journal">
      {pending.map(row => (
        <div className="hbp-enter" key={row.request_id}>
          <ApprovalCard
            compact
            onAnswer={async (choice: JournalChoice) => {
              const decision = await decideJournal(
                request,
                { requestId: row.request_id, runtimeSessionId, storedSessionId },
                choice
              )

              setAnswered(prev => new Set(prev).add(row.request_id))

              return decision
            }}
            request={{
              command: row.command || '',
              description: row.description || '',
              requestId: row.request_id,
              sessionId: runtimeSessionId,
              toolName: row.tool_name || undefined
            }}
          />
        </div>
      ))}
      {recent.length ? (
        <div className="grid gap-1">
          <div className="px-1 text-xs font-medium text-(--ui-text-tertiary)">
            {a.approvalsRecent}
          </div>
          <ul className="grid gap-0.5" data-testid="rail-journal-recent">
            {recent.map(row => {
              const tone = outcomeTone(row)

              return (
                <li
                  className="hbp-enter flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-(--ui-control-hover-background)"
                  key={row.request_id}
                  title={row.reason || undefined}
                >
                  <Codicon className={cn('shrink-0', TONE_CLASS[tone])} name={TONE_ICON[tone]} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-(--ui-text-secondary)">
                    {row.command || row.description || row.tool_name || row.request_id}
                  </span>
                  <span className={cn('shrink-0 text-xs', TONE_CLASS[tone])}>
                    {a.approvalOutcome(row.status, row.choice ?? null)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
