/**
 * G8 — the mission rail's dated task log. Same data plumbing the A3 runs
 * feed used (deriveBotRuns over attention/live-status/group/routine
 * signals), restyled into a glanceable "what it did today" list: a day
 * header, then one row per action — status icon, one line, time. Rows keep
 * the feed's click-through to the offending surface.
 */

import { armTranscriptReplayJump, cn, Codicon, host, RowButton, Tip, useValue } from '@hermes/plugin-sdk'

import { type BotRun, type BotRunKind, type BotRunStatus, deriveBotRuns, pickCronRunSessionId } from './bot-runs'
import { $focusedBotOwner, focusedRosterOwner } from './bot-state'
import { $botAttention, $botMeta, botRosterKey, botSelectionKey, isActiveRosterBot } from './data'
import { $groupActivity } from './group-activity'
import { $groupChats } from './group-chat'
import { openGroupChat } from './group-chat-view'
import { botsText, useBots } from './i18n'
import { useBotLiveStatus } from './live-status'
import { openRosterBot } from './roster-actions'
import { botConnectionRoute, botRosterMeta } from './routing'
import { useTurnBusy } from './row-helpers'
import { retryBotDeliveries, stopBotTurn } from './run-controls'
import { taskLogGroups, taskLogLine } from './task-log'
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

interface BotRunsFeed {
  open: (run: BotRun) => void
  replay: (run: BotRun) => Promise<void>
  retryable: (run: BotRun) => boolean
  retryOutbox: () => void
  runs: BotRun[]
  stopRun: () => void
  stoppable: (run: BotRun) => boolean
}

/** The runs feed's full signal assembly + navigation handlers, shared by
 *  every rendering of the feed. Subscribes only to atoms the pane already
 *  watches — nothing here polls. */
export function useBotRunsFeed(
  owner: RosterRow,
  jobs: RoutineJob[],
  onOpenRoutine: (jobId: string) => void
): BotRunsFeed {
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

  // The canonical chat's dot carries a live turn even when the chat is not
  // the focused tile (a relay-delivered or routine turn on the hidden chat),
  // so the log's 'running' row follows the live status, not the tile.
  const live = useBotLiveStatus(owner)
  const chatWorking = live.kind === 'working' || live.kind === 'stalled'

  const runs = deriveBotRuns({
    attention,
    bot: owner,
    chatBusy,
    chatWorking,
    groupActivity,
    jobs,
    meta: owner ? botRosterMeta(owner, allMeta) : null,
    rooms
  })

  // E1/E3 row affordances: stop interrupts the canonical chat's in-flight
  // turn (the only runtime id a 'running' chat/relay row can mean); retry
  // kicks the relay outbox drain for a failed delivery row.
  const stoppable = (run: BotRun) => run.status === 'running' && (run.kind === 'chat' || run.kind === 'relay')

  const retryable = (run: BotRun) => run.kind === 'relay' && (run.status === 'attention' || run.status === 'failed')

  const stopRun = () => {
    void stopBotTurn(owner).then(result => {
      if (result === 'failed') {
        host.notifyError?.(new Error('session.interrupt rejected'), botsText().roster.stopRunFailed)
      }
    })
  }

  const retryOutbox = () => {
    retryBotDeliveries()
  }

  const open = (run: BotRun) => {
    if (run.kind === 'group' && run.group) {
      openGroupChat(run.group)
    } else if (run.kind === 'routine' && run.jobId) {
      onOpenRoutine(run.jobId)
    } else {
      void openRosterBot(owner)
    }
  }

  const replay = async (run: BotRun) => {
    const target = run.replay

    if (!target) {
      return
    }

    let route = null

    try {
      route = botConnectionRoute(owner)
    } catch {
      route = null
    }

    let sessionId = target.sessionId ?? null

    if (!sessionId && run.jobId && typeof host.listCronJobRuns === 'function') {
      try {
        const runs = await host.listCronJobRuns(route, {
          jobId: run.jobId,
          limit: 50,
          profile: owner.name
        })

        sessionId = pickCronRunSessionId(runs, run.at)
      } catch {
        sessionId = null
      }
    }

    if (!sessionId) {
      open(run)

      return
    }

    if (typeof armTranscriptReplayJump === 'function') {
      armTranscriptReplayJump(sessionId, run.at)
    }

    void host.openSession(sessionId, {
      ...(route ? { route } : {}),
      profile: owner.name,
      // A run session opens beside the canonical chat, never in its place.
      intent: 'tab'
    })
  }

  return { open, replay, retryable, retryOutbox, runs, stopRun, stoppable }
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

interface BotTaskLogProps {
  jobs: RoutineJob[]
  onOpenRoutine: (jobId: string) => void
  owner: RosterRow
}

/** Day-grouped log rows for the focused bot — check icon + one line + time. */
export function BotTaskLog({ jobs, onOpenRoutine, owner }: BotTaskLogProps) {
  const b = useBots()
  const { open, replay, retryable, retryOutbox, runs, stopRun, stoppable } = useBotRunsFeed(owner, jobs, onOpenRoutine)
  const days = taskLogGroups(runs)

  if (!days.length) {
    return <div className="px-3 pb-2 text-xs text-(--ui-text-quaternary)">{b.runs.empty}</div>
  }

  return (
    <div className="px-3 pb-2">
      {days.map(day => (
        <div key={day.at}>
          <div className="pt-2 pb-1 ui-section-label">
            {day.label === 'today'
              ? b.rail.today
              : day.label === 'yesterday'
                ? b.rail.yesterday
                : dayFormat.format(day.at)}
          </div>
          <div className="grid gap-0.5">
            {day.runs.map(run => {
              const kindLabel = b.runs[`kind${run.kind[0].toUpperCase()}${run.kind.slice(1)}` as 'kindChat']
              const statusLabel = b.runs[run.status]
              const line = taskLogLine(run) || kindLabel

              return (
                <RowButton
                  aria-label={`${line} — ${statusLabel}`}
                  className={cn(
                    'flex w-full min-w-0 max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors',
                    'hover:bg-(--chrome-action-hover)'
                  )}
                  key={run.id}
                  onClick={() => open(run)}
                >
                  <Tip label={statusLabel}>
                    <Codicon
                      aria-label={statusLabel}
                      className={cn('shrink-0 text-[0.6875rem]', runStatusClass(run.status))}
                      name={runStatusGlyph(run.status)}
                      spinning={run.status === 'running'}
                    />
                  </Tip>
                  <Tip label={kindLabel}>
                    <Codicon
                      aria-label={kindLabel}
                      className="shrink-0 text-[0.7rem] text-(--ui-text-quaternary)"
                      name={RUN_KIND_GLYPHS[run.kind]}
                    />
                  </Tip>
                  <span className="min-w-0 flex-1 truncate text-[0.75rem] text-(--ui-text-secondary)">{line}</span>
                  {run.replay ? (
                    <Tip label={b.runs.replay}>
                      <span
                        aria-label={b.runs.replay}
                        className="flex shrink-0 cursor-pointer items-center text-[0.6875rem] text-(--ui-text-quaternary) transition-colors hover:text-(--ui-text-secondary)"
                        onClick={event => {
                          event.stopPropagation()
                          void replay(run)
                        }}
                        role="button"
                      >
                        <Codicon name="history" />
                      </span>
                    </Tip>
                  ) : null}
                  {stoppable(run) ? (
                    <Tip label={b.roster.stopRun}>
                      <span
                        aria-label={b.roster.stopRun}
                        className="flex shrink-0 cursor-pointer items-center text-[0.6875rem] text-destructive"
                        onClick={event => {
                          event.stopPropagation()
                          stopRun()
                        }}
                        role="button"
                      >
                        <Codicon name="debug-stop" />
                      </span>
                    </Tip>
                  ) : null}
                  {retryable(run) ? (
                    <Tip label={b.roster.retryDeliveries}>
                      <span
                        aria-label={b.roster.retryDeliveries}
                        className="flex shrink-0 cursor-pointer items-center text-[0.6875rem] text-(--ui-accent)"
                        onClick={event => {
                          event.stopPropagation()
                          retryOutbox()
                        }}
                        role="button"
                      >
                        <Codicon name="refresh" />
                      </span>
                    </Tip>
                  ) : null}
                  <span className="shrink-0 text-[0.65rem] tabular-nums text-(--ui-text-quaternary)">
                    {timeFormat.format(run.at)}
                  </span>
                </RowButton>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
