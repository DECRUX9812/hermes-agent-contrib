import { delay, inlineErrorMessage } from '@/app/session/hooks/use-prompt-actions/utils'
import type {
  HandoffFailResponse,
  HandoffRequestResponse,
  HandoffStateResponse
} from '@/app/types'
import type { MessagingPlatformInfo } from '@/hermes'
import { activeGateway } from '@/store/gateway'
import { notify } from '@/store/notifications'
import { $activeSessionId } from '@/store/session'
import { runGatewayRestart } from '@/store/system-actions'

/** Messaging platforms a handoff can target: enabled in the gateway with a home
 *  channel configured. Identity-published platforms (Telegram, Slack) lead so the
 *  phone-parity pair sits on top; the rest stay reachable for adapters that
 *  support handoff but don't publish a link yet. */
export function handoffTargets(platforms: readonly MessagingPlatformInfo[]): MessagingPlatformInfo[] {
  return platforms
    .filter(platform => platform.enabled && Boolean(platform.home_channel?.chat_id))
    .sort((a, b) => Number(Boolean(b.identity)) - Number(Boolean(a.identity)) || a.name.localeCompare(b.name))
}

export interface SessionHandoffCopy {
  failed: (error: string) => string
  queued: (platform: string, home: string) => string
  sessionUnavailable: string
  startMessaging: string
  success: (platform: string) => string
  timedOut: string
}

/** Queue a handoff of the ACTIVE session to a messaging platform and watch it to
 *  a terminal state — the same request + `handoff.state` poll the composer
 *  `/handoff` flow runs (handoffSession in use-prompt-actions), callable from a
 *  session row menu where the hook isn't in scope. Only writes the request; the
 *  gateway watcher performs the transfer, so this resolves via toasts. */
export async function runSessionHandoff(platform: string, copy: SessionHandoffCopy): Promise<void> {
  const sid = $activeSessionId.get()
  const gateway = activeGateway()

  if (!sid || !gateway) {
    notify({ kind: 'error', message: copy.sessionUnavailable })

    return
  }

  let request: HandoffRequestResponse

  try {
    request = await gateway.request<HandoffRequestResponse>('handoff.request', {
      platform,
      session_id: sid
    })
  } catch (err) {
    notify({ kind: 'error', message: inlineErrorMessage(err, copy.failed(platform)) })

    return
  }

  notify({ kind: 'info', message: copy.queued(platform, request.home_name || platform) })

  const deadline = Date.now() + 60_000

  while (Date.now() < deadline) {
    await delay(800)

    let record: HandoffStateResponse

    try {
      record = await gateway.request<HandoffStateResponse>('handoff.state', { session_id: sid })
    } catch {
      continue
    }

    const state = record.state || 'pending'

    if (state === 'completed') {
      notify({ kind: 'success', message: copy.success(platform) })

      return
    }

    if (state === 'failed') {
      notify({ kind: 'error', message: record.error || copy.failed(platform) })

      return
    }
  }

  const cleanup = await gateway
    .request<HandoffFailResponse>('handoff.fail', { error: copy.timedOut, session_id: sid })
    .catch(() => null)

  if (cleanup?.state === 'completed') {
    notify({ kind: 'success', message: copy.success(platform) })

    return
  }

  notify({
    action: { label: copy.startMessaging, onClick: () => void runGatewayRestart() },
    kind: 'error',
    message: copy.timedOut
  })
}
