/**
 * MULTI-PROFILE GATEWAY REGISTRY — facade over the domain siblings:
import {
  type ConnectionState,
  type GatewayEvent,
  isGatewayReauthRequired,
  isStableOpen,
  reconnectBackoffDelayMs,
  registryBackendScopeKey,
  resolveGatewayWsUrl,
  type ServerRequest
} from '@hermes/shared'
import { atom } from 'nanostores'

import type { HermesConnection } from '@/global'
import { HermesGateway, setApiRequestConnection } from '@/hermes'
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
import { markNativeNotifyBaseline } from '@/store/notify-baseline'
import { setConnection, setGatewayState } from '@/store/session'
import { stampSecondaryProfileOwner } from '@/store/session-event-provenance'

// ── Multi-profile gateway routing ──────────────────────────────────────────
// Concurrent sessions across profiles need concurrent sockets: the renderer's
// event handler is already session-keyed, so the only thing stopping two
// profiles streaming at once was the single swapping socket. We keep that one
// socket as the PRIMARY (window) backend — owned by use-gateway-boot, with all
// its boot-progress / sleep-wake machinery — and add one persistent SECONDARY
// socket per *other* profile that has live work. Every socket feeds the same
// handleGatewayEvent, so background sessions keep painting. Single-profile users
// only ever have the primary, so their path is byte-for-byte unchanged.

const normKey = (profile: string | null | undefined): string => (profile ?? '').trim() || 'default'

// Spawn-slot priority handed to Electron main with every backend dial. A
// user-initiated open is 'foreground' and may take the pool's reserved slot;
// roster hydration, hover prewarm and untagged dials are 'background' — main's
// default, so background dials keep the pre-priority IPC payload shape.
export type SpawnPriority = 'foreground' | 'background'

function dialPriority(spawnPriority: SpawnPriority): { priority: 'foreground' } | Record<never, never> {
  return spawnPriority === 'foreground' ? { priority: 'foreground' } : {}
}

function dialProfile(
  desktop: NonNullable<typeof window.hermesDesktop>,
  profile: string,
  spawnPriority: SpawnPriority
): Promise<HermesConnection> {
  return spawnPriority === 'foreground'
    ? desktop.getConnection(profile, { priority: 'foreground' })
    : desktop.getConnection(profile)
}

// Read connection state through a call so TS control-flow analysis doesn't
// narrow the getter to a constant across guards (it genuinely changes).
const isOpen = (gateway: HermesGateway | null): boolean => gateway?.connectionState === 'open'

interface RegistryConfig {
  /** Electron's published descriptor is authoritative for a primary gateway's
   * registry identity. Kept as a getter so gateway.ts does not own or duplicate
   * the connection store. */
  activeConnectionId?: () => null | string
  onEvent: (event: GatewayEvent) => void
  /** Server→client request (clarify, approval, …) from ANY socket the registry owns; the
   *  request's `respond` already routes to the socket it came from. `profile` /
   *  `connectionId` tag the source the same way events are tagged. */
  onServerRequest?: (request: ScopedServerRequest) => void
  onActiveConnectionInvalidated?: (fallbackProfile: string, activationEpoch: number) => void
  onActiveConnectionChanged?: (connection: HermesConnection) => void
  /**
   * Fires whenever applyActive() moves the active route to a (possibly
   * different) profile — including registry-internal eviction fallbacks
   * (idle reap, connection removal, profile delete) that no renderer call
   * initiated. Consumers mirror this into $activeGatewayProfile so the
   * published profile can never diverge from the socket actually selected
   * (#89206: the stale-profile split-brain that stranded bot wake-ups).
   */
  onActiveRouteChanged?: (profile: string) => void
  /** Drop transient profile-pool runtime routes when local profile teardown
   * permanently retires their owning secondary. Exact registry routes are
   * deliberately outside this callback: a remote source may share the name. */
  onLocalProfileRetired?: (profile: string) => void
  /**
   * Scopes a FOREGROUND surface is bound to right now — every mounted
   * session tile's owner and the primary thread's (foregroundSessionScopes in
   * store/session-states; a config hook because that store imports this
   * one). Consulted by EVERY dispose path — the live-work pruner and the
   * dispose-at-refcount-0 request/relay leases alike (#93892): a tile's
   * resume mints its runtime on its owner's socket, and any path that closes
   * that socket makes the backend orphan-reap the runtime, whose
   * `session.reclaimed` unbinds the tile and re-arms its resume — a spinner
   * loop with no terminal state. Read at decision time, never cached: it
   * follows the tile set, so closing the tile releases the socket.
   */
  foregroundScopes?: () => ReadonlySet<string>
  /**
   * Scopes with a running or needs-input session runtime, in the same key
   * language as `foregroundScopes` (composite registry keys, bare profiles
   * for local/legacy entries). The wake-path liveness probe counts these as
   * in-flight work: prompt.submit returns before the turn ends, so
   * `activeRequests` is 0 during most of a turn.
   */
  liveScopes?: () => ReadonlySet<string>
}

// ── Secondary (pool) backends ──────────────────────────────────────────────
interface Secondary {
  /** Scope key from registryBackendScopeKey(connectionId, profile). */
  scope: string
  profile: string
  /** Registry connection serving this socket; null = the local/legacy path. */
  connectionId: null | string
  connection: HermesConnection | null
  gateway: HermesGateway
  /**
   * Date.now() of the most recent socket 'open'. The live-work pruner's
   * min-lifetime grace reads this: an idle prune can race an on-demand dial
   * (prune → redial → prune) and close freshly opened sockets before their
   * consumer registers in the keep-set, re-triggering the orphan-reap /
   * remount loop (#94769). 0 = never opened.
   */
  lastOpenedAt: number
  /** Date.now() of the CURRENT socket's 'open'; null while not open. Stability
   *  clock for the backoff reset (#83134) — `lastOpenedAt` persists across
   *  closes and would make every failed redial look like a stable session. */
  openedAt: null | number
  activeRequests: number
  connectPromise: Promise<void> | null
  offEvent: () => void
  offRequest: () => void
  offState: () => void
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempt: number
  /**
   * Consecutive unanswered wake-probe pings on this entry's current socket;
   * drives the same streak tolerance the primary's probe applies
   * (decideLivenessForceClose). Reset on every answered probe and on every
   * fresh socket open.
   */
  livenessProbeFailures: number
  /** Pending deferred liveness re-probe after an in-flight-work deferral. */
  livenessReprobeTimer: ReturnType<typeof setTimeout> | null
  /** Consecutive automatic dials that stalled (slot wait / dial timeout)
   *  rather than failing fast; see SECONDARY_STALLED_DIAL_BUDGET. */
  stalledDials: number
  reconnecting: boolean
  /** A material connection edit is waiting for live owners to drain. */
  pendingConnectionRedial: boolean
  /**
   * True when a foreground/prewarmed consumer owns this entry beyond one RPC.
   * Guards ONLY the dispose-at-refcount-0 paths (request/relay leases), never
   * the live-work pruner: it is a one-way latch that every hover pre-warm and
   * profile switch sets and nothing ever clears, so honoring it in
   * pruneSecondaryGateways would pin every socket ever warmed. A foreground
   * surface that must keep its owner socket (a mounted session tile, the
   * primary thread) is represented in the pruner's keep-set instead — see
   * foregroundSessionScopes in store/session-states (#93892).
   */
  retained: boolean
  /**
   * Bot-relay retainers pinning this socket open across drain ticks (#93594).
   * The relay's drain loop RPCs every registered connection on an interval;
   * without retention each tick dialed and tore down a fresh WebSocket per
   * connection (refcount hit 0 → dispose). Counted, not boolean, so relay
   * retention can never clobber (or be clobbered by) the foreground
   * `retained` flag. Only non-local registry routes are ever counted here —
   * see retainGatewayForRelay.
   */
  relayRetainCount: number
  // While true the entry auto-reconnects on drop; pruning flips it off so a
  // deliberate close doesn't trigger the backoff loop.
  wantOpen: boolean
  /**
   * Main retired this scope's pooled backend for a foreground open elsewhere
   * (electron/pool-retire.ts). A parked-by-stall entry re-arms on the
   * wake/focus nudge; a retired one must not — that nudge would redial into
   * the very slot the retirement freed. Only an explicit open of the scope
   * clears it (rearmSecondary).
   */
  retiredByPool: boolean
  /**
   * Epoch-ms deadline while an activation (prepare/ensure) is mid-dial. The
   * live-work pruner must not dispose an entry the user is switching to: a
   * switch target is not yet the active key, has no live sessions and holds
   * no request lease, so during a cold pool spawn (~3s) every prune recompute
   * saw it as idle garbage and disposed it mid-dial — the root of the dead
   * profile clicks in #89622. Cleared when the activation settles; bounded so
   * an orphaned lease self-heals.
   */
  activationLeaseUntil: number
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

// ── HMR-stable module state ─────────────────────────────────────────────────
// All mutable singletons (live sockets, active-profile routing, the event
// registry) live in ONE container parked on globalThis, NOT in module-level
// `let`/`const` bindings. Reason: this module is imported widely without an HMR
// boundary that accepts it, so editing it (or anything that fans out to it)
// makes Vite issue a FULL PAGE RELOAD — which would kill every live socket and
// drop the agent session on an unrelated edit. Persisting the state on
// globalThis + self-accepting HMR (bottom of file) turns that full reload into
// an in-place hot update that preserves the sockets. Production strips
// import.meta.hot, and a fresh page realm starts with an empty container, so the
// runtime behavior is identical to plain module state.
interface GatewayRegistryState {
  config: RegistryConfig | null
  primaryGateway: HermesGateway | null
  /** Registry source currently served by primaryGateway, when known. */
  primaryConnectionId: null | string
  /** Resolved mode of the primary's descriptor: a `local` primary is ONE
   *  `hermes serve --profile <primary>` child and can never stand in for a
   *  pooled profile's own backend. */
  primaryConnectionMode: 'local' | 'remote' | null
  primaryProfile: string
  activeKey: string
  activationEpoch: number
  secondaries: Map<string, Secondary>
  // Auth rejection outlives the disposable socket, including background request leases.
  reauthFailures: Map<string, { connectionId: string | null; error: Error }>
  // Dial failures outlive the disposable socket too: a background request lease disposes its
  // entry on failure, so history kept on the entry reset on every poll (#121865).
  dialFailures: Map<string, { at: number; streak: number; connectionId: string | null }>
  /** Scopes that opened in this renderer generation, even if later pruned. */
  openedSecondaryScopes?: Set<string>
  /** Scopes whose re-activation after a connection redial has not landed yet. */
  reactivatingScopes?: Set<string>
  /** Routed prompt sockets held until their terminal turn event arrives. */
  turnLeases: Map<string, () => void>
  /** Debounced releases so an immediate chained turn can reuse its lease. */
  turnLeaseReleaseTimers: Map<string, ReturnType<typeof setTimeout>>
  $gateway: ReturnType<typeof atom<HermesGateway | null>>
  $activeProfile: ReturnType<typeof atom<string>>
}

const STATE_KEY = Symbol.for('hermes.desktop.gatewayRegistryState')

function createRegistryState(): GatewayRegistryState {
  return {
    config: null,
    primaryGateway: null,
    primaryConnectionId: null,
    primaryConnectionMode: null,
    primaryProfile: 'default',
    activeKey: 'default',
    activationEpoch: 0,
    secondaries: new Map<string, Secondary>(),
    reauthFailures: new Map(),
    dialFailures: new Map(),
    openedSecondaryScopes: new Set<string>(),
    reactivatingScopes: new Set<string>(),
    turnLeases: new Map<string, () => void>(),
    turnLeaseReleaseTimers: new Map<string, ReturnType<typeof setTimeout>>(),
    // The active gateway instance, exposed for inline message-stream
    // components (inline ClarifyTool, model overlays) that call gateway
    // methods without the instance threaded down through props.
    $gateway: atom<HermesGateway | null>(null),
    // The PROFILE the active gateway is routed to (bare profile name, never a
    // composite registry scope). Owned exclusively by applyActive() so the
    // published profile can never diverge from the socket actually selected —
    // the split-brain where an eviction re-pointed activeKey at the primary
    // while the profile atom kept naming the evicted bot routed every
    // "loki" session.resume to the default backend (#89206 wake failures).
    $activeProfile: atom<string>('default')
  }
}

// Dev only: park the singletons on globalThis so an HMR re-eval of this module
// (self-accepted at the bottom) hands back the SAME live sockets/atoms instead
// of resetting them — that's what keeps the agent session alive across UI edits.
// `import.meta.hot` is undefined in production, so Vite dead-code-eliminates the
// entire globalThis branch and prod uses a plain module-local singleton — no
// globalThis, no Symbol.for. Both realms load the module once, so the container's
// shape and lifetime are identical either way.
function gatewayState(): GatewayRegistryState {
  if (import.meta.hot) {
    const store = globalThis as unknown as { [STATE_KEY]?: GatewayRegistryState }
    store[STATE_KEY] ??= createRegistryState()

    // Existing dev-HMR containers predate whole-turn leases.
    store[STATE_KEY].reauthFailures ??= new Map()
    store[STATE_KEY].dialFailures ??= new Map()
    store[STATE_KEY].turnLeases ??= new Map()
    store[STATE_KEY].turnLeaseReleaseTimers ??= new Map()

    return store[STATE_KEY]
  }

  return createRegistryState()
}

const g = gatewayState()

// Dev HMR can hand a newer module an older state-container shape. Keep the
// generation ledger lazy so an already-open socket still survives the update.
const openedSecondaryScopes = (): Set<string> => (g.openedSecondaryScopes ??= new Set<string>())
// Dev-HMR states predate this field, so read it through the same lazy accessor pattern.
const reactivatingScopes = (): Set<string> => (g.reactivatingScopes ??= new Set<string>())

// Re-exported as a stable binding: the atom instance lives in `g`, so every hot
// reload of this module hands back the SAME atom subscribers are already wired
// to. (A fresh `atom()` per reload would orphan existing subscriptions.)
export const $gateway = g.$gateway

// The profile the ACTIVE gateway is actually routed to. Registry-owned: the
// only writer is applyActive(), which sets it in the same synchronous step
// that selects the socket — so a consumer that reads this and then calls
// activeGateway() always gets a matching (profile, socket) pair. Renderer
// surfaces (store/profile.ts's $activeGatewayProfile) mirror this atom
// instead of writing their own copy.
export const $activeGatewayRoute = g.$activeProfile

/** Bare profile name the active gateway serves (never a composite scope). */
export function activeGatewayProfileKey(): string {
  return g.$activeProfile.get()
}

export function configureGatewayRegistry(cfg: RegistryConfig): void {
  g.config = cfg
}

/**
 * Feed a synthetic event through the exact same fan-out a real socket frame
 * takes (`config.onEvent` → the desktop's `handleGatewayEvent`). Used by
 * dev-only tooling to exercise the real event branches (e.g. the credit-notice
 * demo) without a backend that can produce the event on demand. No-op until a
 * registry is configured.
 */
export function emitLocalGatewayEvent(event: GatewayEvent): void {
  g.config?.onEvent(event)
}

/** A server→client request tagged with the registry source it arrived from (like `GatewayEvent.profile`). */
export interface ScopedServerRequest extends ServerRequest {
  connectionId?: string
  profile: string
}

/**
 * Route a server→client request into the registry handler with its source tags.
 * Fail fast, never swallow: the backend blocks on this answer (clarify waits
 * its full 3600s deadline). Without a registry there is nobody to answer —
 * returning `false` lets the channel answer -32601 immediately instead of
 * stalling the turn (it also fires the client's `onUnhandledRequest` sink).
 */
function dispatchServerRequest(request: ServerRequest, profile: string, connectionId: null | string): boolean {
  if (!g.config?.onServerRequest) {
    return false
  }

  g.config.onServerRequest({ ...request, ...(connectionId ? { connectionId } : {}), profile })

  return true
}

/** Fan a primary-socket server request into the registry handler with the active source tags. */
export function dispatchPrimaryServerRequest(request: ServerRequest, profile: string): boolean {
  return dispatchServerRequest(request, profile, g.config?.activeConnectionId?.() ?? null)
}

export function setPrimaryGateway(gateway: HermesGateway | null, profile = 'default'): void {
  const next = normKey(profile)

  if (g.primaryGateway !== gateway) {
    g.primaryConnectionId = null
    g.primaryConnectionMode = null
  }

  // Route identity is exact-scope, never bare-name (#93892 follow-up): when
  // the active route IS the primary and the primary re-homes to another
  // profile, the active key must follow it. Leaving the old bare profile name
  // behind lets a later same-named LOCAL secondary inherit the active-route
  // spare in pruneSecondaryGateways — a remote tile keep-set of composite
  // scopes then appears to "pin" that unrelated local socket forever.
  if (g.activeKey === g.primaryProfile) {
    g.activeKey = next
  }

  g.primaryGateway = gateway
  g.primaryProfile = next

  if (g.activeKey === g.primaryProfile) {
    setApiRequestConnection(g.primaryConnectionId)
  }
}

export function setPrimaryGatewayConnectionId(
  connectionId: null | string | undefined,
  mode: 'local' | 'remote' | null | undefined = undefined
): void {
  // Hardening for #95628: while the active route is a secondary scope, the
  // window is looking at a NON-primary socket — any connection id flowing
  // through presentation-layer code at that moment describes the secondary,
  // not the primary. Accepting it would relabel the primary socket, so every
  // ambient API/WebSocket helper (and new-session routing) silently lands on
  // the wrong backend. The primary's own identity is (re)published by its
  // boot/reconnect path, which runs with the primary route active.
  if (!isActivePrimary()) {
    return
  }

  g.primaryConnectionId = (connectionId ?? '').trim() || null
  g.primaryConnectionMode = mode === 'local' || mode === 'remote' ? mode : null

  if (g.activeKey === g.primaryProfile) {
    setApiRequestConnection(g.primaryConnectionId)
  }
}

/**
 * Mode of the socket this window already dialed for `(connectionId, profile)`,
 * following gatewayForProfile's precedence: the primary socket when it serves
 * that profile, else a secondary's own descriptor. Null until one is dialed.
 */
export function dialedGatewayModeFor(connectionId: null | string, profile: string): 'local' | 'remote' | null {
  const id = String(connectionId ?? '').trim() || null
  const key = normKey(profile)

  if (key === g.primaryProfile && (!id || id === g.primaryConnectionId) && g.primaryConnectionMode) {
    return g.primaryConnectionMode
  }

  const mode = g.secondaries.get(registryBackendScopeKey(id, key))?.connection?.mode

  return mode === 'local' || mode === 'remote' ? mode : null
}

/** Publish the registry source owned by the window primary socket. */
export function setPrimaryGatewayConnection(connection: Pick<HermesConnection, 'connectionId' | 'mode'> | null): void {
  setPrimaryGatewayConnectionId(connection?.connectionId, connection?.mode)
}

function isPrimaryRegistryRoute(connectionId: null | string, profile: string): boolean {
  const id = String(connectionId ?? '').trim()

  return (
    normKey(profile) === g.primaryProfile &&
    Boolean(id) &&
    Boolean(g.primaryConnectionId) &&
    id === g.primaryConnectionId
  )
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

export function isActivePrimary(): boolean {
  return g.activeKey === g.primaryProfile
}

/** Changes on every active route selection, including same-profile source swaps. */
export function gatewayActivationEpoch(): number {
  return Number.isFinite(g.activationEpoch) ? g.activationEpoch : 0
}

export function activeGateway(): HermesGateway | null {
  if (g.activeKey === g.primaryProfile) {
    return g.primaryGateway
  }

  // A named scope resolves to ITS socket or nothing. Falling back to the
  // primary here would silently route calls (sends, session ops, roster
  // requests) to the WRONG backend whenever the scope's entry is gone —
  // teardown sites keep the invariant "activeKey always resolves" by
  // re-pointing the active key at the primary when they evict it.
  return g.secondaries.get(g.activeKey)?.gateway ?? null
}

/** Passive ordering barrier for a runtime's transcript reads. Inspect only
 * existing sockets: waiting must never dial, activate, or retain a backend.
 * Each client names its own replaying runtime IDs; no ambient route is used
 * to decide which session's events are safe to paint over. A pruned or
 * pool-retired secondary keeps its closed socket's watermarks but will never
 * reopen to replay them, so it must not veto reads forever. */
export function pendingSessionReplay(runtimeId: string): Promise<boolean> | undefined {
  const reconnectable = [...g.secondaries.values()].filter(entry => entry.wantOpen && !entry.retiredByPool)
  const clients = new Set([g.primaryGateway, ...reconnectable.map(entry => entry.gateway)])

  // A closed socket's false means only that IT cannot replay yet. When another
  // open socket already serves this runtime, that socket orders the read.
  const servedOpen = [...clients].some(client => isOpen(client) && client?.getSeqWatermarks?.()[runtimeId] != null)

  const pending = [...clients].flatMap(client => {
    if (servedOpen && !isOpen(client)) {
      return []
    }

    // A dev-HMR survivor can predate the barrier method.
    const barrier = client?.sessionReplayBarrier?.(runtimeId)

    return barrier ? [barrier] : []
  })

  return pending.length ? Promise.all(pending).then(results => results.every(Boolean)) : undefined
}

/**
 * The registry connection serving the gateway the user is currently looking
 * at. A registry-backed primary takes its identity from the published primary
 * connection, falling back to Electron's active descriptor until that is set;
 * a true legacy primary (no resolved connectionId) and profile-keyed local
 * secondaries remain null. Event consumers pair this with the event's own
 * `connectionId` tag so "from the active profile" really means "from the active SOURCE":
 * two connected gateways can both expose a 'default' profile, and a bare
 * profile comparison attributed gateway B's 'default' activity to gateway A.
 */
export function activeGatewayConnectionId(): null | string {
  if (g.activeKey === g.primaryProfile) {
    return g.primaryConnectionId ?? (g.config?.activeConnectionId?.()?.trim() || null)
  }

  return g.secondaries.get(g.activeKey)?.connectionId ?? null
}

/**
 * Registry connections currently served by a live (open-socket) secondary.
 * Used by the reconnect path when the restarted primary's own registry
 * identity is unknown: Bot runtimes owned by these connections are provably
 * NOT the restarted backend and keep their bindings; everything else re-resumes.
 */
export function liveSecondaryConnectionIds(): Set<string> {
  const live = new Set<string>()

  for (const entry of g.secondaries.values()) {
    if (entry.connectionId && isOpen(entry.gateway)) {
      live.add(entry.connectionId)
    }
  }

  return live
}

// Mirror a backend's connection state into the global composer state, but only
// when that backend is the one the user is currently looking at. Lets the
// composer reflect the active profile's socket without a background reconnect
// flipping the foreground enabled/disabled state.
function reportGatewayState(profile: string, state: ConnectionState): void {
  // Any socket opening replays parked prompts; hold OS notifications so a
  // launch/reconnect doesn't alert about state that already existed.
  if (state === 'open') {
    markNativeNotifyBaseline()
  }

  if (normKey(profile) === g.activeKey) {
    setGatewayState(state)
  }
}

export function reportPrimaryGatewayState(state: ConnectionState): void {
  reportGatewayState(g.primaryProfile, state)
}

function setActive(profile: string): void {
  const activationEpoch = beginGatewayActivation()
  applyActive(profile, activationEpoch)
}

function beginGatewayActivation(): number {
  g.activationEpoch = gatewayActivationEpoch() + 1

  return g.activationEpoch
}

function applyActive(profile: string, activationEpoch: number): boolean {
  if (gatewayActivationEpoch() !== activationEpoch) {
    return false
  }

  g.activeKey = normKey(profile)
  const gateway = activeGateway()
  g.$gateway.set(gateway)
  setGatewayState(gateway?.connectionState ?? 'closed')
  // Push the active scope's registry connection into the hermes module (null
  // for the local pool) so connection-building WS calls (pluginSocket) resolve
  // through the same source of truth every activation path maintains here —
  // registry-agent activations included, not just profile switches.
  setApiRequestConnection(activeGatewayConnectionId())

  // Publish the BARE profile this route serves, in the same synchronous step
  // as the socket selection. activeKey may be a composite registry scope
  // (connectionId::profile); consumers route RPCs by profile, so resolve it
  // through the secondary's own record. This atom is the single source of
  // truth for "which profile is the active gateway on" — every eviction /
  // fallback path funnels through applyActive, so the published profile can
  // never linger on a backend that is no longer selected (#89206).
  const routeProfile =
    g.activeKey === g.primaryProfile ? g.primaryProfile : (g.secondaries.get(g.activeKey)?.profile ?? g.primaryProfile)

  g.$activeProfile.set(routeProfile)
  g.config?.onActiveRouteChanged?.(routeProfile)

  return true
}

function publishActiveConnection(connection: HermesConnection): void {
  if (g.config?.onActiveConnectionChanged) {
    g.config.onActiveConnectionChanged(connection)
  } else {
    setConnection(connection)
  }
}

function clearTimer(entry: Secondary): void {
  if (entry.reconnectTimer !== null) {
    clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
  }
}

async function openSecondary(entry: Secondary, spawnPriority: SpawnPriority = 'background'): Promise<void> {
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

function rearmSecondary(entry: Secondary, priority: SpawnPriority = 'foreground'): void {
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
function backgroundDialCoolingDown(scope: string, now = Date.now()): boolean {
  const failure = g.dialFailures.get(scope)

  return failure !== undefined && now - failure.at < reconnectBackoffDelayMs(failure.streak - 1, { jitter: false })
}

/** Dial a request's secondary if it is down. Both request paths (a plain profile via
 *  gatewayForProfile, a registry route via requestGatewayForAgent) used to dial straight past
 *  the reconnect ladder, and openSecondary only coalesces CONCURRENT dials, so a poller against
 *  a scope whose socket accepts and then dies redialed once per tick (session.control.read on a
 *  cross-profile session, #121865). After a failure, background callers fail fast and leave
 *  redialing to scheduleReconnect; a user action (foreground) still dials at once. */
async function openSecondaryForRequest(entry: Secondary, spawnPriority: SpawnPriority): Promise<void> {
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

function scheduleReconnect(entry: Secondary): void {
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

async function reconnectSecondary(entry: Secondary): Promise<void> {
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

function createSecondary(profile: string, connectionId: null | string = null): Secondary {
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
 *   gateway-registry   the shared registry state (globalThis-parked for HMR),
 *                      the window PRIMARY socket's identity, and the active-route
 *                      selection machinery (applyActive / atoms / reporting).
 *   gateway-secondary  one SECONDARY socket entry's mechanics: dial, reconnect
 *                      backoff, liveness probe, turn-lease primitives, retention
 *                      predicates, park/touch/count, and entry disposal.
 *   gateway-routing    request routing onto primary vs secondary sockets, the
 *                      request/relay/turn leases and retain calls that hold a
 *                      socket open, activation (the ensure/open entry points),
 *                      and the eviction admin (prune/close/retire/dispose-for-
 *                      connection).
 *
 * The facade keeps every public name; siblings own one topic each.
 */

export * from './gateway-registry'
export * from './gateway-routing'
export * from './gateway-secondary'

// Self-accept so an edit inside this family stays an in-place hot update.
// Dev-only: production strips import.meta.hot.
if (import.meta.hot) {
  import.meta.hot.accept()
}
