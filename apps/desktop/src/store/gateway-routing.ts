import { registryBackendScopeKey } from '@hermes/shared'

import type { HermesGateway } from '@/hermes'
import { traceIdentityChange } from '@/lib/identity-trace'
import { RECONNECT_ATTEMPT_TIMEOUT_MS, SOURCE_SWITCH_DIAL_TIMEOUT_MS, withTimeout } from '@/lib/with-timeout'

import {
  activeGatewayConnectionId,
  applyActive,
  beginGatewayActivation,
  dialPriority,
  dialProfile,
  g,
  gatewayActivationEpoch,
  isOpen,
  isPrimaryRegistryRoute,
  normKey,
  openedSecondaryScopes,
  publishActiveConnection,
  reactivatingScopes,
  type Secondary,
  setActive,
  type SpawnPriority
} from './gateway-registry'
import {
  backgroundDialCoolingDown,
  cancelTurnLeaseRelease,
  clearTimer,
  createSecondary,
  disposeSecondary,
  foregroundPinned,
  openSecondary,
  openSecondaryForRequest,
  publishTurnLease,
  rearmSecondary,
  reconnectSecondary,
  relayRetained,
  releaseTurnLeasesForScope,
  restoreActiveToPrimaryIfEvicted,
  scheduleReconnect,
  scopeHasTurnLease,
  SECONDARY_MIN_LIFETIME_MS,
  turnLeaseKey
} from './gateway-secondary'

function traceAgentRoute(scope: string, via: string): void {
  traceIdentityChange('gateway-route', scope, `via=${via} primary=${g.primaryConnectionId ?? '-'}/${g.primaryProfile}`)
}

/** True when `connectionId` is the window's already-attached source AND main
 *  says `profile` rides the backend that source's primary socket is already
 *  connected to — a one-host-many-profiles remote (`sharedRemote`, #96493) or
 *  the one local host backend that serves every local profile under
 *  multiplex-only (`sharedPrimary`, #118246). Either way a registry secondary
 *  would be a SECOND WebSocket to the SAME process: on a remote it accept/closes
 *  in ~30ms and never runs `session.create`; on the local host backend it joins
 *  the chat's transport fan-out and the renderer receives every event twice
 *  (garbled streaming text + a duplicate interim bubble, #120005). Isolated
 *  SSH/pooled backends (neither flag) still get their own secondary. */
async function ridesPrimaryBackend(
  connectionId: null | string,
  profile: string,
  spawnPriority: SpawnPriority = 'background'
): Promise<boolean> {
  const id = String(connectionId ?? '').trim()
  const key = normKey(profile)
  const parked = g.secondaries.get(registryBackendScopeKey(connectionId, key))

  if (parked?.retiredByPool) {
    rearmSecondary(parked, spawnPriority)
  }

  if (!id || !g.primaryConnectionId || id !== g.primaryConnectionId) {
    return false
  }

  if (isPrimaryRegistryRoute(id, key)) {
    return false
  }

  const desktop = window.hermesDesktop

  if (!desktop?.getConnectionFor) {
    return false
  }

  // Resolved per call, never cached: main answers the route per request
  // (`resolveProfileBackendRoute` case 6 keeps a pooled backend for
  // `HERMES_DESKTOP_ISOLATED_BACKEND=1`), and for a pooled profile this is the
  // same dial `openSecondary` makes next, coalesced by main's claim key.
  try {
    const conn = await withTimeout(
      desktop.getConnectionFor({ connectionId: id, profile: key, ...dialPriority(spawnPriority) }),
      RECONNECT_ATTEMPT_TIMEOUT_MS,
      `Timed out resolving the backend route for "${key}"`
    )

    const flags =
      conn && typeof conn === 'object' ? (conn as { sharedPrimary?: boolean; sharedRemote?: boolean }) : null

    return flags?.sharedRemote === true || flags?.sharedPrimary === true
  } catch {
    // Probe failed on a remote (or not-yet-classified) primary: a secondary at
    // this already-attached source is the #96493 ghost WebSocket (accept/close,
    // messages=1), so prefer the primary until a later probe can prove
    // isolation (`sharedRemote: false`). A LOCAL primary must NOT get that
    // fallback: when main routes the profile to a pooled child (isolated
    // backend), the primary would still ACCEPT a `profile`-tagged
    // session.create (profile_home multiplexing) and mint the session under
    // its own pid, but the exact-owner route names the pool backend — after a
    // renderer reload or a pool respawn the resume dials that backend and is
    // refused SESSION_NOT_OWNED by a pid of the same Desktop (#101416).
    return g.primaryConnectionMode !== 'local'
  }
}

async function requestOnPrimaryGateway<T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
  signal?: AbortSignal
): Promise<T> {
  const gateway = g.primaryGateway

  if (!gateway || !isOpen(gateway)) {
    throw new Error('Hermes gateway unavailable')
  }

  return timeoutMs === undefined && signal === undefined
    ? gateway.request<T>(method, params)
    : gateway.request<T>(method, params, timeoutMs, signal)
}

// True when `profile`'s backend route resolves to the SHARED primary backend
// (global-remote case 3 in resolveProfileBackendRoute). Both shared-primary and
// pooled descriptors carry `profile` so WebSocket URL minting targets the right
// profile. `sharedPrimary` is the explicit discriminator; treating every tagged
// descriptor as shared strands local/own-remote pooled profiles on the default
// socket. Dialing a second socket at the shared descriptor is wrong — over SSH
// the second dial fails (tunnel/token are per-backend) and the closed socket
// poisons the active gateway with "not connected" even though the primary is
// open right next to it.
async function sharedPrimaryRoute(profile: string, spawnPriority: SpawnPriority = 'background'): Promise<boolean> {
  const desktop = window.hermesDesktop

  if (!desktop) {
    return false
  }

  try {
    // Unbounded IPC round-trip into main (#93454) — a wedge here must reject
    // like any other failure, not hang the route decision forever, since
    // every caller (gatewayForProfile → requestGatewayForProfile/Agent) awaits
    // this before it can fall back to dialing a secondary.
    // This is the FIRST dial main sees for a user open, so it must already
    // carry the foreground priority — otherwise the spawn it starts queues as
    // background and the click waits out this probe before being promoted.
    const conn = await withTimeout(
      dialProfile(desktop, profile, spawnPriority),
      RECONNECT_ATTEMPT_TIMEOUT_MS,
      `Timed out resolving the shared-primary route for profile "${profile}"`
    )

    return Boolean(conn && typeof conn === 'object' && (conn as { sharedPrimary?: boolean }).sharedPrimary === true)
  } catch {
    return false
  }
}

// Resolve and open `profile`'s socket WITHOUT changing the active gateway.
// Shared global-remote profiles intentionally return the primary socket plus a
// request-scope flag; dedicated local/remote profiles use their pooled socket.
async function gatewayForProfile(
  profile: string,
  leaseRequest = false,
  spawnPriority: SpawnPriority = 'background'
): Promise<{ gateway: HermesGateway | null; key: string; release: () => void; scopeProfile: boolean }> {
  const key = normKey(profile)
  const noRelease = () => undefined
  const parked = g.secondaries.get(key)

  if (parked?.retiredByPool) {
    rearmSecondary(parked, spawnPriority)
  }

  if (key === g.primaryProfile) {
    return { gateway: g.primaryGateway, key, release: noRelease, scopeProfile: false }
  }

  // sharedPrimaryRoute is itself a dial into main (it can start the profile's spawn), so a
  // cooling-down scope has to be held back before it, not just before openSecondary.
  const existing = g.secondaries.get(key)

  if (spawnPriority !== 'foreground' && !(existing && isOpen(existing.gateway)) && backgroundDialCoolingDown(key)) {
    throw new Error(`Backend for "${key}" is reconnecting; retry after it settles.`)
  }

  if (await sharedPrimaryRoute(key, spawnPriority)) {
    return { gateway: g.primaryGateway, key, release: noRelease, scopeProfile: true }
  }

  const entry = g.secondaries.get(key) ?? createSecondary(key)

  // Existing dev-HMR entries predate the request lease/ownership fields.
  if (!Number.isFinite(entry.activeRequests)) {
    entry.activeRequests = 0
  }

  if (typeof entry.retained !== 'boolean') {
    entry.retained = true
  }

  if (!leaseRequest) {
    entry.retained = true
  }

  rearmSecondary(entry, spawnPriority)

  if (leaseRequest) {
    entry.activeRequests += 1
  }

  let released = false

  const release = () => {
    if (!released && leaseRequest) {
      released = true
      entry.activeRequests = Math.max(0, entry.activeRequests - 1)

      if (
        entry.activeRequests === 0 &&
        !entry.retained &&
        !relayRetained(entry) &&
        !foregroundPinned(entry) &&
        g.activeKey !== entry.scope
      ) {
        disposeSecondary(entry)

        if (g.secondaries.get(entry.scope) === entry) {
          g.secondaries.delete(entry.scope)
        }
      }
    }
  }

  try {
    await openSecondaryForRequest(entry, spawnPriority)
  } catch (error) {
    release()
    throw error
  }

  return { gateway: entry.gateway, key, release, scopeProfile: false }
}

/**
 * Send a gateway RPC through a named Desktop profile without foregrounding it.
 * Global-remote routes share the primary socket and need an explicit profile
 * param; dedicated pooled backends are already scoped by their descriptor.
 */
export async function requestGatewayForProfile<T>(
  profile: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
  signal?: AbortSignal,
  { spawnPriority = 'background' }: { spawnPriority?: SpawnPriority } = {}
): Promise<T> {
  // A user-initiated Settings-scoped RPC (the Vault tab's "Applies to" pick)
  // dials `foreground` so a cold profile spawn is not queued behind background
  // work (#111651); ambient callers keep the background default.
  const route = await gatewayForProfile(profile, true, spawnPriority)

  try {
    if (!route.gateway) {
      throw new Error(`Hermes gateway unavailable for profile "${route.key}"`)
    }

    const routedParams = route.scopeProfile ? { ...params, profile: route.key } : params

    // Same arity contract as the ambient path in session-request-router: only
    // pass the deadline args through when the caller set them, so a plain
    // profile-routed RPC keeps its two-argument call shape.
    const result = await (timeoutMs === undefined && signal === undefined
      ? route.gateway.request<T>(method, routedParams)
      : route.gateway.request<T>(method, routedParams, timeoutMs, signal))

    // A served RPC proves the backend answers, not just accepts, so it clears the dial history.
    // Lease requests dispose their entry right after, before a close could prove the socket stable.
    g.dialFailures.delete(route.key)

    return result
  } finally {
    route.release()
  }
}

/**
 * Send a gateway RPC through one registry source without activating it. The
 * composite (connectionId, profile) pool key prevents same-named agents on two
 * sources from sharing a socket. Only null/empty ids retain the v1 profile
 * resolver; explicit `local` is a registry source and must use getConnectionFor.
 *
 * `spawnPriority` defaults to 'background' like every other dial in this file.
 * A user gesture that reaches the pool through this RPC path (first send on a
 * fresh chat, "New session", an explicit Bot Chat open) passes 'foreground' so
 * its cold spawn takes the pool's reserved interactive slot instead of queuing
 * behind roster hydration (#102281 primitive; #105104 symptom).
 */
export async function requestGatewayForAgent<T>(
  connectionId: null | string,
  profile: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
  signal?: AbortSignal,
  { spawnPriority = 'background' }: { spawnPriority?: SpawnPriority } = {}
): Promise<T> {
  const key = normKey(profile)
  const scope = registryBackendScopeKey(connectionId, key)

  if (scope === key) {
    return requestGatewayForProfile<T>(key, method, params, timeoutMs, signal, { spawnPriority })
  }

  // A primary remote selected from the connection registry carries its source
  // id in the active connection descriptor. Requests for that exact
  // (connection, profile) already have an owning socket: the window primary.
  // Dialing a registry secondary here can resolve the same public endpoint to a
  // different backend/profile route, so durable session.resume reports
  // "session not found" while REST history from the primary remains visible.
  // Require both owner identities to agree before collapsing the route; a
  // different source or profile must retain its isolated secondary.
  if (isPrimaryRegistryRoute(connectionId, key)) {
    traceAgentRoute(scope, 'primary')

    return requestGatewayForProfile<T>(key, method, params, timeoutMs, signal, { spawnPriority })
  }

  if (await ridesPrimaryBackend(connectionId, key, spawnPriority)) {
    traceAgentRoute(scope, 'primary-shared')

    return requestOnPrimaryGateway<T>(method, { ...params, profile: key }, timeoutMs, signal)
  }

  traceAgentRoute(scope, 'secondary')

  if (!window.hermesDesktop?.getConnectionFor) {
    throw new Error('This Desktop build cannot dial registry connections. Update Hermes Desktop.')
  }

  const entry = g.secondaries.get(scope) ?? createSecondary(key, connectionId)

  // Existing dev-HMR entries predate request leases/ownership.
  if (!Number.isFinite(entry.activeRequests)) {
    entry.activeRequests = 0
  }

  if (typeof entry.retained !== 'boolean') {
    entry.retained = true
  }

  rearmSecondary(entry, spawnPriority)
  entry.activeRequests += 1

  try {
    await openSecondaryForRequest(entry, spawnPriority)

    const result = await (timeoutMs === undefined && signal === undefined
      ? entry.gateway.request<T>(method, params)
      : entry.gateway.request<T>(method, params, timeoutMs, signal))

    g.dialFailures.delete(entry.scope)

    return result
  } finally {
    entry.activeRequests = Math.max(0, entry.activeRequests - 1)

    if (
      !drainPendingConnectionRedial(entry) &&
      entry.activeRequests === 0 &&
      !entry.retained &&
      !relayRetained(entry) &&
      !foregroundPinned(entry) &&
      g.activeKey !== entry.scope
    ) {
      disposeSecondary(entry)

      if (g.secondaries.get(entry.scope) === entry) {
        g.secondaries.delete(entry.scope)
      }
    }
  }
}

/**
 * Finish a material-edit redial once no request, relay, or foreground surface
 * still owns the old socket. Removal deliberately bypasses this drain: a
 * deleted source can never become valid again and must fail-stop immediately.
 */
function drainPendingConnectionRedial(entry: Secondary): boolean {
  if (
    entry.pendingConnectionRedial !== true ||
    entry.activeRequests > 0 ||
    relayRetained(entry) ||
    foregroundPinned(entry) ||
    g.secondaries.get(entry.scope) !== entry
  ) {
    return false
  }

  entry.pendingConnectionRedial = false
  const wasActive = g.activeKey === entry.scope
  disposeSecondary(entry)
  g.secondaries.delete(entry.scope)
  reopenAfterRedial(entry, wasActive)

  return true
}

// Re-open a redialed scope after its entry left the map. An active scope's
// re-activation is asynchronous, and until it lands
// restoreActiveToPrimaryIfEvicted sees an active scope with no entry, calls
// setActive(primary) and bumps the activation epoch — which turns this redial's
// own applyActive(epoch) into a no-op. The window would then sit on the primary
// backend with the redial silently discarded, after nothing more than an edit
// to the connection being viewed. Mark the scope for the pruner while the
// re-activation is in flight; the finally clears it on both outcomes so a
// redial that never lands still falls back.
function reopenAfterRedial(entry: Secondary, wasActive: boolean): void {
  if (!wasActive) {
    void openGatewayForAgent(entry.connectionId, entry.profile).catch(() => undefined)

    return
  }

  reactivatingScopes().add(entry.scope)
  void ensureGatewayForAgent(entry.connectionId, entry.profile)
    .catch(() => undefined)
    .finally(() => {
      reactivatingScopes().delete(entry.scope)
    })
}

/**
 * Pin the pooled socket for one relay route open across drain ticks. Returns
 * a once-only release. Local routes (null/empty or explicit `local` source)
 * are deliberately EXEMPT and get a no-op release: their Electron-spawned
 * backend answers to the idle reaper, and a relay pin would keep the
 * touch-loop pinging it forever, resurrecting backends the reaper is meant to
 * reclaim (see the retireLocalProfileGateways note). Local relay traffic is
 * either the primary socket (no churn) or a short-lived local dial — never
 * the remote reconnect flood this retention exists to stop.
 */
export function retainGatewayForRelay(connectionId: null | string, profile: string): () => void {
  const key = normKey(profile)
  const connection = String(connectionId ?? '').trim()

  if (!connection || connection === 'local') {
    return () => undefined
  }

  const scope = registryBackendScopeKey(connection, key)
  const entry = g.secondaries.get(scope) ?? createSecondary(key, connection)

  if (!Number.isFinite(entry.relayRetainCount)) {
    entry.relayRetainCount = 0
  }

  entry.relayRetainCount += 1

  if (!g.reauthFailures.has(entry.scope)) {
    rearmSecondary(entry)
  }

  let released = false

  return () => {
    if (released) {
      return
    }

    released = true
    entry.relayRetainCount = Math.max(0, (entry.relayRetainCount || 0) - 1)

    if (
      !drainPendingConnectionRedial(entry) &&
      entry.relayRetainCount === 0 &&
      entry.activeRequests === 0 &&
      !entry.retained &&
      !foregroundPinned(entry) &&
      g.activeKey !== entry.scope &&
      g.secondaries.get(entry.scope) === entry
    ) {
      disposeSecondary(entry)
      g.secondaries.delete(entry.scope)
    }
  }
}

/**
 * Hold `profile`'s socket open across a multi-RPC sequence without activating
 * it (#93602). Every requestGatewayForProfile/requestGatewayForAgent call is a
 * per-request lease: at refcount 0 a non-retained secondary is disposed, so a
 * session-scoped sequence (session.create → attach → prompt.submit) minted a
 * runtime id on a socket that closed between calls — the gateway detached the
 * session on WS disconnect and the next RPC hit 4001 "not in memory". Callers
 * acquire this lease before the first session-scoped RPC and release it in a
 * `finally`; the refcount keeps the socket (and the session it minted) alive
 * for the whole sequence. Primary/shared-primary routes return a no-op release.
 *
 * `spawnPriority` follows requestGatewayForAgent: the retain is the FIRST dial
 * of a session-create gesture, so a user click passes 'foreground' here or the
 * cold spawn still queues behind background hydration before the create RPC.
 */
export async function retainGatewayForAgent(
  connectionId: null | string,
  profile: string,
  { spawnPriority = 'background' }: { spawnPriority?: SpawnPriority } = {}
): Promise<() => void> {
  const key = normKey(profile)
  const scope = registryBackendScopeKey(connectionId, key)

  if (scope === key) {
    // Plain-profile route: gatewayForProfile's request lease IS the retain —
    // hold it until the caller releases.
    const route = await gatewayForProfile(key, true, spawnPriority)

    return route.release
  }

  if (isPrimaryRegistryRoute(connectionId, key) || (await ridesPrimaryBackend(connectionId, key, spawnPriority))) {
    // Primary socket stays open for the window lifetime — no secondary to hold.
    return () => undefined
  }

  if (!window.hermesDesktop?.getConnectionFor) {
    // No registry dialing in this build — nothing to hold; the request path
    // will throw its own actionable error.
    return () => undefined
  }

  const entry = g.secondaries.get(scope) ?? createSecondary(key, connectionId)

  // Existing dev-HMR entries predate request leases/ownership.
  if (!Number.isFinite(entry.activeRequests)) {
    entry.activeRequests = 0
  }

  if (typeof entry.retained !== 'boolean') {
    entry.retained = true
  }

  rearmSecondary(entry, spawnPriority)
  entry.activeRequests += 1

  let released = false

  const release = () => {
    if (released) {
      return
    }

    released = true
    entry.activeRequests = Math.max(0, entry.activeRequests - 1)

    if (drainPendingConnectionRedial(entry)) {
      return
    }

    if (
      entry.activeRequests === 0 &&
      !entry.retained &&
      !relayRetained(entry) &&
      !foregroundPinned(entry) &&
      g.activeKey !== entry.scope
    ) {
      disposeSecondary(entry)

      if (g.secondaries.get(entry.scope) === entry) {
        g.secondaries.delete(entry.scope)
      }
    }
  }

  try {
    if (!isOpen(entry.gateway)) {
      await openSecondary(entry, spawnPriority)
    }
  } catch (error) {
    release()
    throw error
  }

  return release
}

/**
 * Keep a routed Desktop prompt's socket alive after prompt.submit ACKs.
 *
 * Routed requests normally own a per-request lease. prompt.submit ACKs as soon
 * as the background turn starts, so releasing that lease at RPC completion
 * detaches the runtime session while the model is still working; the gateway's
 * 20-second orphan guard then interrupts it as `client_gone`. Hold one lease per
 * (route, runtime session) until message.complete/session.info settles the turn.
 */
export async function retainGatewayForSessionTurn(
  connectionId: null | string,
  profile: string,
  sessionId: string
): Promise<() => void> {
  // Primary events do not flow through a Secondary's terminal-event listener.
  // Registering a no-op lease here would leave a phantom key that can suppress
  // the real hold if this route is later re-homed as a secondary.
  if (isPrimaryRegistryRoute(connectionId, normKey(profile))) {
    return () => undefined
  }

  const scope = registryBackendScopeKey(connectionId, normKey(profile))
  const key = turnLeaseKey(scope, sessionId)

  cancelTurnLeaseRelease(key)

  // A busy-session redirect/queue can submit again while the original turn is
  // still retained. The existing lease owns that turn; the extra submit must
  // not replace or release it. The no-op means "another caller owns the
  // shared lease", not "this caller acquired a separately releasable lease".
  if (g.turnLeases.has(key)) {
    return () => undefined
  }

  const releaseRoute = await retainGatewayForAgent(connectionId, profile)

  // Only a Secondary's own terminal-event listener releases this lease, so a route with no
  // Secondary can never release one: retainGatewayForAgent and gatewayForProfile both hand back a
  // no-op exactly when the route rides the primary socket (shared-remote collapse, shared-primary
  // route, or a build without registry dialing), and none of those creates an entry. Storing the
  // key there leaves the same phantom the primary-profile guard above avoids, and it would suppress
  // the real hold once that route IS dialed as a secondary — which the shared-remote probe
  // explicitly expects ("prefer the primary until a later probe can prove isolation"). Decide by
  // outcome rather than re-probing every no-op case.
  if (!g.secondaries.has(scope)) {
    releaseRoute()

    return () => undefined
  }

  // Re-check after the await: the guard above the retain ran before it, so a second submit for the
  // same (route, session) can arrive while this one suspends and both pass it. Only the release
  // stored in the map is ever invoked — releaseTerminalTurnLease does `g.turnLeases.get(key)?.()` —
  // so the loser's hold would never be released and the socket could never be reclaimed.
  if (g.turnLeases.has(key)) {
    releaseRoute()

    return () => undefined
  }

  let released = false

  const release = () => {
    if (released) {
      return
    }

    released = true

    if (g.turnLeases.get(key) === release) {
      g.turnLeases.delete(key)
    }

    cancelTurnLeaseRelease(key)
    // Another session on the same scope may still hold a lease; report the
    // scope's state, not this lease's.
    publishTurnLease(scope, scopeHasTurnLease(scope))
    releaseRoute()
  }

  g.turnLeases.set(key, release)
  publishTurnLease(scope, true)

  return release
}

// How long a mid-dial activation holds its prune lease: it must outlast every
// dial the renderer still treats as in flight, or the pruner reaps the switch
// target mid-dial and the click resolves on a socket that is already closed
// (#89622's mechanism, one budget change later). The activation dials now carry
// SOURCE_SWITCH_DIAL_TIMEOUT_MS — the whole remote bring-up chain (ssh connect,
// the platform/locate/version probes, the remote spawn's ready sentinel, the
// forward) — so this is DERIVED from it rather than picked independently: at
// the old 30 s literal, raising the dial budget to 135 s left the switch target
// prunable for the last ~105 s of a *healthy* dial. The margin covers the
// settle that releases the lease (the renderer's switch commit). Bounded on
// purpose: a leaked lease still expires on its own and the reaper reclaims the
// entry.
const ACTIVATION_LEASE_MS = SOURCE_SWITCH_DIAL_TIMEOUT_MS + 15_000

// Open `profile`'s socket WITHOUT making it active — the hover-intent pre-warm
// (store/profile). Runs the same spawn + connect chain as a real switch, so by
// click time ensureGatewayForProfile finds an open socket and just activates
// it. No scheduleReconnect on failure: a hover is speculative, so a dead
// backend must not start a background retry loop — the real switch owns retry
// and error UX. An already-open (or primary) profile is a no-op.
export async function openGatewayForProfile(
  profile: string,
  { spawnPriority = 'background' }: { spawnPriority?: SpawnPriority } = {}
): Promise<void> {
  await gatewayForProfile(profile, false, spawnPriority)
}

// ── Connection-scoped agents (multi-source roster) ─────────────────────────
// The (connectionId, profile) analogues of the profile functions above. A
// null connectionId falls straight through to the profile path. An explicit
// `local` id remains registry-scoped so it cannot inherit legacy remote v1
// routing. Feature-detected: without the Electron getConnectionFor door these
// throw, and roster surfaces disable non-local rows instead.

// `activationLease`: hold the same prune lease ensureGatewayForAgent holds for
// the whole dial. Phase one of the two-phase source switch (store/connections
// selectConnection) opens the target here and activates it right after; without
// the lease a live-work recompute during the cold spawn would dispose the entry
// mid-dial and the click would die (#89622). Plain pre-warms stay prunable —
// a hovered-but-never-activated socket must not be pinned off another source's
// live work.
export async function openGatewayForAgent(
  connectionId: null | string,
  profile: string,
  {
    activationLease = false,
    spawnPriority = 'background'
  }: { activationLease?: boolean; spawnPriority?: SpawnPriority } = {}
): Promise<void> {
  const scope = registryBackendScopeKey(connectionId, profile)

  if (scope === normKey(profile) || isPrimaryRegistryRoute(connectionId, profile)) {
    return openGatewayForProfile(profile, { spawnPriority })
  }

  if (await ridesPrimaryBackend(connectionId, profile, spawnPriority)) {
    if (!isOpen(g.primaryGateway)) {
      throw new Error('Hermes gateway unavailable')
    }

    return
  }

  if (!window.hermesDesktop?.getConnectionFor) {
    throw new Error('This Desktop build cannot dial registry connections. Update Hermes Desktop.')
  }

  const entry = g.secondaries.get(scope) ?? createSecondary(profile, connectionId)
  entry.retained = true
  rearmSecondary(entry, spawnPriority)

  if (activationLease) {
    // Stays held after a successful open: the activation that follows releases
    // it (applyActive path), and one that never comes lets it expire.
    entry.activationLeaseUntil = Date.now() + ACTIVATION_LEASE_MS
  }

  if (isOpen(entry.gateway)) {
    return
  }

  try {
    await openSecondary(entry, spawnPriority)
  } catch (error) {
    if (activationLease) {
      entry.activationLeaseUntil = 0
    }

    throw error
  }
}

export async function ensureGatewayForAgent(
  connectionId: null | string,
  profile: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<boolean> {
  const scope = registryBackendScopeKey(connectionId, profile)

  if (scope === normKey(profile) || isPrimaryRegistryRoute(connectionId, profile)) {
    if (signal?.aborted) {
      return false
    }

    await ensureGatewayForProfile(profile)

    return !signal?.aborted
  }

  const activationEpoch = beginGatewayActivation()

  if (await ridesPrimaryBackend(connectionId, profile, 'foreground')) {
    // A retained primary can be open while the foreground still points at a
    // different source. Reusing its socket must also move the active route.
    return Boolean(isOpen(g.primaryGateway) && !signal?.aborted && applyActive(g.primaryProfile, activationEpoch))
  }

  if (!window.hermesDesktop?.getConnectionFor) {
    throw new Error('This Desktop build cannot dial registry connections. Update Hermes Desktop.')
  }

  let entry = g.secondaries.get(scope)

  if (!entry) {
    entry = createSecondary(profile, connectionId)
  }

  entry.retained = true
  rearmSecondary(entry)
  // Lease the entry against the live-work pruner for the whole dial: the
  // switch target is not yet active and has no live sessions, so a prune
  // recompute firing mid-spawn would otherwise dispose it and this
  // activation would fail (#89622).
  entry.activationLeaseUntil = Date.now() + ACTIVATION_LEASE_MS

  if (!isOpen(entry.gateway)) {
    clearTimer(entry)
    entry.reconnectAttempt = 0

    try {
      await openSecondary(entry, 'foreground')
    } catch {
      scheduleReconnect(entry)
    }
  }

  // The activation is settling either way — release the prune lease.
  entry.activationLeaseUntil = 0

  // A timed-out owner may leave the dial running, but it no longer has the
  // right to move the foreground route when that work eventually settles.
  if (signal?.aborted) {
    return false
  }

  // A source edit/remove may dispose this entry while its dial is still in
  // flight. Only the still-registered, still-owned activation may publish --
  // and only when the WebSocket actually reached open: entry.connection is
  // set BEFORE the dial completes in openSecondary, so a transient first-dial
  // failure (caught above, left for scheduleReconnect) must not count as a
  // successful activation just because a connection descriptor exists
  // (issue #92265).
  const activated =
    entry.wantOpen &&
    g.secondaries.get(scope) === entry &&
    Boolean(entry.connection) &&
    isOpen(entry.gateway) &&
    applyActive(scope, activationEpoch)

  if (activated && entry.connection) {
    publishActiveConnection(entry.connection)
  }

  return activated
}

// Make `profile` the active gateway, lazily opening its socket if needed. The
// primary is a no-op fast path. Background sockets are never closed here.
export async function ensureGatewayForProfile(profile: string): Promise<void> {
  const key = normKey(profile)
  const activationEpoch = beginGatewayActivation()

  if (key === g.primaryProfile) {
    applyActive(key, activationEpoch)

    return
  }

  // Global-remote share (routing case 3): one remote host serves every
  // profile through the PRIMARY socket, scoped per request. Activate the
  // primary instead of dialing a doomed duplicate socket at the same
  // descriptor — $activeGatewayProfile still moves to `key`, so request
  // scoping and profile-aware surfaces behave identically.
  if (await sharedPrimaryRoute(key, 'foreground')) {
    applyActive(g.primaryProfile, activationEpoch)

    return
  }

  let entry = g.secondaries.get(key)

  if (!entry) {
    entry = createSecondary(key)
  }

  entry.retained = true
  rearmSecondary(entry)
  // Lease the entry against the live-work pruner for the whole dial — the
  // profile-door twin of the agent path's lease above (#89622).
  entry.activationLeaseUntil = Date.now() + ACTIVATION_LEASE_MS

  try {
    if (!isOpen(entry.gateway)) {
      clearTimer(entry)
      entry.reconnectAttempt = 0

      try {
        await openSecondary(entry, 'foreground')
      } catch (error) {
        // #81094: a failed secondary dial must NOT fall through to setActive()
        // with a closed socket — that silently routes the user's messages to the
        // primary backend (cross-profile session writes). Keep the reconnect
        // schedule (transient failures still self-heal via the backoff below)
        // but RE-THROW so the profile-door caller surfaces the failure and skips
        // the activation. The agent-door twin (ensureGatewayForAgent) keeps its
        // boolean contract and is guarded by the activeGateway() null invariant.
        scheduleReconnect(entry)
        throw error
      }
    }
  } finally {
    // The activation is settling either way — release the prune lease.
    entry.activationLeaseUntil = 0
  }

  // Only publish when the WebSocket actually reached open -- entry.connection
  // is set before the dial completes, so a transient first-dial failure must
  // not count as a successful activation (issue #92265).
  if (
    entry.wantOpen &&
    g.secondaries.get(key) === entry &&
    isOpen(entry.gateway) &&
    applyActive(key, activationEpoch) &&
    entry.connection
  ) {
    publishActiveConnection(entry.connection)
  }
}

// Reconnect the active gateway after a transient request failure. Primary
// reconnects are owned by use-gateway-boot, so we only drive secondaries here.
// A scope parked on a rejected session stays parked for automatic request
// retries; only a user gesture (`explicit`: the Reconnect action) may redial it.
export async function ensureActiveGatewayOpen({
  explicit = false
}: { explicit?: boolean } = {}): Promise<HermesGateway | null> {
  if (g.activeKey === g.primaryProfile) {
    return g.primaryGateway
  }

  const entry = g.secondaries.get(g.activeKey)

  if (!entry || (!explicit && g.reauthFailures.has(entry.scope))) {
    return null
  }

  if (!isOpen(entry.gateway)) {
    // The viewed scope is a recovery target: a stall-parked entry must dial
    // again here, not stay parked. A reauth-parked one only reaches this line
    // via `explicit`; the foreground rearm clears its rejection.
    rearmSecondary(entry)
    await reconnectSecondary(entry)
  }

  if (!isOpen(entry.gateway)) {
    // A remote/registry secondary can still be ACTIVATING (backend waking,
    // socket dialing). Failing instantly turned a routine cold start into
    // "Hermes gateway is not connected" on the Sessions `+` action (#88880).
    // Wait a bounded beat for the in-flight activation instead of erroring;
    // a genuinely dead gateway still returns null when the window closes.
    const deadline = Date.now() + ACTIVE_GATEWAY_OPEN_WAIT_MS

    while (Date.now() < deadline && entry.wantOpen && g.secondaries.get(g.activeKey) === entry) {
      if (isOpen(entry.gateway)) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  return isOpen(entry.gateway) ? entry.gateway : null
}

// How long ensureActiveGatewayOpen waits out an in-flight secondary
// activation before reporting the gateway as unavailable.
const ACTIVE_GATEWAY_OPEN_WAIT_MS = 8_000

// Close + evict secondaries whose scope is neither active nor in `keep`
// (scopes with a running / needs-input session). Bounds cost to live work.
// `keep` carries PROFILE names for local/legacy entries and composite
// registryBackendScopeKey(connectionId, profile) scopes for registry-sourced live
// work. A registry-scoped entry matches ONLY on its composite key: every
// source exposes a 'default' profile, so matching a non-local entry on the
// bare profile name kept gateway B's 'default' socket alive off gateway A's
// 'default' activity (and vice versa) — cross-connection attribution.
//
// Live work is not the only thing worth a socket: an idle tile still holds a
// resumed runtime on its owner's socket, and closing that socket makes the
// backend detach and orphan-reap the runtime, whose `session.reclaimed`
// unbinds the tile and re-resumes it on a fresh socket that the next
// recompute closes again — a spinner loop with no terminal state (#93892).
// Foreground-bound scopes come from the registry's `foregroundScopes` hook
// (foregroundPinned), not from `keep`, so every dispose path sees the same
// pin. `entry.retained` is deliberately NOT consulted here (see the field's
// doc).
export function pruneSecondaryGateways(keep: Set<string>): void {
  const now = Date.now()

  for (const [key, entry] of [...g.secondaries]) {
    if (drainPendingConnectionRedial(entry)) {
      continue
    }

    if (
      key === g.activeKey ||
      keep.has(key) ||
      (!entry.connectionId && keep.has(entry.profile)) ||
      // Bot-relay retention (#93594): the relay pins its remote routes for
      // its whole active lifetime; the live-work pruner must not undo that
      // pin between drain ticks or the socket churn returns.
      relayRetained(entry) ||
      // A mounted tile / the primary thread is bound to a runtime on this
      // socket (#93892) — pinned for as long as that surface is mounted.
      foregroundPinned(entry) ||
      // Mid-dial activation target: the profile being switched TO is not yet
      // active and has no live work, so without this lease any recompute
      // during its cold spawn disposed the entry and the click died silently
      // (#89622). Number guard: dev-HMR entries predate the field. Bounded:
      // an orphaned lease expires on its own.
      (Number.isFinite(entry.activationLeaseUntil) && entry.activationLeaseUntil > now)
    ) {
      continue
    }

    // Min-lifetime grace: an idle prune can race an on-demand dial (prune →
    // redial → prune) and dispose a socket that opened moments ago, before
    // its consumer registered in the keep-set — closing it detaches the
    // runtime, the backend orphan-reaps it, and the reclaimed surface
    // re-resumes on a fresh socket the next recompute closes again: the
    // #94769 flicker loop. A young socket rides one prune tick; the keepalive
    // tick recomputes the keep-set so an idle one is still reaped within a minute.
    if (now - entry.lastOpenedAt < SECONDARY_MIN_LIFETIME_MS) {
      continue
    }

    // The route is no longer live work. Release turn leases first so their
    // counted request holds cannot outlive a disposed route or leave a stale
    // release closure attached to a later same-key socket.
    releaseTurnLeasesForScope(key)

    if (g.secondaries.get(key) !== entry) {
      continue
    }

    if (entry.activeRequests > 0) {
      continue
    }

    disposeSecondary(entry)
    g.secondaries.delete(key)
  }

  restoreActiveToPrimaryIfEvicted()
}

function closeSecondariesWhere(shouldClose: (entry: Secondary) => boolean): void {
  for (const [scope, entry] of [...g.secondaries]) {
    if (!shouldClose(entry)) {
      continue
    }

    disposeSecondary(entry)
    g.secondaries.delete(scope)
  }

  restoreActiveToPrimaryIfEvicted()
}

function isLegacySecondary(entry: Secondary): boolean {
  // Every v2 registry route is created with an explicit connection id,
  // including the registry's `local` source. A missing id is reserved for the
  // old profile-only pool; the loose null check also retires HMR entries from
  // builds that predate the field instead of leaving an old legacy socket
  // behind during a mode apply.
  return entry.connectionId == null
}

/**
 * Close only profile sockets that follow the legacy v1 connection config.
 *
 * A global mode apply re-homes the primary backend, but registered connection
 * sockets are independent sources in the v2 registry. Closing every secondary
 * here would detach their sessions and arm `ws_orphan_reap` even though those
 * sources remain valid and reusable. Legacy profile sockets still need to be
 * retired because their endpoint is derived from the v1 config being changed.
 */
export function closeLegacySecondaryGateways(): void {
  for (const [scope, failure] of g.reauthFailures) {
    if (failure.connectionId === null) {
      g.reauthFailures.delete(scope)
    }
  }

  for (const [scope, failure] of g.dialFailures) {
    if (failure.connectionId === null) {
      g.dialFailures.delete(scope)
    }
  }

  closeSecondariesWhere(isLegacySecondary)
}

export function closeSecondaryGateways(): void {
  // Full teardown releases every routed-turn lease (class-2 #94284) and the
  // renderer-generation ledger; the predicate close leaves live sources'
  // leases alone (their sockets stay open).
  for (const timer of g.turnLeaseReleaseTimers.values()) {
    clearTimeout(timer)
  }

  g.turnLeaseReleaseTimers.clear()

  for (const release of [...g.turnLeases.values()]) {
    release()
  }

  g.turnLeases.clear()
  g.dialFailures.clear()

  closeSecondariesWhere(() => true)
  openedSecondaryScopes().clear()
  g.reauthFailures.clear()
}

// A local profile can have two renderer-owned sockets: the legacy bare
// profile scope and the explicit `local` registry scope. Profile deletion
// stops their Electron backend processes, but a retained Secondary otherwise
// sees that shutdown as a transient disconnect and starts its reconnect loop,
// resurrecting the backend that was just deleted. Retire both local scopes
// before the DELETE request while preserving same-named agents on remote,
// cloud, or SSH connections.
export function retireLocalProfileGateways(profile: string): void {
  const name = String(profile || '').trim()

  if (!name) {
    return
  }

  const key = normKey(name)
  const scopes = new Set([key, registryBackendScopeKey('local', key)])
  let activeInvalidated = false

  // A profile-only owner is a claim about the legacy local pool, not durable
  // session identity. Clear it with that pool before a delayed session action
  // can recreate the deleted/old-name backend. Exact remote owners are
  // descriptors and remain routable even when they share this profile name.
  g.config?.onLocalProfileRetired?.(key)

  for (const scope of scopes) {
    const entry = g.secondaries.get(scope)

    if (!entry) {
      continue
    }

    activeInvalidated ||= scope === g.activeKey
    disposeSecondary(entry)
    g.secondaries.delete(scope)
  }

  restoreActiveToPrimaryIfEvicted()

  if (activeInvalidated) {
    g.config?.onActiveConnectionInvalidated?.(g.primaryProfile, gatewayActivationEpoch())
  }
}

// Registry lifecycle: a connection was removed or materially edited. Removal
// disposes every scoped secondary immediately (a removed remote/cloud source
// has no local process to die, so otherwise its WebSocket streams ghost
// events). A material edit redials each profile through the normal open path so
// fresh sockets target the NEW endpoint, but request/relay leases and mounted
// foreground runtimes keep their old socket until they drain; the active scope
// re-activates when its replacement is safe to publish.
export function disposeSecondariesForConnection(connectionId: string, opts: { redial?: boolean } = {}): void {
  const id = String(connectionId || '').trim()
  let activeInvalidated = false

  if (!id) {
    return
  }

  for (const [scope, failure] of g.reauthFailures) {
    if (failure.connectionId === id) {
      g.reauthFailures.delete(scope)
    }
  }

  // Replacing a connection is a fresh start: its old failures must not hold back the new dial.
  for (const [scope, failure] of g.dialFailures) {
    if (failure.connectionId === id) {
      g.dialFailures.delete(scope)
    }
  }

  for (const [key, entry] of [...g.secondaries]) {
    if (entry.connectionId !== id) {
      continue
    }

    const wasActive = key === g.activeKey
    activeInvalidated ||= wasActive

    if (opts.redial && (entry.activeRequests > 0 || relayRetained(entry) || foregroundPinned(entry))) {
      entry.pendingConnectionRedial = true

      continue
    }

    disposeSecondary(entry)
    g.secondaries.delete(key)

    if (opts.redial) {
      reopenAfterRedial(entry, wasActive)
    }
  }

  if (activeInvalidated && !opts.redial) {
    setActive(g.primaryProfile)
    g.config?.onActiveConnectionInvalidated?.(g.primaryProfile, gatewayActivationEpoch())
  }
}

// Self-accept so editing this module is an in-place hot update — the live
// sockets in the registry container survive the swap. Dev-only.
if (import.meta.hot) {
  import.meta.hot.accept()
}
