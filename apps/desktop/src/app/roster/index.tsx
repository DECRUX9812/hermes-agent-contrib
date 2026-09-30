import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $fleetRuns } from '@/store/fleet-runs'
import { $sessions, requestSessionResume, sessionOwnerRouteFromRow } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import { SessionStatusDot } from '../chat/session-status-dot'
import type { FleetRun } from '../chat/sidebar/fleet-rail'
import { useFleetRoster } from '../chat/sidebar/use-fleet-roster'
import { openSession } from '../open-session'
import { Panel, PanelEmpty, PanelHeader } from '../overlays/panel'

import { FanOutPanel } from './fan-out'
import type { FanOutTarget } from './fan-out-model'

/**
 * The fleet run roster — every active run across profiles and gateways as a
 * card. Roadmap #19: run cards stay click-through only (a card's only verb is
 * "take me to that run"); roadmap #21 adds the fan-out panel, which mints NEW
 * sessions rather than acting on the listed runs. Data comes from
 * `$fleetRuns`, a projection of stores the shell already maintains, so the
 * overlay paints live without owning any fetch of its own beyond the fleet
 * roster refresh the rail already performs on demand.
 */
export function RosterView({
  onClose,
  onFanOut
}: {
  onClose: () => void
  /** Roadmap #21: send one prompt to every explicitly-picked agent as sibling
   *  tiles. Wiring owns the creates + submits; absent on hosts that can't. */
  onFanOut?: (targets: FanOutTarget[], text: string) => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const runs = useStore($fleetRuns)
  const sessions = useStore($sessions)
  const [fanOutOpen, setFanOutOpen] = useState(false)

  // Same on-demand contract as the rail: pull once on mount and on window
  // focus, never on a timer.
  useFleetRoster(true)

  const openRun = (run: FleetRun) => {
    if (!run.sessionId) {
      return
    }

    // Same door the sidebar row uses: pin the row's own (connection, profile)
    // before navigating so an id shared across profiles can never dial the
    // wrong gateway.
    const ownerRoute = sessionOwnerRouteFromRow(sessions.find(row => row.id === run.sessionId))

    if (ownerRoute) {
      requestSessionResume(run.sessionId, ownerRoute)
    } else {
      requestSessionResume(run.sessionId)
    }

    // Close first so the overlay never sits over the surface we just focused;
    // openSession then lands the run in place or jumps to its tile.
    onClose()
    openSession(run.sessionId, navigate)
  }

  return (
    <Panel closeLabel={t.roster.close} onClose={onClose}>
      <PanelHeader
        actions={
          onFanOut && !fanOutOpen ? (
            <button
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-(--ui-row-hover-background) hover:text-foreground"
              onClick={() => setFanOutOpen(true)}
              type="button"
            >
              <Codicon name="broadcast" size="0.875rem" />
              {t.roster.fanOut}
            </button>
          ) : null
        }
        subtitle={t.roster.subtitle}
        title={t.roster.title}
      />
      {onFanOut && fanOutOpen ? (
        <FanOutPanel
          onCollapse={() => setFanOutOpen(false)}
          onSend={(targets, text) => {
            // The new tabs land behind the overlay; close so they're the
            // surface the fan-out visibly fills.
            onClose()
            onFanOut(targets, text)
          }}
        />
      ) : null}
      {runs.length === 0 ? (
        <PanelEmpty description={t.roster.emptyDesc} icon="pulse" title={t.roster.emptyTitle} />
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
          <div className="grid min-w-0 gap-1">
            {runs.map(run => (
              <FleetRunCard
                key={run.sessionId ?? `${run.profile}:${run.title}`}
                onOpen={() => openRun(run)}
                run={run}
                session={sessions.find(row => row.id === run.sessionId) ?? null}
              />
            ))}
          </div>
        </div>
      )}
    </Panel>
  )
}

function FleetRunCard({
  onOpen,
  run,
  session
}: {
  onOpen: () => void
  run: FleetRun
  session: null | SessionInfo | undefined
}) {
  const { t } = useI18n()

  const elapsed = useElapsedSeconds(
    Boolean(run.startedMs),
    `fleet-run:${run.sessionId ?? run.title}`,
    run.startedMs ?? undefined
  )

  const openable = run.sessionId !== null
  const where = [run.profile, run.connectionLabel].filter(Boolean).join(' · ')

  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <SessionStatusDot session={session} storedSessionId={run.sessionId} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[0.78rem] font-medium',
            openable ? 'text-foreground/90' : 'text-foreground/70'
          )}
        >
          {run.title || t.roster.untitledRun}
        </span>
        {run.startedMs ? <ActivityTimerText className="text-[0.66rem]" seconds={elapsed} /> : null}
      </span>
      {run.detail ? (
        <span className="truncate pl-3.5 text-[0.68rem] leading-snug text-muted-foreground/75">{run.detail}</span>
      ) : null}
      <span className="flex min-w-0 items-center gap-1.5 pl-3.5 text-[0.62rem] text-muted-foreground/60">
        <Codicon className="shrink-0 opacity-70" name="person" size="0.65rem" />
        <span className="truncate">{where}</span>
      </span>
    </>
  )

  if (!openable) {
    return (
      <div className="grid min-w-0 gap-0.5 rounded-md px-2 py-1.5" data-slot="fleet-run-card">
        {body}
      </div>
    )
  }

  return (
    <button
      className="row-hover grid w-full min-w-0 gap-0.5 rounded-md px-2 py-1.5 text-left"
      data-slot="fleet-run-card"
      onClick={onOpen}
      type="button"
    >
      {body}
    </button>
  )
}
