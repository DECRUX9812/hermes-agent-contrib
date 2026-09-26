/**
 * HUD run cards — compact per-session cards for every live run, parked under
 * the composer bar. HUD mode's job is ambient awareness: which sessions are
 * working, which need you — without opening the app window. Data is
 * `$fleetRuns`, the same interned projection the fleet rail and roster paint
 * from, so a card here can never disagree with the sidebar.
 *
 * The only verb is click-through: report the run's session to main and close
 * the HUD, so the app window's handoff (`useHudHandoff`) re-homes onto it —
 * fronting the tile if it is one, routing to it otherwise. A run whose stored
 * id has not reached this window (`sessionId: null`, a submit still in flight)
 * renders inert, same as the roster card.
 */

import { useStore } from '@nanostores/react'

import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $fleetRuns } from '@/store/fleet-runs'
import { closeHud, reportHudSession } from '@/store/hud'
import { $selectedStoredSessionId, $sessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import { SessionStatusDot } from '../chat/session-status-dot'
import type { FleetRun } from '../chat/sidebar/fleet-rail'

/** The runs HUD cards list: the session this window IS on is already the
 *  transcript below the bar, so its card is noise — drop it. */
export function hudRunCards(runs: readonly FleetRun[], currentSessionId: null | string): FleetRun[] {
  return runs.filter(run => run.sessionId !== currentSessionId)
}

export function HudRunCards() {
  const { t } = useI18n()
  const runs = useStore($fleetRuns)
  const sessions = useStore($sessions)
  const current = useStore($selectedStoredSessionId)
  const cards = hudRunCards(runs, current)

  if (cards.length === 0) {
    return null
  }

  return (
    <div aria-label={t.roster.title} data-hud-runs role="group">
      {cards.map(run => (
        <HudRunCard
          key={run.sessionId ?? `${run.profile}:${run.title}`}
          run={run}
          session={sessions.find(row => row.id === run.sessionId) ?? null}
        />
      ))}
    </div>
  )
}

function HudRunCard({ run, session }: { run: FleetRun; session: null | SessionInfo | undefined }) {
  const { t } = useI18n()
  const elapsed = useElapsedSeconds(
    Boolean(run.startedMs),
    `hud-run:${run.sessionId ?? run.title}`,
    run.startedMs ?? undefined
  )
  const openable = run.sessionId !== null
  const needsYou = run.dot === 'needs-input'
  const title = run.title || t.roster.untitledRun

  const openInApp = () => {
    if (!run.sessionId) {
      return
    }

    // Close is a re-home, not a teardown: main hands the app window this
    // session and the handoff opens it there.
    reportHudSession(run.sessionId)
    closeHud()
  }

  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <SessionStatusDot session={session} storedSessionId={run.sessionId} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {needsYou && <span data-hud-run-needs>{t.hud.needsYou}</span>}
        {run.startedMs ? <ActivityTimerText seconds={elapsed} /> : null}
      </span>
      {run.detail ? <span className="block truncate pl-3 opacity-70">{run.detail}</span> : null}
    </>
  )

  if (!openable) {
    return (
      <div className="grid min-w-0 gap-0.5 px-2 py-1" data-hud-run-card>
        {body}
      </div>
    )
  }

  return (
    <button
      aria-label={t.hud.openRunInApp(title)}
      className={cn('grid w-full min-w-0 gap-0.5 px-2 py-1 text-left', needsYou && 'hud-run-needs')}
      data-hud-run-card
      onClick={openInApp}
      type="button"
    >
      {body}
    </button>
  )
}
