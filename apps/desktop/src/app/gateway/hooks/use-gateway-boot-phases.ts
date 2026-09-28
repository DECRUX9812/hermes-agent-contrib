import { isGatewayWebSocketUrl, reconnectBackoffDelayMs } from '@hermes/shared'

import type { HermesConnection } from '@/global'
import type { HermesGateway } from '@/hermes'
import { translateNow } from '@/i18n'
import { desktopDefaultCwd } from '@/lib/desktop-fs'
import { resolveDesktopGatewayWsUrl } from '@/lib/gateway-ws-url'
import { BACKEND_BOOT_WAIT_TIMEOUT_MS, RECONNECT_ATTEMPT_TIMEOUT_MS, withTimeout } from '@/lib/with-timeout'
import {
  completeDesktopBoot,
  failDesktopBoot,
  resumeDesktopBootForRetry,
  setDesktopBootStep
} from '@/store/boot'
import {
  closeLegacySecondaryGateways,
  ensureGatewayForProfile,
  reportPrimaryGatewayState,
  setPrimaryGateway,
  setPrimaryGatewayConnection
} from '@/store/gateway'
import {
  $gatewaySwitching,
  beginGatewaySwitch,
  endGatewaySwitch,
  isCurrentGatewaySwitch
} from '@/store/gateway-switch'
import { watchLocalRuntimeJobs } from '@/store/local-runtime-jobs'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile, normalizeProfileKey, refreshActiveProfile } from '@/store/profile'
import {
  $activeSessionId,
  $currentCwd,
  ensureDefaultWorkspaceCwd,
  setCurrentBranch,
  setCurrentCwd,
  setSessionsLoading
} from '@/store/session'
import { warnIfTerminalBackendUnavailable } from '@/store/terminal-backend-warning'
import { isPeerInstanceWindow, windowProfileOverride } from '@/store/windows'

import type { GatewaySurvivor } from './gateway-hmr-survivor'
import { BOOT_RETRY_BASE_DELAY_MS, BOOT_RETRY_MAX_ATTEMPTS, connectInitialGateway } from './use-gateway-boot-initial-connect'
import type { GatewayBootCallbacksRef, GatewayBootReconnect, GatewayBootState } from './use-gateway-boot-reconnect'

export interface GatewayBootPhaseDeps {
  s: GatewayBootState
  desktop: NonNullable<typeof window.hermesDesktop>
  gateway: HermesGateway
  callbacksRef: GatewayBootCallbacksRef
  publish: (next: HermesConnection | null) => void
  /** HMR-parked socket descriptor; null outside a hot update. */
  survivor: GatewaySurvivor | null
  reconnect: GatewayBootReconnect
}

// The boot phases: window-backend resolution, profile adoption, cwd seeding,
// the soft connection-switch apply, the cold boot handshake (with its bounded
// remote retry loop), and the HMR adopt path.
export function createGatewayBootPhases({ s, desktop, gateway, callbacksRef, publish, survivor, reconnect }: GatewayBootPhaseDeps) {
  const { clearBootRetryTimer, clearLivenessReprobeTimer, clearReconnectTimer, resetReconnectBackoff } = reconnect
  const { bootFailureIsRetryable } = reconnect

  // Adopt the profile the primary (window) backend booted as, so same-profile
  // resumes are no-op swaps and reconnects target the right backend.
  // Best-effort: a missing preference means "default". Shared by boot + soft
  // switch.
  //
  // Helper windows (the HUD) can carry an explicit profile override in their
  // URL: the HUD is opened ON a conversation, and when that conversation
  // belongs to a non-primary profile, adopting the primary here resolves the
  // session id against the wrong backend — the HUD then falls back to the
  // default profile's last session (#82285). The override wins over the
  // stored preference; absent, behavior is unchanged.
  async function getWindowBackend(startup = false): Promise<HermesConnection> {
    const profile = windowProfileOverride()
    const peer = isPeerInstanceWindow()

    const route = profile
      ? { profile, connectionId: peer ? new URLSearchParams(window.location.search).get('connectionId') : null }
      : startup && !peer
        ? await desktop.profile?.getDefault?.()
        : null

    // Initial registry publication can precede boot. Resolve captured launch
    // intent explicitly rather than through that still-initializing mirror.
    if (route?.connectionId && desktop.getConnectionFor) {
      return desktop.getConnectionFor(route)
    }

    return desktop.getConnection(route?.profile ?? undefined)
  }

  async function adoptPrimaryProfile(
    connection: HermesConnection,
    shouldPublish: () => boolean = () => true
  ): Promise<boolean> {
    // The resolved descriptor reflects the explicit startup default. The
    // legacy profile.get preference only remembers the last workspace used.
    const override = windowProfileOverride() ?? connection.profile

    try {
      const profileKey = override ?? (await desktop.profile?.get?.())?.profile ?? ''

      if (!shouldPublish()) {
        return false
      }

      const key = normalizeProfileKey(profileKey)
      $activeGatewayProfile.set(key)
      setPrimaryGateway(gateway, key)
      void ensureGatewayForProfile(key)
    } catch {
      if (!shouldPublish()) {
        return false
      }

      $activeGatewayProfile.set(normalizeProfileKey(override))
    }

    return true
  }

  // Seed the working dir from the backend default on a fresh view (nothing
  // open yet). Shared by boot + soft switch.
  async function seedDefaultCwd(shouldPublish: () => boolean = () => true) {
    await ensureDefaultWorkspaceCwd(shouldPublish)

    if (!shouldPublish()) {
      return
    }

    const remoteDefault = await desktopDefaultCwd().catch(() => null)

    if (shouldPublish() && remoteDefault?.cwd && !$activeSessionId.get() && !$currentCwd.get()) {
      setCurrentCwd(remoteDefault.cwd)
      setCurrentBranch(remoteDefault.branch || '')
    }
  }

  // Soft gateway-mode apply: main tore down the primary without reloading.
  // Wipe session lists so skeletons retrigger, then re-dial in place.
  const softSwitch = async () => {
    if (s.cancelled) {
      return
    }

    let switchToken: null | ReturnType<typeof beginGatewaySwitch> = null

    try {
      // Barrier up + machine-context reset + session wipe, in one synchronous
      // step — the shared commit point of every connection switch. Keep this
      // inside the error boundary: lifecycle/wipe setup can throw before a
      // token is returned and must follow the normal boot-failure path.
      switchToken = beginGatewaySwitch()
      const ownsSwitch = () => !s.cancelled && switchToken !== null && isCurrentGatewaySwitch(switchToken)
      clearReconnectTimer()
      clearBootRetryTimer()
      clearLivenessReprobeTimer()
      s.livenessProbeFailures = 0
      s.bootRetryAttempt = 0
      resetReconnectBackoff()
      s.reauthNotified = false
      s.primaryReauthError = null
      s.bootFailed = false

      gateway.close()
      // The primary mode is changing, but registered v2 sources remain
      // independent gateways. Retire only legacy profile sockets whose
      // routing follows connection.json; closing every secondary here
      // detached valid registered sessions and armed ws_orphan_reap.
      closeLegacySecondaryGateways()

      // Same override rule as boot(): a profile-pinned helper window stays
      // on its pinned profile's backend across a soft switch.
      // Bounded for the same reason as attemptReconnect() (#93454): a wedged
      // main-process round-trip must not latch $gatewaySwitching stuck —
      // the `finally` below only runs once this promise settles. Uses the
      // shared backend-boot budget rather than the reconnect budget because
      // ensureBackend may cold-spawn a pooled helper backend here.
      const conn = await withTimeout(
        getWindowBackend(),
        BACKEND_BOOT_WAIT_TIMEOUT_MS,
        'Timed out s.reconnecting to Hermes backend'
      )

      if (!ownsSwitch()) {
        return
      }

      publish(conn)
      setPrimaryGatewayConnection(conn)

      // Bounded for the same reason as attemptReconnect() (#93454): a wedged
      // ticket mint would otherwise hang the gateway switch forever.
      const wsUrl = await withTimeout(
        resolveDesktopGatewayWsUrl(desktop, conn),
        RECONNECT_ATTEMPT_TIMEOUT_MS,
        'Timed out re-minting the gateway WebSocket URL'
      )

      if (!ownsSwitch()) {
        return
      }

      await gateway.connect(wsUrl)

      if (!ownsSwitch()) {
        return
      }

      // Same shape as boot(): profile first (session scope depends on it),
      // then the independent fetches concurrently. refreshActiveProfile is
      // explicit here: the rail's $profiles still shows the PREVIOUS
      // backend's list after a connection/mode apply, and nothing else
      // re-pulls /api/profiles deterministically post-switch — leaving the
      // rail stale or (if a stale in-flight response landed) collapsed
      // (#85731). Best-effort like the rest: a failure keeps the cached
      // list rather than blanking the rail. NOT awaited: refreshProfiles
      // now carries a bounded retry chain (#70679), and switch completion
      // must not wait out backoff timers against an unhealthy backend.
      if (!(await adoptPrimaryProfile(conn, ownsSwitch)) || !ownsSwitch()) {
        return
      }

      void refreshActiveProfile().catch(() => undefined)

      await Promise.all([
        seedDefaultCwd(ownsSwitch),
        callbacksRef.current.refreshHermesConfig(false, ownsSwitch).catch(() => undefined),
        callbacksRef.current.refreshSessions(ownsSwitch).catch(() => undefined)
      ])

      if (!ownsSwitch()) {
        return
      }

      completeDesktopBoot()
      s.bootCompleted = true
      // Rediscover local-runtime jobs (model downloads, runtime installs)
      // that were running before a reload — the backend registry is the
      // authority; this just resumes following it.
      watchLocalRuntimeJobs()
      // A Docker/SSH terminal backend that fails its probe means shell
      // commands silently cannot run — say so once, with a way out.
      void warnIfTerminalBackendUnavailable()
    } catch (err) {
      const mayPublishFailure =
        !s.cancelled && (switchToken === null ? !$gatewaySwitching.get() : isCurrentGatewaySwitch(switchToken))

      if (mayPublishFailure) {
        const message = err instanceof Error ? err.message : String(err)
        s.bootFailed = true
        failDesktopBoot(message)

        // Only the current owner may lower loading. A failed begin returns no
        // token and cleans its own barrier internally; lower loading only when
        // that cleanup did not preserve a recursively-started newer switch.
        setSessionsLoading(false)

        notifyError(err, translateNow('boot.errors.desktopBootFailed'))
      }
    } finally {
      // beginGatewaySwitch cleans up internally when setup throws before
      // returning. Never use token-less teardown here: it would force down a
      // newer switch started synchronously by error recovery/notification UI.
      if (switchToken !== null) {
        endGatewaySwitch(switchToken)
      }
    }
  }

  async function boot() {
    // Where this boot attempt got to — a historical fact, not a late read of
    // gateway.connectionState. A socket can close after a successful dial;
    // later initialization errors must not be reclassified as boot dials.
    let stage: 'resolving' | 'minting' | 'dialing' | 'connected' = 'resolving'

    try {
      // A profile-pinned helper window (the HUD) dials its target profile's
      // backend directly — ensureBackend spawns/reuses it from the pool.
      // Full peers use the source/profile Electron pinned before loading.
      // Bounded like the reconnect path (#93454): a wedged main-process
      // round-trip must not hang "Starting Hermes…" forever. Initial boot
      // rides out a full backend cold spawn, so it gets the shared 45s
      // backend-boot budget, not the 20s reconnect budget.
      const conn = await withTimeout(
        getWindowBackend(true),
        BACKEND_BOOT_WAIT_TIMEOUT_MS,
        'Timed out connecting to Hermes backend'
      )

      if (s.cancelled) {
        return
      }

      stage = 'minting'

      setDesktopBootStep({
        phase: 'renderer.gateway.connect',
        message: translateNow('boot.steps.connectingGateway'),
        progress: 95
      })
      publish(conn)
      setPrimaryGatewayConnection(conn)

      // Seed the workspace BEFORE the gateway opens: every session-restore
      // path is gated on gatewayState === 'open', so nothing can be active yet
      // and ensureDefaultWorkspaceCwd's live-session guard passes. The
      // post-connect seed could lose that race on a slow start (#71873). A
      // resumed session's own cwd still supersedes this once its runtime
      // arrives. Non-fatal: the remembered cwd is a fine fallback and the
      // post-connect pass retries the sync.
      try {
        await ensureDefaultWorkspaceCwd()
      } catch (err) {
        console.warn('Failed to seed default workspace cwd pre-connect', err)
      }

      // Mint a fresh WS URL right before connecting. For OAuth gateways the
      // ticket is single-use with a short TTL, so the ticket baked into
      // conn.wsUrl is stale; resolveGatewayWsUrl() re-mints it rather than
      // connecting with a dead ticket. Auth rejection asks for sign-in. This
      // await is bounded like the reconnect path (#93454) so a wedged mint
      // reaches the recovery affordance instead of hanging "Starting Hermes…".
      const wsUrl = await withTimeout(
        resolveDesktopGatewayWsUrl(desktop, conn),
        RECONNECT_ATTEMPT_TIMEOUT_MS,
        'Timed out minting the gateway WebSocket URL'
      )

      // Only a valid WebSocket dial against a remote descriptor counts as a
      // transient renderer-side failure; URL and capability failures stay
      // terminal at their own boundaries.
      if (conn.mode === 'remote' && isGatewayWebSocketUrl(wsUrl)) {
        stage = 'dialing'
      }

      if (conn.mode === 'remote') {
        // REMOTE keeps the single dial: a remote dial failure must stay a
        // retryable boot failure (stage 'dialing') so the bounded boot-retry
        // loop below re-runs the whole handshake — including a fresh
        // getConnection() against a possibly-rebuilt tunnel.
        await gateway.connect(wsUrl)
      } else {
        // LOCAL retries the dial across backend cold-start (#49645): main's
        // readiness probe already passed, but a freshly spawned backend can
        // still stall its event loop for seconds on the first WS handshake —
        // a local boot failure is latched non-retryable, so without this
        // retry the one lost race ended the boot in "Could not connect to
        // Hermes gateway". The first attempt reuses the URL minted at the
        // boot boundary above — the mint count stays observable (#93454) —
        // while later attempts re-mint; local token URLs are long-lived, so
        // the re-mint is a cheap no-op.
        await connectInitialGateway({
          connect: async (attemptWsUrl?: string) => {
            const url =
              attemptWsUrl ??
              (await withTimeout(
                resolveDesktopGatewayWsUrl(desktop, conn),
                RECONNECT_ATTEMPT_TIMEOUT_MS,
                'Timed out minting the gateway WebSocket URL'
              ))

            await gateway.connect(url)
          },
          isCancelled: () => s.cancelled,
          initialUrl: wsUrl
        })
      }

      stage = 'connected'

      if (s.cancelled) {
        return
      }

      // Profile adoption must land first: refreshSessions scopes its fetch by
      // $profileScope ← $activeGatewayProfile. The remaining three fetches
      // (cwd seed, config, sessions) are independent REST calls — running
      // them serially added their sum to time-to-populated-sidebar when only
      // the max is needed.
      await adoptPrimaryProfile(conn)

      setDesktopBootStep({
        phase: 'renderer.config',
        message: translateNow('boot.steps.loadingSettings'),
        progress: 97
      })

      await Promise.all([
        // The pre-connect seed already applied the configured default; this
        // post-connect pass covers the remote backend default. Non-fatal: a
        // failed sync must not abort boot (the remembered cwd remains).
        seedDefaultCwd().catch(err => console.warn('Failed to sync default workspace cwd post-connect', err)),
        callbacksRef.current.refreshHermesConfig(),
        // Session-list population is never boot-fatal. The gateway WS is
        // already open by this point — a failed sidebar fetch (transient
        // blip, or an endpoint the fallback couldn't cover) must leave the
        // app usable with an empty sidebar (the reconnect/turn refreshes
        // retry it), not brick boot behind the "Hermes couldn't start"
        // overlay. Matches the reconnect + softSwitch call sites.
        callbacksRef.current.refreshSessions().catch(() => {
          setSessionsLoading(false)
        })
      ])

      if (s.cancelled) {
        return
      }

      completeDesktopBoot()
      s.bootCompleted = true
      s.bootRetryAttempt = 0
      // A Docker/SSH terminal backend that fails its probe means shell
      // commands silently cannot run — say so once, with a way out. Cold
      // launch is the common path, so it must warn too, not only softSwitch.
      void warnIfTerminalBackendUnavailable()
    } catch (err) {
      if (!s.cancelled) {
        const message = err instanceof Error ? err.message : String(err)

        // Main's classification (#82679) still decides every failure it can
        // see. The one it cannot see is the renderer-owned WebSocket dial:
        // after a renderer reload main serves its cached descriptor with a
        // stale `backend.ready / retryable:false` snapshot, so a remote dial
        // that never became usable is retryable on its own. Anything after a
        // successful dial keeps the terminal recovery surface.
        const canRetry = s.bootRetryAttempt < BOOT_RETRY_MAX_ATTEMPTS
        const retryable = canRetry && (stage === 'dialing' || (await bootFailureIsRetryable()))

        if (retryable && !s.cancelled) {
          const delay = reconnectBackoffDelayMs(s.bootRetryAttempt, { baseDelayMs: BOOT_RETRY_BASE_DELAY_MS })
          s.bootRetryAttempt += 1
          s.bootFailed = false
          resumeDesktopBootForRetry(translateNow('boot.steps.retryingRemoteBackend'))
          clearBootRetryTimer()
          s.bootRetryTimer = setTimeout(() => {
            s.bootRetryTimer = null
            void boot()
          }, delay)

          return
        }

        s.bootFailed = true
        failDesktopBoot(message)
        notifyError(err, translateNow('boot.errors.desktopBootFailed'))
        setSessionsLoading(false)
      }
    }
  }

  // Adopt the parked socket without re-running the full boot handshake: the
  // socket is already open, the backend session is untouched, and we already
  // know the profile. We only re-publish the connection, re-sync config +
  // sessions (cheap, and the backend may have moved on between edits), and
  // dismiss any boot overlay. This is what keeps a live, mid-stream session
  // intact across an HMR update.
  async function adoptBoot() {
    s.bootCompleted = true
    completeDesktopBoot()

    if (survivor?.connection) {
      publish(survivor.connection)
      setPrimaryGatewayConnection(survivor.connection)
    }

    const profile = survivor?.profile ?? $activeGatewayProfile.get()
    $activeGatewayProfile.set(profile)
    void ensureGatewayForProfile(profile)

    // Mirror the current (already-open) socket state into the composer so the
    // input doesn't sit disabled after the swap.
    reportPrimaryGatewayState(gateway.connectionState)

    await callbacksRef.current.refreshHermesConfig().catch(() => undefined)

    if (s.cancelled) {
      return
    }

    await callbacksRef.current.refreshSessions().catch(() => undefined)

    if (s.cancelled) {
      return
    }

    void warnIfTerminalBackendUnavailable()
  }

  return {
    getWindowBackend,
    adoptPrimaryProfile,
    seedDefaultCwd,
    softSwitch,
    boot,
    adoptBoot
  }
}
