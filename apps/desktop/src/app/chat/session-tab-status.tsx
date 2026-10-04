/**
 * Per-tab session status — the live signal a session TAB carries: elapsed time
 * plus the "what it's doing now" line (current tool, waiting question,
 * subagent count). Rendered on EVERY session tab by `PaneContribution.tabTrail`, so
 * a tile's strip answers "is it still running and on what" without fronting
 * the pane. (The zone strip's `stripTrail` — the skill chip — stays active-pane
 * only by design; the status belongs to the session, not the pane's focus.)
 *
 * The dot half of the signal already lives in `tabLead` (`SessionStatusDot`,
 * shared with the sidebar row). This is the textual half and reuses the same
 * interned stores the fleet rail paints from — a fresh projection would say
 * the same thing a tick later and pay the drift.
 */

import { useElapsedSeconds } from '@/components/chat/activity-timer'
import { ActivityTimerText } from '@/components/chat/activity-timer-text'
import { Tip } from '@/components/ui/tooltip'
import { useStoreSelector, useStoresSelector } from '@/lib/use-session-slice'
import { $fleetRuns } from '@/store/fleet-runs'
import { $sessionDigestById } from '@/store/session-digest'

import type { FleetRun } from './sidebar/fleet-rail'

/** What one session tab's status text shows: the live clock's origin (null
 *  when nothing is running) and the digest line (null when quiet). */
export interface SessionTabStatusModel {
  startedMs: null | number
  detail: null | string
}

export function sessionTabStatus(
  storedSessionId: null | string,
  runs: readonly FleetRun[],
  digests: Readonly<Record<string, string>>
): SessionTabStatusModel {
  if (!storedSessionId) {
    return { startedMs: null, detail: null }
  }

  const run = runs.find(entry => entry.sessionId === storedSessionId)

  // A rostered run's detail IS the digest resolved through lineage aliases —
  // prefer it so a compression tip claims its live line under the row id.
  return { startedMs: run?.startedMs ?? null, detail: run?.detail ?? digests[storedSessionId] ?? null }
}

export function SessionTabStatus({ storedSessionId }: { storedSessionId: null | string }) {
  const startedMs = useStoreSelector($fleetRuns, runs =>
    storedSessionId ? (runs.find(entry => entry.sessionId === storedSessionId)?.startedMs ?? null) : null
  )

  const detail = useStoresSelector(
    [$fleetRuns, $sessionDigestById],
    () => sessionTabStatus(storedSessionId, $fleetRuns.get(), $sessionDigestById.get()).detail
  )

  const elapsed = useElapsedSeconds(startedMs !== null, `session-tab:${storedSessionId ?? ''}`, startedMs ?? undefined)

  if (startedMs === null && !detail) {
    return null
  }

  return (
    // Decorative restatement of the status dot — screen readers already get
    // the tab's state from it, so the text stays out of the label.
    <span aria-hidden className="flex min-w-0 items-center gap-1.5">
      {startedMs !== null && <ActivityTimerText seconds={elapsed} />}
      {detail ? (
        <Tip label={detail}>
          <span className="truncate text-[0.56rem] leading-none tracking-[0.02em] text-midground/55">{detail}</span>
        </Tip>
      ) : null}
    </span>
  )
}
