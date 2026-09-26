import type { ClientSessionState } from '@/app/types'
import type { DesktopAgentRoster, DesktopConnectionKind, DesktopRegistryConnection } from '@/global'
import { chatMessageText } from '@/lib/chat-messages/parts'
import { sortConnectionsForDisplay } from '@/lib/connection-display'
import { sortByProfileOrder } from '@/lib/profile-order'
import { type SessionDotState, sessionStatusRank } from '@/store/session-dot-state'
import type { SessionOwnerScope } from '@/store/session-request-router'
import type { SessionInfo } from '@/types/hermes'

// Pure grouping for the fleet profile rail: which gateways sit "at rest"
// beside the active one, and which agents each of them carries. Kept free of
// React and stores so the ordering/collapse rules are unit-testable.

export interface FleetAgent {
  connectionId: string
  connectionKind: DesktopConnectionKind
  connectionLabel: string
  /** Profile name as the owning gateway knows it. */
  profile: string
  /** Pre-computed @name-device mention handle from the roster. */
  handle: string
  isDefault: boolean
}

export interface FleetGroup {
  connectionId: string
  kind: DesktopConnectionKind
  label: string
  reachable: boolean
  error?: string
  needsSignIn?: boolean
  /** The gateway's default profile — every Hermes home has one, so a group
   *  always carries it even before the roster has been enumerated. */
  defaultAgent: FleetAgent
  /** Named (non-default) profiles in the user's rail order, like the active strip. */
  named: FleetAgent[]
}

export const DEFAULT_PROFILE = 'default'

export function fleetRouteKey(connectionId: string, profile: string): string {
  return `${connectionId}::${profile}`
}

/**
 * Groups for every registered gateway EXCEPT the active one, in the same order
 * the connection switcher lists them (This device first, then by label), so the
 * rail and the readout agree. Positions never depend on which gateway is
 * active — a square must not move under the pointer when it is clicked.
 *
 * - No roster yet → each gateway still shows its default square, so the strip
 *   is complete on first paint and only gains named squares later.
 * - A gateway the roster neither lists as a source nor attributes agents to
 *   was collapsed into another registration of the same backend (install_id
 *   match) → skipped, never shown twice.
 */
export function buildRestGroups({
  activeConnectionId,
  connections,
  order = [],
  roster
}: {
  activeConnectionId: null | string
  connections: readonly DesktopRegistryConnection[]
  order?: readonly string[]
  roster: DesktopAgentRoster | null
}): FleetGroup[] {
  const groups: FleetGroup[] = []

  for (const connection of sortConnectionsForDisplay(connections)) {
    if (connection.id === activeConnectionId) {
      continue
    }

    const source = roster?.sources.find(candidate => candidate.connectionId === connection.id)
    const rows = roster?.agents.filter(agent => agent.connectionId === connection.id) ?? []

    if (roster && !source && rows.length === 0) {
      continue
    }

    const toAgent = (profile: string, handle?: string): FleetAgent => ({
      connectionId: connection.id,
      connectionKind: connection.kind,
      connectionLabel: connection.label,
      profile,
      handle: handle ?? profile,
      isDefault: profile === DEFAULT_PROFILE
    })

    const defaultRow = rows.find(row => row.profile === DEFAULT_PROFILE)

    const named = sortByProfileOrder(
      rows.filter(row => row.profile !== DEFAULT_PROFILE).map(row => toAgent(row.profile, row.handle)),
      order,
      agent => agent.profile
    )

    groups.push({
      connectionId: connection.id,
      kind: connection.kind,
      label: connection.label,
      reachable: source?.reachable ?? true,
      ...(source?.error && source.error !== 'connect-on-demand' ? { error: source.error } : {}),
      ...(source?.needsSignIn ? { needsSignIn: true } : {}),
      defaultAgent: toAgent(DEFAULT_PROFILE, defaultRow?.handle),
      named
    })
  }

  return groups
}

/** Every square on the rest side, for the condensed-menu threshold. */
export function countRestAgents(groups: readonly FleetGroup[]): number {
  return groups.reduce((total, group) => total + 1 + group.named.length, 0)
}

// ── Fleet run roster ─────────────────────────────────────────────────────────
// The roster overlay's card model: one entry per ACTIVE run across every
// profile and gateway this window knows about. The roster answers "what is
// working, where, and for how long" — click-through only, so a run with no
// resolvable stored id carries `sessionId: null` and renders inert.

export interface FleetRun {
  /** Stored session id — the click-through target. Null for a live runtime
   *  whose stored row has not reached this window yet (submit in flight). */
  sessionId: string | null
  /** The resolved dot state; 'working' when the backend row's is_active flag
   *  is the only proof of life this window has. */
  dot: SessionDotState
  /** The run's outcome line — session title, else the first user message,
   *  else the row preview. '' when nothing describes it yet. */
  title: string
  /** The live "what it's doing now" digest line; null when quiet. */
  detail: null | string
  /** Owning profile name ('default' when untagged). */
  profile: string
  /** Owning registry connection; null for the primary/local backend. */
  connectionId: null | string
  /** The owning gateway's display label; null when the registry doesn't
   *  know it (legacy primary rows carry no connection tag). */
  connectionLabel: null | string
  /** Epoch ms the run's clock started — the live turn's `turnStartedAt`,
   *  else the row's last activity, else its creation. */
  startedMs: null | number
}

// A run is rostered while its dot claims live work: a blocking prompt still
// has its turn open, and a background/delegating dot is active work by
// definition. Idle, unread, and draft rows have nothing running.
const LIVE_RUN_DOT: Readonly<Record<SessionDotState, boolean>> = {
  'needs-input': true,
  working: true,
  stalled: true,
  background: true,
  unread: false,
  idle: false,
  draft: false
}

const firstUserText = (state: ClientSessionState | undefined): string => {
  const first = state?.messages.find(message => message.role === 'user')

  return first ? chatMessageText(first).replace(/\s+/g, ' ').trim() : ''
}

/** Roster ordering: attention first, then live work, background last;
 *  within a tier the longest-running leads. */
const runRank = (dot: SessionDotState): number => (dot === 'background' ? 2 : sessionStatusRank(dot))

export function buildFleetRuns({
  connections,
  digests,
  dotStates,
  ownerForRuntimeId,
  sessions,
  states
}: {
  sessions: readonly SessionInfo[]
  dotStates: Readonly<Record<string, SessionDotState>>
  digests: Readonly<Record<string, string>>
  states: Readonly<Record<string, ClientSessionState>>
  connections: readonly DesktopRegistryConnection[]
  /** Resolves the (connection, profile) a runtime id's events arrived on —
   *  the rowless-run case, where no SessionInfo row carries the tags. */
  ownerForRuntimeId?: (runtimeId: string) => SessionOwnerScope
}): FleetRun[] {
  const connectionLabel = new Map(connections.map(connection => [connection.id, connection.label]))
  const runtimeByStored = new Map<string, string>()

  for (const [runtimeId, state] of Object.entries(states)) {
    if (state.storedSessionId) {
      runtimeByStored.set(state.storedSessionId, runtimeId)
    }
  }

  const stateFor = (key: string): ClientSessionState | undefined =>
    states[runtimeByStored.get(key) ?? ''] ?? states[key]

  const scopeParts = (scope: SessionOwnerScope): { connectionId: null | string; profile: string } => {
    if (typeof scope === 'string') {
      return { connectionId: null, profile: scope.trim() || DEFAULT_PROFILE }
    }

    if (scope) {
      return {
        connectionId: scope.connectionId?.trim() || null,
        profile: scope.profile?.trim() || scope.targetProfile?.trim() || DEFAULT_PROFILE
      }
    }

    return { connectionId: null, profile: DEFAULT_PROFILE }
  }

  const emitted = new Set<string>()
  const runs: FleetRun[] = []

  // Dot-claimed runs first — every live state a surface can paint. A claim's
  // key may be any lineage tip or a not-yet-persisted runtime id, so rows and
  // states both get consulted before deciding a card can't open.
  for (const [key, dot] of Object.entries(dotStates)) {
    if (!LIVE_RUN_DOT[dot]) {
      continue
    }

    // A claim may land on any lineage alias (compression/branch tips claim
    // under every id), not just the row's stored id — resolve both.
    const row = sessions.find(session => session.id === key) ?? sessions.find(session => session._lineage_ids?.includes(key))

    if (row?.archived) {
      continue
    }

    const state = stateFor(key)
    const sessionId = row?.id ?? state?.storedSessionId ?? null
    const dedupeKey = sessionId ?? key

    if (emitted.has(dedupeKey)) {
      continue
    }

    emitted.add(dedupeKey)

    const scope = row ? null : ownerForRuntimeId?.((sessionId && runtimeByStored.get(sessionId)) || key)

    const { connectionId, profile } = row
      ? { connectionId: row.connection_id?.trim() || null, profile: row.profile?.trim() || DEFAULT_PROFILE }
      : scopeParts(scope)

    runs.push({
      sessionId,
      dot,
      title: (row?.title ?? '').trim() || firstUserText(state) || (row?.preview ?? '').trim(),
      detail: (sessionId ? digests[sessionId] : undefined) ?? digests[key] ?? null,
      profile,
      connectionId,
      connectionLabel: connectionId ? (connectionLabel.get(connectionId) ?? null) : null,
      startedMs: state?.turnStartedAt ?? (row ? row.last_active * 1000 : (state?.runtimeStartedAt ?? null))
    })
  }

  // Rows the backend still marks active but whose runtime this window has
  // never seen (a run started before launch, or on another surface): no dot
  // claim exists, so paint them as working off the row alone.
  for (const row of sessions) {
    if (!row.is_active || row.archived || emitted.has(row.id)) {
      continue
    }

    emitted.add(row.id)

    const connectionId = row.connection_id?.trim() || null

    runs.push({
      sessionId: row.id,
      dot: 'working',
      title: (row.title ?? '').trim() || (row.preview ?? '').trim(),
      detail: digests[row.id] ?? null,
      profile: row.profile?.trim() || DEFAULT_PROFILE,
      connectionId,
      connectionLabel: connectionId ? (connectionLabel.get(connectionId) ?? null) : null,
      startedMs: row.last_active ? row.last_active * 1000 : row.started_at ? row.started_at * 1000 : null
    })
  }

  return runs.sort((a, b) => runRank(a.dot) - runRank(b.dot) || (a.startedMs ?? Infinity) - (b.startedMs ?? Infinity))
}
