import { $gateway } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { requestFreshSession } from '@/store/profile'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import { canOpenSessionInTerminal } from '@/store/windows'

import { runInTerminal } from '../store'

/**
 * Continue a chat in Hermes CLI inside the app's own terminal pane: the same
 * session the external verb resumes, as the classic `hermes --resume <id>` typed
 * into the embedded terminal, so the conversation, its history and its project sit in
 * one window. With no stored session yet it starts a fresh chat.
 */
export async function continueInHermesCli(
  sessionId: null | string,
  opts?: { cwd?: string; profile?: string }
): Promise<void> {
  if (!canOpenSessionInTerminal()) {
    return
  }

  try {
    const result = await window.hermesDesktop.openSessionInTerminal(sessionId ?? '', { ...opts, target: 'pane' })

    if (!result?.ok || !result.run) {
      throw new Error(result?.error || 'unknown error')
    }

    // One owner per chat: the desktop lets go of it first so the TUI can take
    // the session lease, and drops to a fresh draft rather than reclaim it.
    const runtimeId = $activeSessionId.get()

    if (sessionId && runtimeId && sessionId === $selectedStoredSessionId.get()) {
      await $gateway.get()?.request('session.close', { session_id: runtimeId })
      requestFreshSession()
    }

    runInTerminal(result.run)
  } catch (err) {
    notifyError(err, 'Could not open Hermes CLI')
  }
}
