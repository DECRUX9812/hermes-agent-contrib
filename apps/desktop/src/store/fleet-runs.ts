import { computed } from 'nanostores'

import { buildFleetRuns, type FleetRun } from '@/app/chat/sidebar/fleet-rail'

import { $connectionsRegistry } from './connections'
import { $sessions } from './session'
import { $sessionDigestById } from './session-digest'
import { $sessionDotStateById } from './session-dot-state'
import { $sessionStates, runtimeSessionOwner } from './session-states'

/**
 * Every ACTIVE run across profiles and gateways, as roster cards — the data
 * behind the fleet rail's roster pill and the roster overlay. All inputs are
 * stores the shell already maintains (session list, dot states, digests,
 * live runtimes, connection registry); nothing here fetches.
 *
 * Runs intern their objects: a stream tick rebuilds the projection, but a
 * card whose fields all survived keeps its identity, so the overlay paints
 * only what actually changed.
 */
let prevRuns: readonly FleetRun[] = []
const interned = new Map<string, FleetRun>()

const FLEET_RUN_FIELDS: readonly (keyof FleetRun)[] = [
  'sessionId',
  'dot',
  'title',
  'detail',
  'profile',
  'connectionId',
  'connectionLabel',
  'startedMs'
]

const sameRun = (a: FleetRun, b: FleetRun): boolean => FLEET_RUN_FIELDS.every(field => a[field] === b[field])

export const $fleetRuns = computed(
  [$sessions, $sessionDotStateById, $sessionDigestById, $sessionStates, $connectionsRegistry],
  (sessions, dotStates, digests, states, registry) => {
    const next = buildFleetRuns({
      connections: registry?.connections ?? [],
      digests,
      dotStates,
      ownerForRuntimeId: runtimeSessionOwner,
      sessions,
      states
    })

    const keyed = (run: FleetRun): string => run.sessionId ?? `anon:${run.profile}:${run.title}`

    const kept = next.map(run => {
      const prev = interned.get(keyed(run))

      if (prev && sameRun(prev, run)) {
        return prev
      }

      interned.set(keyed(run), run)

      return run
    })

    // Forget runs that left the projection so the intern map doesn't grow.
    const liveKeys = new Set(kept.map(keyed))

    for (const key of interned.keys()) {
      if (!liveKeys.has(key)) {
        interned.delete(key)
      }
    }

    return (prevRuns = kept.length === prevRuns.length && kept.every((run, i) => run === prevRuns[i]) ? prevRuns : kept)
  }
)
