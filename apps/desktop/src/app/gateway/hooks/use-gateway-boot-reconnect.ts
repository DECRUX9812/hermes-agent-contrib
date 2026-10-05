import { isGatewayReauthRequired, JsonRpcGatewayError, reconnectBackoffDelayMs } from '@hermes/shared'

import type { HermesConnection } from '@/global'
import type { HermesGateway } from '@/hermes'
import { translateNow } from '@/i18n'
import {
  decideLivenessForceClose,
  LIVENESS_PROBE_TIMEOUT_MS,
  LIVENESS_REPROBE_DELAY_MS
} from '@/lib/gateway-liveness-policy'
import { resolveDesktopGatewayWsUrl } from '@/lib/gateway-ws-url'
import { RECONNECT_ATTEMPT_TIMEOUT_MS, withTimeout } from '@/lib/with-timeout'
import { $desktopBoot, completeDesktopBoot, failDesktopBoot } from '@/store/boot'
import { resetBackgroundPollingGuard } from '@/store/composer-status'
import {
  activeGateway,
  gatewayActivationEpoch,
  isActivePrimary,
  liveSecondaryConnectionIds,
  reconnectSecondaryGateways,
  setPrimaryGatewayConnection
} from '@/store/gateway'
import { reconnectGateway } from '@/store/gateway-reconnect'
import { $gatewaySwitching } from '@/store/gateway-switch'
import { notify, RECOVERY_ACTIONS } from '@/store/notifications'
import { $workingSessionIds, reconcileBusyStatesOnReconnect, resetTileRuntimeBindings } from '@/store/session-states'

import {
  primaryRuntimeConnectionId,
  RECONNECT_ESCALATE_AFTER_MS,
  WAKE_RECONNECT_HOLDOFF_MS
} from './use-gateway-boot-initial-connect'

// The callbacks the composing hook owns. Kept structural so the machine
// siblings do not import the facade.
export interface GatewayBootCallbacksRef {
  current: {
    refreshHermesConfig: (force?: boolean, shouldPublish?: () => boolean) => Promise<void>
    refreshSessions: (shouldPublish?: () => boolean) => Promise<void>
  }
}

// The mutable episode state the boot effect shares with the phase machines:
// exactly the `let`s the effect used to declare, parked on one object so
// sibling modules can hold and mutate them.
export interface GatewayBootState {
  cancelled: boolean
  bootCompleted: boolean
  bootFailed: boolean
  primaryReauthError: string | null
  reconnecting: boolean
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempt: number
  livenessProbeFailures: number
  /** Why the next post-open close happens when this hook closes the socket
   *  itself (friction telemetry): a liveness timeout is a real drop, a manual
   *  reconnect is not. */
  ownCloseReason: 'manual' | 'timeout' | null
  livenessReprobeTimer: ReturnType<typeof setTimeout> | null
  reconnectFailingSince: number | null
  reauthNotified: boolean
  escalated: boolean
  bootRetryAttempt: number
  bootRetryTimer: ReturnType<typeof setTimeout> | null
  lastForcedWakeReconnectAt: number
  /** The route the primary socket was last recorded against; a reconnect
   *  re-dials THIS route, not main's mutable foreground one. */
  primaryConnection: HermesConnection | null
  /** Bumped whenever the primary route is recorded, so a reconnect whose
   *  lookup started before a boot/connection apply cannot re-own the primary. */
  primaryRouteRevision: number
}

export function createGatewayBootState(): GatewayBootState {
  return {
    cancelled: false,
    bootCompleted: false,
    bootFailed: false,
    primaryReauthError: null,
    reconnecting: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
    livenessProbeFailures: 0,
    ownCloseReason: null,
    livenessReprobeTimer: null,
    reconnectFailingSince: null,
    reauthNotified: false,
    escalated: false,
    bootRetryAttempt: 0,
    bootRetryTimer: null,
    lastForcedWakeReconnectAt: 0,
    primaryConnection: null,
    primaryRouteRevision: 0
  }
}

// Every site that adopts a primary route goes through here so the revision
// fence in attemptReconnect() sees it.
export function recordPrimaryConnection(s: GatewayBootState, connection: HermesConnection) {
  s.primaryConnection = connection
  s.primaryRouteRevision += 1
  setPrimaryGatewayConnection(connection)
}

export interface GatewayBootReconnectDeps {
  s: GatewayBootState
  desktop: NonNullable<typeof window.hermesDesktop>
  /** The effect's one primary socket — fixed for the effect's lifetime. */
  gateway: HermesGateway
  callbacksRef: GatewayBootCallbacksRef
  publish: (next: HermesConnection | null) => void
}

// Reconnect-after-sleep machinery for the PRIMARY socket: the escalation
// toast, the liveness probe, the bounded wake holdoff, and the backoff loop.
export function createGatewayBootReconnect({ s, desktop, gateway, callbacksRef, publish }: GatewayBootReconnectDeps) {
  const syncPrimaryReauthError = () => {
    if (!s.bootCompleted || !s.primaryReauthError) {
      return
    }

    if (isActivePrimary()) {
      failDesktopBoot(s.primaryReauthError)
    } else if (activeGateway()?.connectionState === 'open' && $desktopBoot.get().error === s.primaryReauthError) {
      completeDesktopBoot()
    }
  }

  const resetReconnectBackoff = () => {
    s.reconnectAttempt = 0
    s.reconnectFailingSince = null
    s.escalated = false
  }

  const clearBootRetryTimer = () => {
    if (s.bootRetryTimer !== null) {
      clearTimeout(s.bootRetryTimer)
      s.bootRetryTimer = null
    }
  }

  // Whether the failed boot is a TRANSIENT remote fault main marked as
  // retryable (dropped SSH/HTTP registered connection, mint timeout).
  // Local failures and confirmed reauth rejections come back false and go
  // straight to the recovery overlay.
  const bootFailureIsRetryable = async (): Promise<boolean> => {
    try {
      const snapshot = await desktop.getBootProgress()

      return snapshot?.retryable === true
    } catch {
      return false
    }
  }

  // Wrap the live getter in a call so TS control-flow analysis doesn't narrow
  // `connectionState` to a constant across the early-return guards (the state
  // genuinely changes between reads).
  const gatewayOpen = () => gateway.connectionState === 'open'

  const clearReconnectTimer = () => {
    if (s.reconnectTimer !== null) {
      clearTimeout(s.reconnectTimer)
      s.reconnectTimer = null
    }
  }

  const clearLivenessReprobeTimer = () => {
    if (s.livenessReprobeTimer !== null) {
      clearTimeout(s.livenessReprobeTimer)
      s.livenessReprobeTimer = null
    }
  }

  // One bounded retry before a mid-turn teardown: the first probe timeout
  // while work is in flight is inconclusive (a busy backend starves the
  // loop without being dead), so re-probe once after a short delay instead
  // of force-closing a socket a running turn still rides on (#95327).
  const scheduleLivenessReprobe = () => {
    if (s.cancelled || s.livenessReprobeTimer !== null || $gatewaySwitching.get()) {
      return
    }

    s.livenessReprobeTimer = setTimeout(() => {
      s.livenessReprobeTimer = null
      void reconnectNow()
    }, LIVENESS_REPROBE_DELAY_MS)
  }

  const attemptReconnect = async (manual?: { profile: string; activationEpoch: number }) => {
    if (s.cancelled || s.primaryReauthError || s.reconnecting || gatewayOpen() || $gatewaySwitching.get()) {
      return
    }

    s.reconnecting = true

    try {
      // Drop a stale REMOTE backend cache before re-dialing. After sleep/wake a
      // remote backend can become unreachable, but it has no child process
      // whose 'exit' would clear the main process's cached descriptor — without
      // this the renderer re-dials the same dead endpoint forever and stays on
      // "Starting Hermes…". The probe is a no-op for a healthy or local backend.
      // Bounded like the two awaits below: a wedged revalidation (#93454) is
      // the specific hang this loop must survive, not just a rejection.
      await withTimeout(
        desktop.revalidateConnection?.() ?? Promise.resolve(),
        RECONNECT_ATTEMPT_TIMEOUT_MS,
        'Timed out revalidating the gateway connection'
      ).catch(() => undefined)

      // Reconnect the socket's own route, not main's mutable foreground route.
      // Profile-less resolution remains intentional for boot/connection apply.
      // A registry primary needs both identity fields; a legacy primary uses
      // its explicit profile so a foreground secondary cannot retarget it.
      const lookupRevision = s.primaryRouteRevision
      const primary = s.primaryConnection

      const conn = await withTimeout(
        primary?.registryScoped && primary.connectionId
          ? (desktop.getConnectionFor?.({ connectionId: primary.connectionId, profile: primary.profile }) ??
              Promise.reject(new Error('Registry gateway connection is unavailable')))
          : desktop.getConnection(primary?.profile),
        RECONNECT_ATTEMPT_TIMEOUT_MS,
        'Timed out reconnecting to Hermes backend'
      )

      // A boot/connection apply that recorded a newer primary route during
      // the lookup owns the socket; recording, publishing or dialing the old
      // route would undo it and pin later reconnects to the old gateway.
      if (s.cancelled || lookupRevision !== s.primaryRouteRevision) {
        return
      }

      recordPrimaryConnection(s, conn)
      const dialRevision = s.primaryRouteRevision

      // Only publish the primary descriptor when the primary is active.
      // Otherwise a background-profile view would inherit the primary's
      // mode/baseUrl and break image.attach / fs / media routing (#46651).
      if (isActivePrimary()) {
        publish(conn)
      }

      // Re-mint the WS URL before reconnecting. OAuth tickets are single-use
      // with a short TTL, so the ticket baked into the cached conn.wsUrl is
      // dead on every reconnect after the initial boot — reusing it surfaces
      // as an opaque "Could not connect to Hermes gateway". resolveGatewayWsUrl
      // mints a fresh ticket rather than connecting with a stale one. An
      // explicit auth rejection asks for sign-in; transport failures stay in
      // this reconnect loop. For local/token gateways the URL carries a
      // long-lived token and the re-mint is a cheap no-op.
      const wsUrl = await withTimeout(
        resolveDesktopGatewayWsUrl(desktop, conn),
        RECONNECT_ATTEMPT_TIMEOUT_MS,
        'Timed out re-minting the gateway WebSocket URL'
      )

      // Same fence after the mint: an apply that landed while the ticket was
      // in flight owns the socket, and its socket may already have dropped.
      if (s.cancelled || dialRevision !== s.primaryRouteRevision) {
        return
      }

      await gateway.connect(wsUrl)

      if (s.cancelled) {
        return
      }

      // A respawned backend re-mints (recycles) runtime ids, so any tile's
      // bound runtime id is now stale — drop them so each tile re-resumes.
      // A legacy remote primary has no registry identity to scope by; fall
      // back to preserving only Bot runtimes owned by provably-live
      // secondaries so the restarted backend's own tiles still rebind.
      const primaryConnectionId = primaryRuntimeConnectionId(conn)
      resetTileRuntimeBindings(
        manual && primaryConnectionId
          ? { connectionId: primaryConnectionId, profile: manual.profile }
          : (primaryConnectionId ?? { liveConnectionIds: liveSecondaryConnectionIds() })
      )
      // The status-stack poll guard latches session ids the OLD runtime
      // reported gone (4001). A respawned backend re-mints runtimes, so
      // those ids may be live again after re-resume — clear the latch with
      // the same lifetime as the runtime bindings it shadows.
      resetBackgroundPollingGuard()

      // Same staleness, other half: pre-reconnect busy flags are keyed by
      // those dead runtime ids and would never receive their terminal
      // busy:false — clear them or the sidebar running arc lies forever
      // (#53902/#73082). A genuinely live turn re-asserts busy on its next
      // post-reconnect event.
      // A manual retry may finish after the user has moved to another route.
      if (!manual || (isActivePrimary() && gatewayActivationEpoch() === manual.activationEpoch)) {
        reconcileBusyStatesOnReconnect()
        await callbacksRef.current.refreshHermesConfig().catch(() => undefined)
        await callbacksRef.current.refreshSessions().catch(() => undefined)
      }
    } catch (err) {
      // OAuth session expired mid-reconnect: surface the actionable "sign in
      // again" recovery overlay once instead of silently looping the backoff
      // against a ticket that can never succeed. Transport failures fall
      // through to the backoff in the finally block below — they must NOT
      // take the full-screen "couldn't start" path (locks reading/drafting).
      if (!s.cancelled && isGatewayReauthRequired(err) && !s.reauthNotified) {
        s.primaryReauthError = err instanceof Error ? err.message : String(err)
        syncPrimaryReauthError()
        s.reauthNotified = true
        // Plain "signed out" copy; the raw ticket/HTTP text stays under
        // Details. In the foreground the boot overlay carries the sign-in
        // flow, so the button hands off to it (desktop-14). A parked
        // background primary no longer retries by itself, so it must still
        // offer a way to Settings instead of failing silently.
        notify({
          kind: 'error',
          title: translateNow('boot.errors.gatewaySignInRequired'),
          message: translateNow('boot.errors.gatewaySignInRequiredDetail'),
          detail: s.primaryReauthError,
          action: isActivePrimary()
            ? {
                label: translateNow('boot.errors.signInAgain'),
                onClick: () => failDesktopBoot(s.primaryReauthError ?? '')
              }
            : RECOVERY_ACTIONS.openGateways()
        })
      }
    } finally {
      s.reconnecting = false

      if (!s.cancelled && !s.primaryReauthError && !gatewayOpen() && !$gatewaySwitching.get()) {
        if (s.reconnectFailingSince === null) {
          s.reconnectFailingSince = Date.now()
        }

        if (Date.now() - s.reconnectFailingSince >= RECONNECT_ESCALATE_AFTER_MS && !s.escalated) {
          s.escalated = true
          // Non-blocking: chat stays readable/draftable while we keep retrying.
          // Settings / Gateway menu remain reachable without a modal lockout.
          notify({
            kind: 'warning',
            title: translateNow('boot.errors.gatewayConnectionLost'),
            message: translateNow('boot.errors.gatewayConnectionLostDetail'),
            durationMs: 0,
            action: {
              label: translateNow('boot.errors.reconnectNow'),
              onClick: () => void reconnectGateway().catch(() => undefined)
            },
            secondaryAction: RECOVERY_ACTIONS.openGateways()
          })
        }

        scheduleReconnect(manual)
      }
    }
  }

  function scheduleReconnect(manual?: { profile: string; activationEpoch: number }) {
    if (
      s.cancelled ||
      s.primaryReauthError ||
      s.reconnecting ||
      s.reconnectTimer !== null ||
      gatewayOpen() ||
      $gatewaySwitching.get()
    ) {
      return
    }

    // Full-jitter exponential backoff (300ms base, 15s cap) so a gateway
    // restart doesn't get redialed by every desktop client in lockstep —
    // an immediate-retry reconnect storm can exhaust the gateway's file
    // descriptors while it's still coming back up.
    const delay = reconnectBackoffDelayMs(s.reconnectAttempt)
    s.reconnectAttempt += 1
    s.reconnectTimer = setTimeout(() => {
      s.reconnectTimer = null
      void attemptReconnect(manual)
    }, delay)
  }

  const reconnectNow = async ({ forceOpenSocket = false }: { forceOpenSocket?: boolean } = {}) => {
    if (s.cancelled || !s.bootCompleted || $gatewaySwitching.get()) {
      return
    }

    clearReconnectTimer()
    resetReconnectBackoff()
    reconnectSecondaryGateways({ forceOpenSockets: forceOpenSocket })

    // Browser WebSocket state can remain OPEN after sleep even though the OS
    // discarded the underlying TCP connection. Strong recovery signals used
    // to blind-close here, but that churned perfectly healthy connections on
    // every wake/online blip — the liveness probe below now decides, closing
    // only a socket that is provably dead.

    if (!gatewayOpen()) {
      await attemptReconnect()

      return
    }

    // The socket reports open, but sleep/wake (or a silent network drop)
    // can leave a half-open TCP connection: no close event fires, so
    // connectionState stays 'open' while every RPC hangs until its per-call
    // timeout — prompt.submit's is 30 minutes, which reads as "enter does
    // nothing until I restart the app". Probe liveness with a short-bounded
    // ping; on failure force the socket down so the onState handler above
    // schedules a reconnect (and resetTileRuntimeBindings re-resumes tiles),
    // instead of letting the user's next submit hang against a dead socket.
    //
    // A TIMEOUT is not always proof of death, though (#95327): a backend
    // mid-tool-call can starve its loop past this budget while perfectly
    // alive, and tearing the socket down then feeds the gateway's
    // ws_orphan_reap interrupt — the turn dies as a bare "Operation
    // interrupted." placeholder. While any session still reports working,
    // one inconclusive probe DEFERS the teardown behind a bounded re-probe;
    // only an exhausted streak (or no in-flight work) closes.
    try {
      await gateway.request('ping', {}, LIVENESS_PROBE_TIMEOUT_MS)
      s.livenessProbeFailures = 0
    } catch (probeErr) {
      // A version-skewed backend that predates the ping method answers
      // -32601 (method not found) — a HEALTHY response, not a dead socket.
      // Force-closing on it would spin the reconnect loop forever. Every
      // other failure (timeout on a swallowed ping, transport error) means
      // the socket is not PROVABLY alive and must eventually be rebuilt.
      if (probeErr instanceof JsonRpcGatewayError && probeErr.code === -32601) {
        s.livenessProbeFailures = 0

        return
      }

      s.livenessProbeFailures += 1

      const decision = decideLivenessForceClose({
        workingSessionCount: $workingSessionIds.get().length,
        consecutiveFailures: s.livenessProbeFailures
      })

      if (!decision.close) {
        scheduleLivenessReprobe()

        return
      }

      s.livenessProbeFailures = 0
      s.ownCloseReason = 'timeout'
      gateway.close()
    }
  }

  // Wake signals: power resume (macOS/Windows), network coming back, and the
  // window regaining focus/visibility. Each nudges an immediate reconnect.
  //
  // Forced reconnects (power resume / 'online') close and redial every open
  // secondary socket. Windows fires 'online' on any interface change — VPN
  // connects, Wi-Fi blips, virtual adapter enumeration — so an unthrottled
  // handler reaped healthy sockets in bursts and the UI remounted on every
  // redial: the #94769 flicker loop. Coalesce forced wakes like the main
  // process already does for power-resume revalidation
  // (POWER_RESUME_REVALIDATION_HOLDOFF_MS): one forced reconnect per
  // holdoff window; a socket dropped in between is still picked up by the
  // ordinary close/reconnect backoff and by the non-forced focus/visibility
  // nudges below.
  const forceReconnectNow = () => {
    // reconnectNow no-ops while boot is incomplete or a gateway switch is in
    // flight; stamping the holdoff then would burn the window and drop the
    // next 'online' (often the one with the network actually back), leaving
    // recovery to the backoff loops. Stamp only when it will proceed.
    if (s.cancelled || !s.bootCompleted || $gatewaySwitching.get()) {
      return
    }

    // Only the destructive half is coalesced: a second wake inside the
    // holdoff (macOS fires resume then 'online' seconds apart) still runs
    // the cheap, idempotent nudge — primary ping probe, redial of already
    // closed secondaries — without touching open sockets.
    const now = Date.now()
    const forced = now - s.lastForcedWakeReconnectAt >= WAKE_RECONNECT_HOLDOFF_MS

    if (forced) {
      s.lastForcedWakeReconnectAt = now
    }

    void reconnectNow({ forceOpenSocket: forced })
  }

  return {
    syncPrimaryReauthError,
    resetReconnectBackoff,
    clearBootRetryTimer,
    bootFailureIsRetryable,
    gatewayOpen,
    clearReconnectTimer,
    clearLivenessReprobeTimer,
    scheduleLivenessReprobe,
    attemptReconnect,
    scheduleReconnect,
    reconnectNow,
    forceReconnectNow
  }
}

export type GatewayBootReconnect = ReturnType<typeof createGatewayBootReconnect>
