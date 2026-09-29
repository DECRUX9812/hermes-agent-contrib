import {
  type GatewayEvent,
  isStableOpen,
  JSON_RPC_METHOD_NOT_FOUND
} from '@hermes/shared'
import { useEffect, useRef } from 'react'

import { createGatewayEventDedupe } from '@/app/gateway/gateway-event-dedupe'
import { shouldApplyPostBootProgressError } from '@/components/boot-failure-reauth'
import type { DesktopBootProgress, HermesConnection, HermesWindowState } from '@/global'
import { HermesGateway } from '@/hermes'
import { translateNow } from '@/i18n'
import { RECONNECT_ATTEMPT_TIMEOUT_MS, withTimeout } from '@/lib/with-timeout'
import {
  $desktopBoot,
  applyDesktopBootProgress,
  completeDesktopBoot,
  failDesktopBoot,
  setDesktopBootStep
} from '@/store/boot'
import { noteBackendDrop, noteBackendExited } from '@/store/desktop-metrics'
import {
  $gateway,
  activeGateway,
  activeGatewayConnectionId,
  closeSecondaryGateways,
  configureGatewayRegistry,
  dispatchPrimaryServerRequest,
  disposeSecondariesForConnection,
  ensureActiveGatewayOpen,
  gatewayActivationEpoch,
  isActivePrimary,
  parkSecondariesForRetiredBackend,
  pruneSecondaryGateways,
  reportPrimaryGatewayState,
  type ScopedServerRequest,
  setPrimaryGateway,
  touchSecondaryGateways
} from '@/store/gateway'
import { registerGatewayReconnect } from '@/store/gateway-reconnect'
import {
  $gatewaySwitching,
  endGatewaySwitch,
  registerGatewaySwitchLifecycle
} from '@/store/gateway-switch'
import { notify } from '@/store/notifications'
import { loadPoolLimits } from '@/store/pool-limits'
import {
  $activeGatewayProfile,
  normalizeProfileKey,
  touchActiveGatewayBackend
} from '@/store/profile'
import { requestBackendRestart } from '@/store/recovery-requests'
import {
  $activeSessionId,
  $connection,
  $gatewayState,
  $selectedStoredSessionId,
  $sessions,
  forgetSessionOwnerHintsForConnection,
  setConnection,
  setSessionsLoading
} from '@/store/session'
import { stampSecondaryProfileOwner } from '@/store/session-event-provenance'
import {
  $attentionSessionIds,
  $sessionOwnerHoldRevision,
  $sessionTiles,
  $workingSessionIds,
  foregroundSessionScopes,
  forgetProfileOnlyRuntimeOwners,
  liveSessionScopes,
  openTileGatewayScopes,
  recordSessionEventScope
} from '@/store/session-states'

import { stashGatewaySurvivor, survivorIsStale, takeGatewaySurvivor } from './gateway-hmr-survivor'
import { useConnectionsRegistry } from './use-connections-registry'
import { useDefaultProfilePreference } from './use-default-profile-preference'
import { connectInitialGateway, primaryRuntimeConnectionId } from './use-gateway-boot-initial-connect'
import { createGatewayBootPhases } from './use-gateway-boot-phases'
import { createGatewayBootReconnect, createGatewayBootState } from './use-gateway-boot-reconnect'

// Re-exported for the tests that import this facade spec path directly.
export { connectInitialGateway, primaryRuntimeConnectionId }


interface GatewayBootOptions {
  beforeConnectionSwitch: () => void
  handleGatewayEvent: (event: GatewayEvent) => void
  /** Server→client request from any registry socket; false = no handler (the channel answers -32601). */
  handleServerRequest: (request: ScopedServerRequest) => boolean
  onConnectionReady: (
    connection: Awaited<ReturnType<NonNullable<typeof window.hermesDesktop>['getConnection']>> | null
  ) => void
  onGatewayReady: (gateway: HermesGateway | null) => void
  refreshHermesConfig: (force?: boolean, shouldPublish?: () => boolean) => Promise<void>
  refreshSessions: (shouldPublish?: () => boolean) => Promise<void>
}

export function useGatewayBoot({
  beforeConnectionSwitch,
  handleGatewayEvent,
  handleServerRequest,
  onConnectionReady,
  onGatewayReady,
  refreshHermesConfig,
  refreshSessions
}: GatewayBootOptions) {
  useDefaultProfilePreference()
  useConnectionsRegistry()

  const callbacksRef = useRef({
    beforeConnectionSwitch,
    handleGatewayEvent,
    handleServerRequest,
    onConnectionReady,
    onGatewayReady,
    refreshHermesConfig,
    refreshSessions
  })

  callbacksRef.current = {
    beforeConnectionSwitch,
    handleGatewayEvent,
    handleServerRequest,
    onConnectionReady,
    onGatewayReady,
    refreshHermesConfig,
    refreshSessions
  }

  useEffect(() => {

    const s = createGatewayBootState()

    const desktop = window.hermesDesktop

    // Window-state IPC (fullscreen / traffic-light position) that lands while
    // no connection is published — mid-boot, or between a dropped primary and
    // its fallback resolving — has nowhere to merge into. Main snapshots the
    // chrome state into each descriptor at mint time, so a toggle that happens
    // AFTER the mint but BEFORE the renderer publishes it is newer than the
    // snapshot and would otherwise be lost until the next toggle (#108641).
    let pendingWindowState: HermesWindowState | null = null

    const publish = (next: HermesConnection | null) => {
      if (next && pendingWindowState) {
        next = { ...next, ...pendingWindowState }
        pendingWindowState = null
      }

      callbacksRef.current.onConnectionReady(next)
      setConnection(next)
      desktop?.setActiveConnectionRoute?.(
        next
          ? {
              connectionId: next.connectionId ?? null,
              profile: next.profile,
              registryScoped: next.registryScoped === true
            }
          : null
      )
    }

    if (!desktop) {
      failDesktopBoot('Desktop IPC bridge is unavailable.')
      setSessionsLoading(false)

      return () => void (s.cancelled = true)
    }

    // Store-driven switches (Sessions switcher → selectConnection) commit
    // through beginGatewaySwitch(), which runs this window's machine-context
    // reset — the same one a Settings apply (softSwitch below) runs. One owner,
    // one reset, so the two doors can't drift apart again (#93937).
    const offSwitchLifecycle = registerGatewaySwitchLifecycle({
      beforeConnectionSwitch: () => callbacksRef.current.beforeConnectionSwitch(),
      refreshSessions: shouldPublish => callbacksRef.current.refreshSessions(shouldPublish)
    })

    const onBootProgress = (payload: DesktopBootProgress) => {
      if (s.cancelled) {
        return
      }

      // Soft switch / post-boot startHermes re-emits progress — ignore so the
      // cold-boot CONNECTING overlay stays down. A boot that ended in failure
      // is concluded too: replaying its steps would take the recovery overlay
      // back down. Post-boot errors are gated:
      // only confirmed reauth takes the full-screen recovery surface. Transient
      // ticket-mint / host-unreachable failures must stay in the reconnect loop
      // (otherwise a 1–3 min blip bricks reading/drafting behind "couldn't start").
      if ($gatewaySwitching.get() || s.bootCompleted || s.bootFailed) {
        if (payload.error && shouldApplyPostBootProgressError(payload.error)) {
          s.primaryReauthError = payload.error

          if (s.bootCompleted) {
            syncPrimaryReauthError()
          } else {
            applyDesktopBootProgress(payload)
          }
        }

        return
      }

      applyDesktopBootProgress(payload)
    }

    let bootSnapshotSuperseded = false

    const offBootProgress = desktop.onBootProgress(payload => {
      bootSnapshotSuperseded = true
      onBootProgress(payload)
    })

    void desktop
      .getBootProgress()
      .then(snapshot => {
        if (!bootSnapshotSuperseded && !gatewayOpen()) {
          onBootProgress(snapshot)
        }
      })
      .catch(() => undefined)

    setDesktopBootStep({
      phase: 'renderer.boot',
      message: translateNow('boot.steps.startingDesktopConnection'),
      progress: 6
    })

    // HMR adoption: in a dev hot update, the previous effect instance parked its
    // still-open socket instead of closing it (see the cleanup below). Re-adopt
    // it so an edit doesn't drop the live agent session. A stale (closed) parked
    // socket is discarded and we boot fresh. No-op in production: import.meta.hot
    // is undefined there, so this folds to `null` and the whole survivor module
    // dead-code-eliminates out of the bundle.
    const survivor = import.meta.hot ? takeGatewaySurvivor() : null
    const adoptedFromHmr = Boolean(survivor && !survivorIsStale(survivor))

    if (survivor && !adoptedFromHmr) {
      // Parked socket died between edits (e.g. backend restart) — release it.
      try {
        survivor.gateway.close()
      } catch {
        // ignore
      }
    }

    const gateway = adoptedFromHmr ? survivor!.gateway : new HermesGateway()

    // Every socket this window owns (the primary below, every registry
    // secondary via onEvent) funnels through this one gate before any store
    // sees the event: two sockets to ONE backend both receive each frame of a
    // chat they joined, and handled twice a delta doubles the streaming text
    // (#120005). Keyed by the backend's own (epoch, session, seq) stamp.
    const eventDedupe = createGatewayEventDedupe()

    const deliverGatewayEvent = (event: GatewayEvent) => {
      if (!eventDedupe.admit(event)) {
        return
      }

      recordSessionEventScope(event)
      callbacksRef.current.handleGatewayEvent(event)
    }

    const reconnect = createGatewayBootReconnect({ s, desktop, gateway, callbacksRef, publish })

    const { softSwitch, boot, adoptBoot } = createGatewayBootPhases({
      s,
      desktop,
      gateway,
      callbacksRef,
      publish,
      survivor,
      reconnect
    })

    const {
      syncPrimaryReauthError,
      resetReconnectBackoff,
      clearBootRetryTimer,
      gatewayOpen,
      clearReconnectTimer,
      clearLivenessReprobeTimer,
      attemptReconnect,
      scheduleReconnect,
      reconnectNow,
      forceReconnectNow
    } = reconnect

    callbacksRef.current.onGatewayReady(gateway)
    setPrimaryGateway(gateway, survivor?.profile ?? normalizeProfileKey($activeGatewayProfile.get()))
    // Secondary (background-profile) sockets funnel into the same handler.
    // Record each event's source scope first: registry-tagged events feed the
    // (connectionId, profile) keep-set so two sources exposing the same
    // profile name (every source has a 'default') can't collide.
    configureGatewayRegistry({
      onServerRequest: request => {
        if (!callbacksRef.current.handleServerRequest(request)) {
          request.fail(JSON_RPC_METHOD_NOT_FOUND, `Hermes Desktop cannot answer ${request.method}`)
        }
      },
      // The primary socket has no secondary entry to carry registry identity.
      // Electron's published active descriptor is authoritative after boot;
      // a true legacy primary has no connectionId and remains unqualified.
      activeConnectionId: () => $connection.get()?.connectionId ?? null,
      // Every dispose path in the registry (live-work pruner AND the
      // refcount-0 request leases) spares a socket a mounted tile, the
      // primary thread or a just-created session's owner hold is bound to
      // (#93892).
      foregroundScopes: foregroundSessionScopes,
      // Defined further down the effect body; read at call time, never during boot.
      liveScopes: () => liveWorkScopes(),
      onLocalProfileRetired: forgetProfileOnlyRuntimeOwners,
      onActiveConnectionChanged: publish,
      // Keep $activeGatewayProfile in lockstep with the registry's OWN record
      // of which profile the active socket serves. The registry is the only
      // party that sees eviction fallbacks (idle reap, connection removal,
      // profile delete → primary); before this mirror those fallbacks moved
      // the SOCKET back to the primary while the profile atom kept naming the
      // evicted bot. ensureGatewayProfile's "already active" fast path then
      // trusted the stale atom and skipped the re-swap, so every
      // session-scoped RPC for that bot went out on the primary socket — the
      // #89206 "Waking up… → retries gave up" wake failure, while the bot's
      // own backend sat healthy and idle.
      onActiveRouteChanged: profile => {
        const key = normalizeProfileKey(profile)

        if (normalizeProfileKey($activeGatewayProfile.get()) !== key) {
          $activeGatewayProfile.set(key)
        }
      },
      onEvent: deliverGatewayEvent,
      onActiveConnectionInvalidated: (fallbackProfile, invalidationEpoch) => {
        $activeGatewayProfile.set(fallbackProfile)
        // Bounded like every other getConnection() call in this file (#93454):
        // an eviction fallback (idle reap, connection removal, profile delete)
        // must not latch the profile atom to a connection that never resolves
        // if the main-process IPC round-trip wedges.
        void withTimeout(
          desktop.getConnection(fallbackProfile),
          RECONNECT_ATTEMPT_TIMEOUT_MS,
          'Timed out resolving the fallback gateway connection'
        )
          .then(connection => {
            if (!s.cancelled && gatewayActivationEpoch() === invalidationEpoch) {
              publish(connection)
            }
          })
          .catch(() => {
            if (!s.cancelled && gatewayActivationEpoch() === invalidationEpoch) {
              publish(null)
            }
          })
      }
    })

    const offActiveGatewayReauth = $gateway.listen(syncPrimaryReauthError)
    const offActiveStateReauth = $gatewayState.listen(syncPrimaryReauthError)

    const offState = gateway.onState(st => {
      // Mirror to the composer only while the primary is the active profile —
      // a background secondary reconnect mustn't flip the foreground state.
      reportPrimaryGatewayState(st)

      if (st === 'open') {
        bootSnapshotSuperseded = true
        openedAt = Date.now()
        s.reauthNotified = false
        s.primaryReauthError = null
        s.livenessProbeFailures = 0
        clearReconnectTimer()
        clearLivenessReprobeTimer()

        // A revalidate-driven reconnect can rebuild the backend in place when the
        // cached remote was found dead, which re-drives the boot-progress overlay.
        // Unlike the initial boot, nothing calls completeDesktopBoot() afterwards,
        // so dismiss it here once we're open again — otherwise the overlay sticks
        // at ~94%. A no-op on a normal (non-rebuild) reconnect.
        if (s.bootCompleted) {
          completeDesktopBoot()
        }
      } else if (st === 'closed' || st === 'error') {
        if (isStableOpen(openedAt)) {
          resetReconnectBackoff()
        }

        // The connected→disconnected edge after a healthy boot, not a switch or our own manual close.
        if (openedAt !== null && s.bootCompleted && !$gatewaySwitching.get() && s.ownCloseReason !== 'manual') {
          noteBackendDrop(s.ownCloseReason === 'timeout' ? 'timeout' : null)
        }

        s.ownCloseReason = null
        openedAt = null

        if (s.bootCompleted && !$gatewaySwitching.get()) {
          // The socket dropped after a healthy boot (typically sleep/wake). Try
          // to bring it back instead of leaving the composer stuck disabled.
          scheduleReconnect()
        }
      }
    })

    // Read PER EVENT, never once at boot: under multiplex-only this one socket
    // serves every local profile, and the profile moves under it while the
    // socket stays open. A boot-time capture stamps every later profile's
    // events with whatever was active when the gateway booted.
    const sourceProfileNow = () => normalizeProfileKey($activeGatewayProfile.get())

    const offEvent = gateway.onEvent(event => {
      const connectionId = activeGatewayConnectionId()
      const sourceProfile = sourceProfileNow()

      const scopedEvent = {
        ...event,
        profile: sourceProfile,
        ...(connectionId ? { connectionId } : {})
      }

      // On a shared host backend the socket no longer PROVES the profile the
      // way a pooled secondary's closure did, so nothing stamps ownership and
      // runtimeSessionOwner() stays blank for every non-primary local profile
      // — the live sessions/cron sync dies and falls back to slow polling.
      // The shared-primary descriptor is exactly the topology where the active
      // profile is the authority for this socket's traffic. (The marker is the
      // LAST rung of knownOwnerForSession, so durable stored identity still
      // outranks it — #97511.)
      const ownedEvent =
        $connection.get()?.sharedPrimary === true ? stampSecondaryProfileOwner(scopedEvent, sourceProfile) : scopedEvent

      deliverGatewayEvent(ownedEvent)
    })

    // Secondary sockets reach the same handler through the registry's onServerRequest.
    const offRequest = gateway.onRequest(request => dispatchPrimaryServerRequest(request, sourceProfileNow()))


    // Wall-clock of the current socket's 'open'; null while not open.
    // reconnectAttempt, reconnectFailingSince and escalated reset only once an
    // open proves stable (isStableOpen), judged when the socket closes.
    let openedAt: number | null = null

    const offPowerResume = desktop.onPowerResume?.(() => void forceReconnectNow())
    const offConnectionApplied = desktop.onConnectionApplied?.(() => void softSwitch())

    const offGatewayReconnect = registerGatewayReconnect(async () => {
      if (s.cancelled || !s.bootCompleted || $gatewaySwitching.get()) {
        return
      }

      // Explicit recovery targets the route the user is viewing, not every
      // warm profile. A responsive ping does not prove delivery is unstuck.
      if (!isActivePrimary()) {
        activeGateway()?.close()

        if (!(await ensureActiveGatewayOpen({ explicit: true }))) {
          throw new Error('Hermes gateway is not connected')
        }

        return
      }

      // Only explicit recovery may retry a credential that requires sign-in.
      s.primaryReauthError = null
      s.reauthNotified = false
      s.ownCloseReason = 'manual'
      gateway.close()
      clearReconnectTimer()
      resetReconnectBackoff()
      await attemptReconnect({
        profile: normalizeProfileKey($activeGatewayProfile.get()),
        activationEpoch: gatewayActivationEpoch()
      })
    })

    // Registry lifecycle: a removed connection's secondaries must close NOW
    // (remote/cloud have no local process whose death would drop the socket —
    // they'd keep streaming ghost events); a materially edited one is
    // disposed AND re-dialed so its sockets target the new endpoint.
    const offConnectionsChanged = desktop.connections?.onChanged?.(payload => {
      if (!payload || typeof payload.connectionId !== 'string') {
        return
      }

      // 'saved' is a pure registry-refresh push (new connection or label
      // rename — #95393): no endpoint moved, so there is nothing to dispose,
      // redial, or forget. useConnectionsRegistry re-pulls the snapshot.
      if (payload.reason === 'saved') {
        return
      }

      disposeSecondariesForConnection(payload.connectionId, { redial: payload.reason === 'updated' })

      if (payload.reason !== 'updated') {
        // Nothing can dial the removed source again: drop the persisted exact
        // owner hints naming it so its sessions are not pinned (fail-closed)
        // to a route that no longer exists.
        forgetSessionOwnerHintsForConnection(payload.connectionId)
      }
    })

    // Cooperative pool retirement: main is stopping a pooled backend so a
    // foreground open elsewhere gets its slot. Park the scopes riding it now,
    // before the socket drops, so neither the 'closed' state nor the next
    // focus/wake nudge redials into the slot it vacated. The tile keeps its
    // card; the next click on it re-arms the scope.
    const offPoolRetiring = desktop.onPoolBackendRetiring?.(payload => {
      if (payload && typeof payload.poolKey === 'string') {
        parkSecondariesForRetiredBackend(payload.poolKey)
      }
    })

    const onOnline = () => void forceReconnectNow()

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void reconnectNow()
      }
    }

    const onFocus = () => void reconnectNow()

    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    // Focus nudge: Electron keeps document 'visible' while unfocused, and a
    // macOS wake often restores focus without a visibilitychange — without
    // this a socket dropped during sleep sits closed until the user clicks.
    window.addEventListener('focus', onFocus)

    // Pool limits are main-process state; mirror them once for the Settings
    // rows and prewarmProfileBackend's saturation guard.
    void loadPoolLimits()

    // Keep live pool backends alive while this window is open (the main process
    // can't observe the direct renderer↔backend WS). No-op for the primary.
    const keepaliveTimer = setInterval(() => {
      touchActiveGatewayBackend()
      touchSecondaryGateways()
      // The pruner is otherwise event-driven: a socket spared by the
      // min-lifetime grace with no store change afterwards would hold its
      // pool slot forever.
      recomputeKeptGateways()
    }, 60_000)

    // Bound concurrency cost to consumers: keep a background socket while its
    // profile has a running (working) or blocked (needs-input) session, OR an
    // open owner-routed tile (Bot chats stay on a secondary while chrome stays
    // on the launch profile). Once the last consumer leaves, the socket drops
    // and its backend is free to idle-reap. The active profile is always spared.
    // Do not key this off `entry.retained` — that flag only skips dispose-after-
    // RPC; idle prune is what reclaims hover-warmed sockets after you leave.
    // Scopes with a running or needs-input session: registry-scoped
    // (connectionId, profile) keys plus the bare profile of every live local
    // session. Two sources can expose the same profile name (every source has
    // a 'default'), so bare profile names can't represent a non-local
    // source's liveness without keeping the wrong gateway alive. Feeds the
    // pruner's keep-set and the wake probe's in-flight-work signal.
    const liveWorkScopes = (): Set<string> => {
      const live = new Set([...$workingSessionIds.get(), ...$attentionSessionIds.get()])
      const scopes = liveSessionScopes()

      for (const session of $sessions.get()) {
        if (live.has(session.id)) {
          scopes.add(normalizeProfileKey(session.profile))
        }
      }

      return scopes
    }

    const recomputeKeptGateways = () => {
      const keep = new Set([...liveWorkScopes(), ...foregroundSessionScopes()])

      for (const scope of openTileGatewayScopes()) {
        keep.add(scope)
      }

      // A just-created session's owner hold and every open pane's owner ride
      // in through foregroundSessionScopes above; the registry ALSO reads that
      // set itself (its `foregroundScopes` hook) so the refcount-0 lease
      // releases agree with this pruner. This recompute only has to RUN when
      // they change — see the tile / selected session / hold subscriptions.
      pruneSecondaryGateways(keep)
    }

    const offWorking = $workingSessionIds.subscribe(() => recomputeKeptGateways())
    const offAttention = $attentionSessionIds.subscribe(() => recomputeKeptGateways())
    const offActiveSession = $activeSessionId.subscribe(() => recomputeKeptGateways())
    const offSessionTiles = $sessionTiles.subscribe(() => recomputeKeptGateways())
    const offActiveProfile = $activeGatewayProfile.subscribe(() => recomputeKeptGateways())
    const offTiles = $sessionTiles.subscribe(() => recomputeKeptGateways())
    const offSelectedSession = $selectedStoredSessionId.subscribe(() => recomputeKeptGateways())
    const offSessionOwnerHolds = $sessionOwnerHoldRevision.subscribe(() => recomputeKeptGateways())

    const offWindowState = desktop.onWindowStateChanged?.(payload => {
      const current = $connection.get()

      if (current) {
        publish({ ...current, ...payload })
      } else {
        pendingWindowState = payload
      }
    })

    const offExit = desktop.onBackendExit(() => {
      if ($gatewaySwitching.get()) {
        return
      }

      noteBackendExited()

      // While the boot overlay is up it already shows the failure with its own
      // Retry, and the reconnect handler below is a no-op before boot completes
      // — a toast whose button does nothing would only mislead. Fail the
      // overlay and stop there.
      if ($desktopBoot.get().running || $desktopBoot.get().visible) {
        // Concludes the in-flight boot on its behalf, so it latches like the
        // catch blocks that conclude one.
        s.bootFailed = true
        failDesktopBoot(translateNow('boot.errors.backgroundExitedDuringStartup'))

        return
      }

      // Post-boot: the shell's restart intent recycles a local service via main
      // (or re-dials a remote one) and does not depend on this hook's
      // reconnect gate, unlike reconnectGateway().
      notify({
        kind: 'error',
        title: translateNow('boot.errors.backendStopped'),
        message: translateNow('boot.errors.backgroundExited'),
        durationMs: 0,
        action: {
          label: translateNow('boot.errors.restartHermes'),
          onClick: requestBackendRestart
        },
        secondaryAction: {
          label: translateNow('boot.errors.openLogs'),
          onClick: () => void desktop.revealLogs?.().catch(() => undefined)
        }
      })
    })



    if (adoptedFromHmr) {
      void adoptBoot()
    } else {
      void boot()
    }

    return () => {
      s.cancelled = true
      offSwitchLifecycle()
      endGatewaySwitch()
      clearReconnectTimer()
      clearBootRetryTimer()
      clearLivenessReprobeTimer()
      clearInterval(keepaliveTimer)
      offWorking()
      offAttention()
      offActiveSession()
      offSessionTiles()
      offActiveProfile()
      offTiles()
      offSelectedSession()
      offSessionOwnerHolds()
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      offPowerResume?.()
      offConnectionApplied?.()
      offConnectionsChanged?.()
      offPoolRetiring?.()
      offGatewayReconnect()
      offActiveGatewayReauth()
      offActiveStateReauth()
      offState()
      offEvent()
      offRequest()
      offExit()
      offWindowState?.()
      offBootProgress()

      // HMR teardown vs. real unmount. On a hot update we must NOT close the
      // socket — that's the whole bug. Detach this instance's listeners (their
      // closures capture the disposed module), park the still-open gateway, and
      // let the freshly loaded effect re-adopt it. Secondaries are owned by the
      // gateway store (HMR-stable module state), so they survive untouched.
      // Production: import.meta.hot is undefined, so this branch never runs and
      // the original destructive teardown below is byte-for-byte preserved.
      if (import.meta.hot && gateway.connectionState === 'open') {
        stashGatewaySurvivor({
          gateway,
          profile: survivor?.profile ?? $activeGatewayProfile.get(),
          connection: $connection.get()
        })

        return
      }

      closeSecondaryGateways()
      gateway.close()
      publish(null)
      callbacksRef.current.onGatewayReady(null)
      setPrimaryGateway(null)
      $gateway.set(null)
    }
  }, [])
}
