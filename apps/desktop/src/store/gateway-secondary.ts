import {
  type GatewayEvent,
  isGatewayReauthRequired,
  isStableOpen,
  reconnectBackoffDelayMs,
  registryBackendScopeKey,
  resolveGatewayWsUrl
} from '@hermes/shared'

import { HermesGateway } from '@/hermes'
import { translateNow } from '@/i18n'
import {
  decideLivenessForceClose,
  LIVENESS_PROBE_TIMEOUT_MS,
  LIVENESS_REPROBE_DELAY_MS
} from '@/lib/gateway-liveness-policy'
import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import {
  isTimeoutError,
  RECONNECT_ATTEMPT_TIMEOUT_MS,
  SOURCE_SWITCH_DIAL_TIMEOUT_MS,
  withTimeout
} from '@/lib/with-timeout'
import { notifyError, RECOVERY_ACTIONS } from '@/store/notifications'
import { stampSecondaryProfileOwner } from '@/store/session-event-provenance'

import {
  dialPriority,
  dialProfile,
  dispatchServerRequest,
  g,
  isOpen,
  normKey,
  openedSecondaryScopes,
  publishActiveConnection,
  reactivatingScopes,
  reportGatewayState,
  type Secondary,
  setActive,
  type SpawnPriority
} from './gateway-registry'

export function clearTimer(entry: Secondary): void {
  if (entry.reconnectTimer !== null) {
    clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
  }
}

export async function openSecondary(entry: Secondary, spawnPriority: SpawnPriority = 'background'): Promise<void> {
  const desktop = window.hermesDesktop

  const reauthError = g.reauthFailures.get(entry.scope)?.error

  if (reauthError) {
    throw reauthError
  }

  if (!desktop) {
    return
  }

  if (entry.connectPromise) {
    if (spawnPriority === 'foreground') {
      // Hydration may already own this dial as a background slot wait. Kick a
      // foreground IPC so main can promote it onto the reserved slot.
      void (
        entry.connectionId && desktop.getConnectionFor
          ? desktop.getConnectionFor({
              connectionId: entry.connectionId,
              profile: entry.profile,
              priority: 'foreground'
            })
          : desktop.getConnection(entry.profile, { priority: 'foreground' })
      ).catch(() => undefined)
    }

    await entry.connectPromise

    return
  }

  const pending = (async () => {
    // A secondary can be reopened directly by the next routed user action,
    // without passing through reconnectSecondary(). Its previous backend may
    // have been respawned, so every stored→runtime binding for this exact scope
    // is process-local stale state. Invalidate BEFORE connect publishes `open`:
    // otherwise an eager route effect / submit can send the old runtime id in
    // the narrow window between the new socket opening and post-connect cleanup.
    //
    // Dynamic import keeps the existing session-states → gateway module cycle
    // open. Awaiting it is intentional: correctness at the generation boundary
    // outranks the single local-module microtask this adds to a reconnect.
    const openedScopes = openedSecondaryScopes()
    const reopening = entry.lastOpenedAt > 0 || entry.connection !== null || openedScopes.has(entry.scope)
    let reconcileBusyAfterOpen: null | (() => void) = null

    if (reopening) {
      try {
        const { reconcileBusyStatesOnReconnect, resetRouteOwnedTileRuntimeBindings, resetTileRuntimeBindings } =
          await import('@/store/session-states')

        const scope = { connectionId: entry.connectionId || 'local', profile: entry.profile }

        // Only the window's ambient gateway carries un-owned tiles and the main
        // thread. A background route (e.g. a relay request lease that disposed
        // its socket after the last tick) can only have minted runtimes for
        // tiles that name it as their owner route.
        if (g.activeKey === entry.scope) {
          resetTileRuntimeBindings(scope)
        } else {
          resetRouteOwnedTileRuntimeBindings(scope)
        }

        reconcileBusyAfterOpen = () => reconcileBusyStatesOnReconnect(entry.scope)
      } catch {
        // Best effort for partial test/HMR graphs. Production always loads the
        // real store; a failed import must not make the transport unrecoverable.
      }
    }

    // Registry-scoped entries dial through getConnectionFor when the bridge has
    // it. Local/legacy entries retain the existing getConnection path. Both are
    // IPC round-trips into the main process with no timeout of their own
    // (#93454) — a wedged main-process round-trip otherwise hangs this await
    // forever, latching entry.connectPromise so every routed action against
    // this secondary (SSH terminal, messaging DELETE, session send, …) never
    // settles either. Bound the same way use-gateway-boot.ts bounds the
    // primary's equivalent awaits.
    //
    // Two bring-ups with different legitimate worst cases: a registry route is a
    // backend coming up on ANOTHER machine (ssh connect + probes + remote spawn +
    // ready sentinel), which is the SOURCE_SWITCH_DIAL budget, while a local
    // profile's pooled child spawns on this machine (measured ~9 s; the
    // reconnect-class budget is not the binding constraint there).
    const conn =
      entry.connectionId && desktop.getConnectionFor
        ? await withTimeout(
            desktop.getConnectionFor({
              connectionId: entry.connectionId,
              profile: entry.profile,
              ...dialPriority(spawnPriority)
            }),
            SOURCE_SWITCH_DIAL_TIMEOUT_MS,
            `Timed out connecting to profile "${entry.profile}"`
          )
        : await withTimeout(
            dialProfile(desktop, entry.profile, spawnPriority),
            RECONNECT_ATTEMPT_TIMEOUT_MS,
            `Timed out connecting to profile "${entry.profile}"`
          )

    entry.connection = conn

    const wsDeps =
      entry.connectionId && desktop.getGatewayWsUrlFor
        ? {
            getGatewayWsUrl: () =>
              desktop.getGatewayWsUrlFor!({ connectionId: entry.connectionId, profile: entry.profile })
          }
        : entry.connectionId
          ? {}
          : desktop

    const wsUrl = await withTimeout(
      resolveGatewayWsUrl(wsDeps, conn),
      RECONNECT_ATTEMPT_TIMEOUT_MS,
      `Timed out re-minting the gateway WebSocket URL for profile "${entry.profile}"`
    )

    try {
      await entry.gateway.connect(wsUrl)
    } catch (error) {
      // Log the dial target for support, but RETHROW THE ORIGINAL ERROR —
      // reconnectSecondary classifies failures by message ("No connection
      // with id", "no longer exists") to fail-stop permanent conditions, and
      // wrapping here would break that. Callers decide surfacing (#81094).
      console.error(`[gateway] dial failed for scope="${entry.scope}" profile="${entry.profile}":`, error)
      throw error
    }

    entry.lastOpenedAt = Date.now()
    // A fresh socket owes nothing to a previous socket's missed pings.
    entry.livenessProbeFailures = 0
    clearSecondaryLivenessReprobe(entry)
    openedScopes.add(entry.scope)

    try {
      reconcileBusyAfterOpen?.()
    } catch {
      // The socket is already open. A best-effort UI-state reconcile must not
      // turn that successful transport recovery into a reported dial failure.
    }

    if (!entry.wantOpen) {
      entry.gateway.close()

      return
    }

    if (g.activeKey === entry.scope) {
      publishActiveConnection(conn)
    }

    void desktop.touchBackend?.(entry.scope).catch(() => undefined)
  })()

  entry.connectPromise = pending

  try {
    await pending
  } catch (error) {
    if (isGatewayReauthRequired(error) && g.secondaries.get(entry.scope) === entry) {
      g.reauthFailures.set(entry.scope, { connectionId: entry.connectionId, error })
      entry.wantOpen = false
      clearTimer(entry)
    }

    throw error
  } finally {
    if (entry.connectPromise === pending) {
      entry.connectPromise = null
    }
  }
}

// Consecutive STALLED automatic dials (a pool-slot wait or the 20s dial
// timeout, never a fast transport error) before a secondary parks. A
// tile-pinned scope stays wantOpen for the tile's lifetime, so an owner
// backend that keeps losing its slot wait otherwise re-queues a background
// spawn on every backoff tick forever — the queue/timeout treadmill in
// #103375. Fast failures (a gateway restarting, ECONNREFUSED) keep the
// ordinary unbounded backoff: they cost nothing and the socket must come back
// on its own. Parking keeps the entry; any explicit open of the scope
// (requestGatewayForAgent, openGatewayForAgent, ensureGatewayForAgent,
// ensureActiveGatewayOpen) re-arms it with a fresh budget.
const SECONDARY_STALLED_DIAL_BUDGET = 3

function isStalledDialError(error: unknown): boolean {
  if (isTimeoutError(error)) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error ?? '')

  return message.includes('timed out while waiting for a free slot')
}

export function rearmSecondary(entry: Secondary, priority: SpawnPriority = 'foreground'): void {
  const reauthError = g.reauthFailures.get(entry.scope)?.error

  if (reauthError && priority !== 'foreground') {
    throw reauthError
  }

  g.reauthFailures.delete(entry.scope)

  // Only an explicit (foreground) re-arm resets dial history: every background request rearms
  // its scope before dialing, so clearing it here would lift the throttle on each poll.
  if (priority === 'foreground') {
    g.dialFailures.delete(entry.scope)
  }

  if (entry.retiredByPool && priority !== 'foreground') {
    throw new Error(`Backend for "${entry.profile}" was retired; open it explicitly to reconnect.`)
  }

  entry.wantOpen = true
  entry.stalledDials = 0
  entry.retiredByPool = false
}

function recordDialFailure(entry: Secondary, error?: unknown): void {
  // Auth rejection has its own ledger (reauthFailures) that already fails background callers fast.
  if (error !== undefined && isGatewayReauthRequired(error)) {
    return
  }

  const previous = g.dialFailures.get(entry.scope)

  g.dialFailures.set(entry.scope, {
    at: Date.now(),
    streak: (previous?.streak ?? 0) + 1,
    connectionId: entry.connectionId ?? null
  })
}

/** True while a background caller must leave redialing to the ladder: the scope's last dial
 *  failed (or its socket died before RECONNECT_STABLE_OPEN_MS) inside a window that widens with
 *  the failure streak, on the same ceilings as the reconnect ladder. History clears on proof of
 *  health (a served RPC, or a socket that lived) and on a fresh start (foreground re-arm, connection
 *  removal, full teardown) — never on a bare open, so an accept-then-close backend keeps escalating. */
export function backgroundDialCoolingDown(scope: string, now = Date.now()): boolean {
  const failure = g.dialFailures.get(scope)

  return failure !== undefined && now - failure.at < reconnectBackoffDelayMs(failure.streak - 1, { jitter: false })
}

/** Dial a request's secondary if it is down. Both request paths (a plain profile via
 *  gatewayForProfile, a registry route via requestGatewayForAgent) used to dial straight past
 *  the reconnect ladder, and openSecondary only coalesces CONCURRENT dials, so a poller against
 *  a scope whose socket accepts and then dies redialed once per tick (session.control.read on a
 *  cross-profile session, #121865). After a failure, background callers fail fast and leave
 *  redialing to scheduleReconnect; a user action (foreground) still dials at once. */
export async function openSecondaryForRequest(entry: Secondary, spawnPriority: SpawnPriority): Promise<void> {
  if (isOpen(entry.gateway)) {
    return
  }

  if (spawnPriority !== 'foreground' && backgroundDialCoolingDown(entry.scope)) {
    scheduleReconnect(entry)
    throw new Error(`Backend for "${entry.profile}" is reconnecting; retry after it settles.`)
  }

  try {
    await openSecondary(entry, spawnPriority)
  } catch (error) {
    recordDialFailure(entry, error)
    throw error
  }
}

export function scheduleReconnect(entry: Secondary): void {
  if (entry.reconnecting || entry.reconnectTimer !== null || !entry.wantOpen) {
    return
  }

  // Full-jitter exponential backoff — same shape (and same reason: avoid a
  // reconnect storm against a restarting gateway) as the primary's.
  const delay = reconnectBackoffDelayMs(entry.reconnectAttempt)
  entry.reconnectAttempt += 1
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null
    void reconnectSecondary(entry)
  }, delay)
}

export async function reconnectSecondary(entry: Secondary): Promise<void> {
  if (entry.reconnecting || !entry.wantOpen || isOpen(entry.gateway)) {
    return
  }

  entry.reconnecting = true

  try {
    await openSecondary(entry)
  } catch (error) {
    // Restart the background-request cooldown from the ladder's own failure too, or a poll
    // could slip a dial in between two ladder attempts on an older, expired window.
    recordDialFailure(entry, error)

    if (isGatewayReauthRequired(error)) {
      notifyError(error, translateNow('boot.errors.gatewaySignInRequired'), { action: RECOVERY_ACTIONS.openGateways() })

      return
    }

    // The registry no longer knows this connection (removed while we were
    // backing off), or Electron's deletion guard reports the profile itself
    // gone/mid-delete. Both are permanent for this scoped socket — retrying
    // forever can never succeed and hammers the spawn guard every backoff
    // tick (#88769). Fail-stop: dispose the entry and evict it instead of an
    // infinite 15s-cap retry loop.
    if ((entry.connectionId && isMissingConnectionError(error)) || isMissingProfileError(error)) {
      entry.reconnecting = false
      disposeSecondary(entry)

      if (g.secondaries.get(entry.scope) === entry) {
        g.secondaries.delete(entry.scope)
      }

      restoreActiveToPrimaryIfEvicted()

      return
    }

    // Only a successful open resets the stall budget (the 'open' state
    // listener): a treadmill that alternates slot-wait timeouts with a
    // spawned-but-unresponsive socket must still run out of budget.
    if (isStalledDialError(error)) {
      entry.stalledDials += 1

      if (entry.stalledDials >= SECONDARY_STALLED_DIAL_BUDGET) {
        console.warn(
          `[gateway] parking scope="${entry.scope}" after ${entry.stalledDials} stalled dials; the next open or wake nudge redials it`
        )
        entry.wantOpen = false
        entry.stalledDials = 0
      }
    }
    // Still wantOpen → fall through to the backoff below.
  } finally {
    entry.reconnecting = false

    if (entry.wantOpen && !isOpen(entry.gateway)) {
      scheduleReconnect(entry)
    }
  }
}

// Electron's getConnectionFor rejects with `No connection with id "…"` when
// the registry entry is gone. That is a permanent condition for the scoped
// socket, unlike transient transport errors.
function isMissingConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')

  return message.includes('No connection with id')
}

// Electron's spawn guard (assertLocalProfileCanStart) rejects with these when
// the profile's directory is gone or its DELETE is still in flight. For a
// renderer socket that condition is permanent: the backend it reconnects to
// can never come back, and every retry hammers the guard (#88769).
function isMissingProfileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')

  return message.includes('no longer exists') || message.includes('is being deleted')
}

export function createSecondary(profile: string, connectionId: null | string = null): Secondary {
  const gateway = new HermesGateway()
  const scope = registryBackendScopeKey(connectionId, profile)

  const entry: Secondary = {
    scope,
    profile,
    connectionId,
    connection: null,
    gateway,
    lastOpenedAt: 0,
    openedAt: null,
    activeRequests: 0,
    connectPromise: null,
    offEvent: () => {},
    offRequest: () => {},
    offState: () => {},
    reconnectTimer: null,
    reconnectAttempt: 0,
    livenessProbeFailures: 0,
    livenessReprobeTimer: null,
    stalledDials: 0,
    reconnecting: false,
    pendingConnectionRedial: false,
    retained: false,
    relayRetainCount: 0,
    wantOpen: true,
    retiredByPool: false,
    activationLeaseUntil: 0
  }

  // Events keep carrying the bare profile — session routing is profile-keyed
  // everywhere. A pool secondary with no registry connection has no exact
  // connection id, so stamp this closure-owned profile before registry fan-in;
  // the recorder must not promote an arbitrary wire `profile` field instead.
  entry.offEvent = gateway.onEvent(event => {
    const scopedEvent = stampSecondaryProfileOwner({ ...event, ...(connectionId ? { connectionId } : {}) }, profile)

    g.config?.onEvent(scopedEvent)
    releaseTerminalTurnLease(entry.scope, event)
  })
  entry.offRequest = gateway.onRequest?.(request => dispatchServerRequest(request, profile, connectionId)) ?? (() => {})
  entry.offState = gateway.onState(state => {
    reportGatewayState(scope, state)

    if (state === 'open') {
      entry.stalledDials = 0
      entry.openedAt = Date.now()
      clearTimer(entry)
    } else if (state === 'closed' || state === 'error') {
      // Same stable-open rule as the primary (#83134): an accept-then-close socket
      // is a failed attempt, so the ladder resets only after a socket that lived.
      if (isStableOpen(entry.openedAt)) {
        entry.reconnectAttempt = 0
        g.dialFailures.delete(scope)
      } else if (entry.openedAt !== null) {
        recordDialFailure(entry)
      }

      entry.openedAt = null

      // A dead socket cannot emit the terminal event that normally releases
      // its turn lease. Drop the orphaned lease before deciding whether this
      // route is still retained/active enough to reconnect.
      releaseTurnLeasesForScope(scope)

      if (entry.wantOpen) {
        scheduleReconnect(entry)
      }
    }
  })

  g.secondaries.set(scope, entry)

  return entry
}

// ── Bot-relay socket retention (#93594) ─────────────────────────────────────
// The desktop bot relay RPCs EVERY registered connection on its drain loop.
// Each of those calls runs through requestGatewayForAgent's per-request lease,
// so a connection with no other consumer dialed a fresh WebSocket and tore it
// down again on every tick — a connect/disconnect pair per connection per tick
// flooding the gateway logs. While the relay is active, its routes hold a
// counted retention that keeps the pooled socket (and its existing
// scheduleReconnect/backoff machinery) alive across ticks; stopBotRelay (and
// plugin dispose) releases it, restoring the dispose-at-refcount-0 behavior.

/**
 * True when a foreground surface (mounted tile / primary thread) is bound to
 * this entry's scope (#93892). Registry-scoped entries match on their
 * composite key only; local/legacy entries also match on the bare profile —
 * the same key language pruneSecondaryGateways' keep-set speaks.
 */
export function foregroundPinned(entry: Secondary): boolean {
  const scopes = g.config?.foregroundScopes?.()

  if (!scopes) {
    return false
  }

  return scopes.has(entry.scope) || (!entry.connectionId && scopes.has(entry.profile))
}

/** True when the bot relay currently pins this entry open. Number guard:
 *  dev-HMR entries predate the field. */
export function relayRetained(entry: Secondary): boolean {
  return Number.isFinite(entry.relayRetainCount) && entry.relayRetainCount > 0
}

export const turnLeaseKey = (scope: string, sessionId: string): string => `${scope}\u0000${sessionId}`
const TURN_LEASE_SETTLE_DELAY_MS = 500

export function cancelTurnLeaseRelease(key: string): void {
  const timer = g.turnLeaseReleaseTimers.get(key)

  if (timer !== undefined) {
    clearTimeout(timer)
    g.turnLeaseReleaseTimers.delete(key)
  }
}

export function releaseTurnLeasesForScope(scope: string): void {
  const prefix = `${scope}\u0000`

  for (const [key, timer] of [...g.turnLeaseReleaseTimers]) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer)
      g.turnLeaseReleaseTimers.delete(key)
    }
  }

  for (const [key, release] of [...g.turnLeases]) {
    if (key.startsWith(prefix)) {
      release()
    }
  }
}

export function scopeHasTurnLease(scope: string): boolean {
  const prefix = `${scope}\u0000`

  for (const key of g.turnLeases.keys()) {
    if (key.startsWith(prefix)) {
      return true
    }
  }

  return false
}

// Tell main whether a prompt turn leases this scope's pooled backend. An early
// skip for cooperative retirement (electron/pool-retire.ts), never the proof:
// main asks the backend itself before stopping anything. From #104871.
export function publishTurnLease(scope: string, activeTurn: boolean): void {
  void window.hermesDesktop?.touchBackend?.(scope, { activeTurn }).catch(() => undefined)
}

function releaseTerminalTurnLease(scope: string, event: GatewayEvent): void {
  const sessionId = String(event.session_id || '').trim()

  if (!sessionId) {
    return
  }

  const key = turnLeaseKey(scope, sessionId)

  if (event.type === 'message.start') {
    // The gateway emits settled session.info before immediately chaining a
    // queued/goal follow-up. Keep the same route alive for that next turn.
    cancelTurnLeaseRelease(key)

    return
  }

  if (event.type === 'session.reclaimed') {
    g.turnLeases.get(key)?.()

    return
  }

  const payload = event.payload as Record<string, unknown> | undefined

  if (event.type === 'session.info' && payload?.running === false && !g.turnLeaseReleaseTimers.has(key)) {
    // session.info(false) is the authoritative settled edge, but auto-followup
    // emits message.start immediately after it. A short debounce lets that
    // frame cancel release while still reclaiming ordinary completed turns.
    g.turnLeaseReleaseTimers.set(
      key,
      setTimeout(() => {
        g.turnLeaseReleaseTimers.delete(key)
        g.turnLeases.get(key)?.()
      }, TURN_LEASE_SETTLE_DELAY_MS)
    )
  }
}

// Grace period before the live-work pruner may dispose a freshly opened
// secondary socket; see the min-lifetime guard in pruneSecondaryGateways
// (#94769 prune ↔ redial race). Exported for the tests that age a socket past it.
export const SECONDARY_MIN_LIFETIME_MS = 30_000

// A deferred liveness re-probe for one entry: cleared when the probe is
// answered, the socket is redialed (fresh streak), or the entry is disposed.
function clearSecondaryLivenessReprobe(entry: Secondary): void {
  if (entry.livenessReprobeTimer !== null) {
    clearTimeout(entry.livenessReprobeTimer)
    entry.livenessReprobeTimer = null
  }
}

// Probe a live-in-use secondary instead of blind-closing it on a forced wake,
// and close it only when the probe proves it not alive. A half-open TCP
// connection (sleep/wake, silent network drop) reports connectionState
// 'open' forever and fires no close event, so without this close an in-flight
// request rides a dead transport until its per-call timeout — prompt.submit's
// is 30 minutes. Closing arms the entry's ordinary reconnect backoff via its
// onState('closed') handler; a healthy-but-busy backend answers the ping and
// keeps its socket (#94769 review).
function probeSecondaryLiveness(entry: Secondary): void {
  void entry.gateway.request('ping', {}, LIVENESS_PROBE_TIMEOUT_MS).then(
    () => {
      entry.livenessProbeFailures = 0
      clearSecondaryLivenessReprobe(entry)
    },
    (error: unknown) => {
      // -32601 (method not found) = a version-skewed but HEALTHY backend that
      // predates the ping method — the same compatibility carve-out the
      // primary's probe makes in use-gateway-boot.
      if (isMissingRpcMethod(error)) {
        entry.livenessProbeFailures = 0
        clearSecondaryLivenessReprobe(entry)

        return
      }

      // The entry may have been pruned or redialed while the probe was
      // pending; only the very same socket may be torn down.
      if (g.secondaries.get(entry.scope) !== entry || !isOpen(entry.gateway)) {
        return
      }

      // ONE missed ping is not proof of death: a live backend mid tool call
      // can starve its event loop past the probe budget, and force-closing it
      // feeds the backend's ws_orphan_reap, interrupting the valid turn
      // (#94769 review). Apply the SAME streak policy as the primary's probe
      // (decideLivenessForceClose): defer the first failure while work is
      // in flight behind a bounded re-probe, close only when the streak is
      // exhausted — or immediately when nothing is in flight to protect.
      entry.livenessProbeFailures += 1

      // Counted RPCs alone under-report in-flight work: prompt.submit returns
      // before the turn ends, so a foreground turn mid tool call shows
      // activeRequests 0. The registry's live-scope hook supplies the turn.
      const liveScopes = g.config?.liveScopes?.()

      const turnInFlight =
        liveScopes && (liveScopes.has(entry.scope) || (!entry.connectionId && liveScopes.has(entry.profile))) ? 1 : 0

      const decision = decideLivenessForceClose({
        workingSessionCount: entry.activeRequests + turnInFlight,
        consecutiveFailures: entry.livenessProbeFailures
      })

      if (!decision.close) {
        if (entry.livenessReprobeTimer === null) {
          entry.livenessReprobeTimer = setTimeout(() => {
            entry.livenessReprobeTimer = null

            // The entry may have been pruned or redialed while the re-probe
            // waited; only the same open socket may be probed again.
            if (g.secondaries.get(entry.scope) !== entry || !isOpen(entry.gateway)) {
              return
            }

            probeSecondaryLiveness(entry)
          }, LIVENESS_REPROBE_DELAY_MS)
        }

        return
      }

      entry.livenessProbeFailures = 0
      clearSecondaryLivenessReprobe(entry)
      entry.gateway.close()
    }
  )
}

// Recovery signal: nudge every live secondary back open. Power-resume/network
// signals can force sockets that still report open to retire before redialing.
export function reconnectSecondaryGateways({ forceOpenSockets = false }: { forceOpenSockets?: boolean } = {}): void {
  for (const entry of g.secondaries.values()) {
    // A backend main retired for a foreground open stays parked: redialing it
    // from a focus/wake nudge would queue a background spawn for the slot the
    // retirement just freed. Its tile still shows; the next click re-arms it.
    if (entry.retiredByPool || g.reauthFailures.has(entry.scope)) {
      continue
    }

    // A parked entry (stall budget spent) is still pinned by its surface, or
    // the pruner would have removed it. This nudge is an explicit recovery
    // signal (online / focus / wake), so it re-arms with a fresh budget.
    rearmSecondary(entry)

    if (isOpen(entry.gateway)) {
      if (!forceOpenSockets) {
        continue
      }

      // A forced wake (power resume / network online) used to close EVERY open
      // secondary socket before redialing. Closing one that is mid-use detaches
      // its runtime → the backend orphan-reaps it → `session.reclaimed` → the
      // surface re-resumes on a fresh socket the same signal may close again:
      // the #94769 flicker loop. But a live socket also cannot simply be
      // SKIPPED: a half-open socket never fires a close event, so an in-flight
      // request would hang until its per-call timeout. Probe liveness instead —
      // a healthy-but-busy backend answers and keeps its socket; a dead
      // transport is closed and healed by the ordinary reconnect backoff.
      if (entry.activeRequests > 0 || relayRetained(entry) || foregroundPinned(entry)) {
        probeSecondaryLiveness(entry)

        continue
      }

      entry.gateway.close()
    }

    entry.reconnectAttempt = 0
    clearTimer(entry)
    void reconnectSecondary(entry)
  }
}

// How many non-primary backends currently hold an open socket. Hover-intent
// prewarming consults this before spawning: a speculative spawn that pushes
// the pool past its cap causes the Electron main to LRU-evict a warm backend
// — often one the user is about to click — turning the prewarm into churn
// (the #91545 evict/respawn cascade). The active gateway's backend is
// primary-routed and never counts toward the pool cap.
export function openSecondaryCount(): number {
  let count = 0

  for (const entry of g.secondaries.values()) {
    if (isOpen(entry.gateway)) {
      count += 1
    }
  }

  return count
}

// Keep the idle reaper from killing a backend we still need: ping every live
// secondary. The active one is pinged separately (touchActiveGatewayBackend).
// "Live" means the socket is OPEN: a wantOpen entry stuck in its reconnect
// backoff has no consumer on that backend, and pinging it anyway kept a
// tile-pinned backend keepalive-fresh forever, so LRU eviction and the idle
// reaper never freed its pool slot (#103375). Each ping also carries whether a
// prompt turn leases the scope, so a foreground dial that must retire a
// resident can skip leased ones early (the backend probe stays the proof).
export function touchSecondaryGateways(): void {
  const desktop = window.hermesDesktop

  for (const entry of g.secondaries.values()) {
    if (entry.wantOpen && isOpen(entry.gateway)) {
      void desktop?.touchBackend?.(entry.scope, { activeTurn: scopeHasTurnLease(entry.scope) }).catch(() => undefined)
    }
  }
}

// A local child is pooled under the bare profile (legacy route) or
// `conn:local::<profile>`; both renderer scopes ride the same child, so a
// retirement of either key parks both.
function secondaryRidesPoolKey(entry: Secondary, poolKey: string): boolean {
  if (entry.scope === poolKey) {
    return true
  }

  const local = !entry.connectionId || entry.connectionId === 'local'
  const profile = normKey(entry.profile)

  return local && (profile === poolKey || `conn:local::${profile}` === poolKey)
}

// Main is retiring the pooled backend under `poolKey` for a foreground open
// (electron/pool-retire.ts). Park every scope riding it BEFORE the socket
// drops: the 'closed' state must not scheduleReconnect, and the focus/wake
// nudge must not re-arm it either — both would queue a background redial for
// the slot the retirement freed. The entry stays (bot tiles keep their card);
// the next explicit open of the scope re-arms it. Returns the parked scopes.
export function parkSecondariesForRetiredBackend(poolKey: string): string[] {
  const key = String(poolKey || '').trim()
  const parked: string[] = []

  if (!key) {
    return parked
  }

  for (const entry of g.secondaries.values()) {
    if (!secondaryRidesPoolKey(entry, key)) {
      continue
    }

    entry.wantOpen = false
    entry.retiredByPool = true
    entry.stalledDials = 0
    clearTimer(entry)
    parked.push(entry.scope)
  }

  return parked
}

// Tear a secondary down: stop its reconnect loop, detach listeners, close the
// socket. Caller handles removal from the map.
export function disposeSecondary(entry: Secondary): void {
  entry.wantOpen = false
  clearTimer(entry)
  clearSecondaryLivenessReprobe(entry)
  entry.offEvent()
  entry.offRequest()
  entry.offState()
  entry.gateway.close()
}

// Invariant restore for every eviction path: if the active key names a
// secondary that no longer exists, fall back to the primary EXPLICITLY (atoms
// and composer state follow) instead of leaving a dangling key that
// activeGateway() can no longer resolve. Without this, a soft gateway switch
// (closeSecondaryGateways in use-gateway-boot) left activeKey pointing at an
// evicted registry scope and every call silently hit the primary backend.
export function restoreActiveToPrimaryIfEvicted(): void {
  if (
    g.activeKey !== g.primaryProfile &&
    !g.secondaries.has(g.activeKey) &&
    // A redial evicts the entry and re-activates the same scope moments later; taking the
    // activation in between cancels it through the epoch. The redial's own finally always clears
    // this, so a failed redial still falls back to the primary.
    !reactivatingScopes().has(g.activeKey)
  ) {
    setActive(g.primaryProfile)
  }
}

// Self-accept so editing this module is an in-place hot update — the live
// sockets in the registry container survive the swap. Dev-only.
if (import.meta.hot) {
  import.meta.hot.accept()
}
