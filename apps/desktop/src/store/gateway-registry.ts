import { type ConnectionState, type GatewayEvent, registryBackendScopeKey, type ServerRequest } from '@hermes/shared'
import { atom } from 'nanostores'

import type { HermesConnection } from '@/global'
import type { HermesGateway } from '@/hermes'
import { setApiRequestConnection } from '@/hermes'
import { traceIdentityChange } from '@/lib/identity-trace'
import { markNativeNotifyBaseline } from '@/store/notify-baseline'
import { setConnection, setGatewayState } from '@/store/session'

// ── Multi-profile gateway routing ──────────────────────────────────────────
// Concurrent sessions across profiles need concurrent sockets: the renderer's
// event handler is already session-keyed, so the only thing stopping two
// profiles streaming at once was the single swapping socket. We keep that one
// socket as the PRIMARY (window) backend — owned by use-gateway-boot, with all
// its boot-progress / sleep-wake machinery — and add one persistent SECONDARY
// socket per *other* profile that has live work. Every socket feeds the same
// handleGatewayEvent, so background sessions keep painting. Single-profile users
// only ever have the primary, so their path is byte-for-byte unchanged.

export const normKey = (profile: string | null | undefined): string => (profile ?? '').trim() || 'default'

// Spawn-slot priority handed to Electron main with every backend dial. A
// user-initiated open is 'foreground' and may take the pool's reserved slot;
// roster hydration, hover prewarm and untagged dials are 'background' — main's
// default, so background dials keep the pre-priority IPC payload shape.
export type SpawnPriority = 'foreground' | 'background'

export function dialPriority(spawnPriority: SpawnPriority): { priority: 'foreground' } | Record<never, never> {
  return spawnPriority === 'foreground' ? { priority: 'foreground' } : {}
}

export function dialProfile(
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
export const isOpen = (gateway: HermesGateway | null): boolean => gateway?.connectionState === 'open'

export interface RegistryConfig {
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
export interface Secondary {
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
  /** Explicit teardown is separate from parking, which also clears wantOpen. */
  disposed: boolean
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

export const g = gatewayState()

// Dev HMR can hand a newer module an older state-container shape. Keep the
// generation ledger lazy so an already-open socket still survives the update.
export const openedSecondaryScopes = (): Set<string> => (g.openedSecondaryScopes ??= new Set<string>())
// Dev-HMR states predate this field, so read it through the same lazy accessor pattern.
export const reactivatingScopes = (): Set<string> => (g.reactivatingScopes ??= new Set<string>())

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
export function dispatchServerRequest(request: ServerRequest, profile: string, connectionId: null | string): boolean {
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
  // Every caller publishes the window's OWN primary socket (boot, reconnect,
  // connection apply, HMR survivor), so record it even while a secondary is
  // foregrounded. Refusing it there left primaryConnectionId naming the
  // machine the primary socket had just left, and owner routing then sent
  // that machine's requests to the other one. What belongs to the active
  // scope is the AMBIENT request connection (#95628), which moves only while
  // the primary is in front.
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

export function isPrimaryRegistryRoute(connectionId: null | string, profile: string): boolean {
  const id = String(connectionId ?? '').trim()

  return (
    normKey(profile) === g.primaryProfile &&
    Boolean(id) &&
    Boolean(g.primaryConnectionId) &&
    id === g.primaryConnectionId
  )
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
export function reportGatewayState(profile: string, state: ConnectionState): void {
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

export function setActive(profile: string): void {
  const activationEpoch = beginGatewayActivation()
  applyActive(profile, activationEpoch)
}

export function beginGatewayActivation(): number {
  g.activationEpoch = gatewayActivationEpoch() + 1

  return g.activationEpoch
}

export function applyActive(profile: string, activationEpoch: number): boolean {
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
  traceIdentityChange(
    'gateway-route',
    'active',
    `key=${g.activeKey} via=${g.activeKey === g.primaryProfile ? 'primary' : 'secondary'} conn=${activeGatewayConnectionId() ?? '-'} profile=${routeProfile}`
  )

  return true
}

export function publishActiveConnection(connection: HermesConnection): void {
  if (g.config?.onActiveConnectionChanged) {
    g.config.onActiveConnectionChanged(connection)
  } else {
    setConnection(connection)
  }
}

// Self-accept so editing this module (or a fan-out that lands here) is an
// in-place hot update instead of a full page reload — the live sockets in `g`
// survive the swap. Dev-only: production strips import.meta.hot.
if (import.meta.hot) {
  import.meta.hot.accept()
}
