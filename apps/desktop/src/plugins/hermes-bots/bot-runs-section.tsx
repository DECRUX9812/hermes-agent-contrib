/**
 * Runs feed section for the bot pane (revamp A3): renders the cards
 * `deriveBotRuns` (bot-runs.ts) produces — kind icon, status, duration where
 * the signal carries one, outcome summary, and a jump to the transcript.
 */

import {
  cn,
  Codicon,
  host,
  RowButton,
  Tip,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'

import { type BotRun, type BotRunKind, type BotRunStatus, deriveBotRuns } from './bot-runs'
import { $focusedBotOwner, focusedRosterOwner } from './bot-state'
import { $botAttention, $botMeta, botRosterKey, botSelectionKey, isActiveRosterBot } from './data'
import { $groupActivity } from './group-activity'
import { $groupChats } from './group-chat'
import { openGroupChat } from './group-chat-view'
import { useBots } from './i18n'
import { openRosterBot } from './roster-actions'
import { botRosterMeta } from './routing'
import { rosterRowAge, useTurnBusy } from './row-helpers'
import type { RosterRow, RoutineJob } from './types'

const RUN_KIND_GLYPHS: Record<BotRunKind, string> = {
  chat: 'comment',
  group: 'organization',
  relay: 'mail-read',
  routine: 'watch'
}

function runStatusGlyph(status: BotRunStatus): string {
  switch (status) {
    case 'attention':
      return 'warning'

    case 'failed':
      return 'error'

    case 'running':
      return 'sync'

    default:
      return 'check'
  }
}

function runStatusClass(status: BotRunStatus): string {
  switch (status) {
    case 'attention':
      return 'text-amber-600 dark:text-amber-300'

    case 'failed':
      return 'text-destructive'

    case 'running':
      return 'text-(--ui-accent)'

    default:
      return 'text-(--ui-text-tertiary)'
  }
}

function runDurationLabel(ms: number, b: ReturnType<typeof useBots>): string {
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)

  return minutes ? b.runs.tookMinutes(minutes) : b.runs.tookSeconds(seconds)
}

interface BotRunsSectionProps {
  jobs: RoutineJob[]
  onOpenRoutine: (jobId: string) => void
  owner: RosterRow
}

/** Compact activity roll-up for the pane's bot: canonical-chat turns,
 *  routine runs, relay deliveries and group rounds, newest first. Every
 *  signal is an atom this pane already subscribes — nothing polls per row. */
export function BotRunsSection({ jobs, onOpenRoutine, owner }: BotRunsSectionProps) {
  const { t } = useI18n()
  const b = useBots()
  const rooms = useValue($groupChats)
  const groupActivity = useValue($groupActivity)
  const attentionMap = useValue($botAttention)
  const allMeta = useValue($botMeta)
  const focusedOwner = focusedRosterOwner(useValue($focusedBotOwner))
  const turnBusy = useTurnBusy()
  const activeConnectionId = String(host.state.connectionId?.get?.() || 'local').trim()

  const attention =
    attentionMap[botSelectionKey(owner)] ||
    attentionMap[botRosterKey(owner)] ||
    attentionMap[`${owner?.connectionId || activeConnectionId}::${owner?.name || 'default'}`] ||
    null

  const chatBusy = Boolean(turnBusy && focusedOwner && isActiveRosterBot(owner, focusedOwner))

  const runs = deriveBotRuns({
    attention,
    bot: owner,
    chatBusy,
    groupActivity,
    jobs,
    meta: owner ? botRosterMeta(owner, allMeta) : null,
    rooms
  })

  const open = (run: BotRun) => {
    if (run.kind === 'group' && run.group) {
      openGroupChat(run.group)
    } else if (run.kind === 'routine' && run.jobId) {
      onOpenRoutine(run.jobId)
    } else {
      void openRosterBot(owner)
    }
  }

  return (
    <div className="px-3 pb-1">
      <div className="pb-1 text-[0.65rem] font-medium uppercase tracking-wider text-(--ui-text-quaternary)">
        {b.runs.title}
      </div>
      {runs.length === 0 ? (
        <div className="pb-1 text-xs text-(--ui-text-quaternary)">{b.runs.empty}</div>
      ) : (
        <div className="grid gap-0.5">
          {runs.map(run => {
            const kindLabel = b.runs[`kind${run.kind[0].toUpperCase()}${run.kind.slice(1)}` as 'kindChat']
            const statusLabel = b.runs[run.status]
            const title = run.title || kindLabel

            return (
              <RowButton
                aria-label={`${title} — ${statusLabel}`}
                className={cn(
                  'flex w-full min-w-0 max-w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors',
                  'hover:bg-(--chrome-action-hover)'
                )}
                key={run.id}
                onClick={() => open(run)}
              >
                <Tip label={kindLabel}>
                  <Codicon
                    aria-label={kindLabel}
                    className="shrink-0 text-[0.75rem] text-(--ui-text-tertiary)"
                    name={RUN_KIND_GLYPHS[run.kind]}
                  />
                </Tip>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="min-w-0 truncate text-[0.75rem] font-medium text-(--ui-text-secondary)">
                      {title}
                    </span>
                    {run.durationMs !== undefined ? (
                      <span className="shrink-0 text-[0.65rem] text-(--ui-text-quaternary)">
                        {runDurationLabel(run.durationMs, b)}
                      </span>
                    ) : null}
                  </span>
                  {run.summary ? (
                    <span className="block min-w-0 truncate text-[0.6875rem] text-(--ui-text-quaternary)">
                      {run.summary}
                    </span>
                  ) : null}
                </span>
                <Tip label={statusLabel}>
                  <Codicon
                    aria-label={statusLabel}
                    className={cn('shrink-0 text-[0.6875rem]', runStatusClass(run.status))}
                    name={runStatusGlyph(run.status)}
                    spinning={run.status === 'running'}
                  />
                </Tip>
                <span className="shrink-0 text-[0.65rem] text-(--ui-text-quaternary)">
                  {rosterRowAge(run.at, t.sidebar.row)}
                </span>
              </RowButton>
            )
          })}
        </div>
      )}
    </div>
  )
}
