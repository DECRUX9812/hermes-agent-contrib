import { isGatewayReauthRequired } from '@hermes/shared'

import type { HermesConnection } from '@/global'

// After the reconnect loop has been failing for this long, raise a NON-blocking
// warning toast. Full-screen BootFailureOverlay used to lock the user out of
// reading/drafting for the whole blip even though the transcript is still on
// screen underneath. Confirmed reauth still escalates to the overlay (Sign in
// is required). Time-based (not attempt-count) because full-jitter backoff
// makes attempt counts a meaningless clock.
//
// 5 minutes (not the historical ~45s) so brief transport weather — ticket mint
// flaps, sleep/wake, Wi‑Fi blips that self-heal in 1–3 minutes — never even
// toast. Chat stays readable/draftable the whole time either way.
export const RECONNECT_ESCALATE_AFTER_MS = 300_000

// Bound for the sleep/wake liveness probe (see reconnectNow): long enough to
// ride out a busy-but-healthy backend's scheduling jitter, short enough that a
// half-open socket fails fast instead of hanging the wake path. Independent of
// PROMPT_SUBMIT_REQUEST_TIMEOUT_MS (30 min) — that long timeout is correct for
// an in-flight turn, but must never be what a dead connection burns. A probe
// TIMEOUT alone no longer tears the socket down mid-turn (#95327): while a
// turn is in flight the first timeout defers behind one bounded re-probe, so
// only a STREAK of unanswered pings rebuilds the transport.

// Renderer twin of the main process's POWER_RESUME_REVALIDATION_HOLDOFF_MS:
// forced wake reconnects (online / power resume) are coalesced into one per
// window instead of tearing down every secondary socket on each signal (#94769).
export const WAKE_RECONNECT_HOLDOFF_MS = 15_000

// Bounded self-heal for a failed REMOTE boot (#82679): main classifies every
// fault it can see (via getBootProgress().retryable); the renderer adds the one
// it cannot — a valid remote WebSocket dial that fails before becoming usable.
// The renderer re-attempts the whole boot with the same full-jitter backoff the
// post-boot reconnect loop uses, up to this many attempts. Retries are bounded
// and end in the real recovery affordance (the boot-failure overlay with
// Retry / Settings), never an infinite spinner. Local failures and confirmed
// reauth rejections never enter this loop.
export const BOOT_RETRY_MAX_ATTEMPTS = 5
// Base delay for boot retries. Deliberately slower than the socket reconnect
// loop's 300ms: each attempt may rebuild an SSH master + remote dashboard.
export const BOOT_RETRY_BASE_DELAY_MS = 2_000

// While any of the RECONNECT_ATTEMPT_TIMEOUT_MS-bounded awaits below is
// pending, `reconnecting` never clears, so scheduleReconnect()/
// attemptReconnect() early-return permanently and the backoff loop is
// latched — the UI stays "reconnecting" until the app is restarted even
// though the gateway is reachable again. gateway.connect() already has its
// own connect timeout.

/** Registry identity whose runtimes died with the primary connection. */
export function primaryRuntimeConnectionId(connection: Pick<HermesConnection, 'connectionId' | 'mode'>): null | string {
  const connectionId = connection.connectionId?.trim()

  if (connectionId) {
    return connectionId
  }

  return connection.mode === 'local' ? 'local' : null
}

// A freshly spawned backend can block its event loop for 15-30s while it
// connects MCP servers and discovers plugins, so a single initial connect
// attempt races backend cold-start and loses intermittently — the renderer
// surfaced "Could not connect to Hermes gateway" even though the backend
// became healthy moments later (#49645). Retry the initial dial, re-minting
// the WS URL on every attempt (OAuth tickets are single-use), instead of
// failing the whole boot on the first transport error. Reauth failures
// propagate immediately: more attempts with a dead ticket can never
// succeed. Exported for tests.
export async function connectInitialGateway({
  attempts = 8,
  connect,
  delayMs = 3_000,
  initialUrl,
  isCancelled
}: {
  attempts?: number
  connect: (wsUrl?: string) => Promise<void>
  delayMs?: number
  /** URL already minted at the boot boundary; used for the first attempt so the mint count stays observable. */
  initialUrl?: string
  isCancelled: () => boolean
}): Promise<void> {
  let lastConnectError: unknown = null

  for (let attempt = 0; attempt < attempts && !isCancelled(); attempt += 1) {
    try {
      await connect(attempt === 0 ? initialUrl : undefined)
      lastConnectError = null

      break
    } catch (err) {
      if (isGatewayReauthRequired(err)) {
        throw err
      }

      lastConnectError = err

      if (attempt < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  if (lastConnectError) {
    throw lastConnectError
  }
}
