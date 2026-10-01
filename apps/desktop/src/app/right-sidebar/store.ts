import { atom } from 'nanostores'

import { persistBoolean, storedBoolean } from '@/lib/storage'
import { modeBound } from '@/store/interface-mode'
import { notifyError } from '@/store/notifications'
import { canOpenSessionInTerminal } from '@/store/windows'

const TAKEOVER_KEY = 'hermes.desktop.terminalTakeover'

// Simple mode rests the terminal closed without touching this preference; ⌃`
// still brings it up for the session.
const $terminalTakeoverPref = atom(storedBoolean(TAKEOVER_KEY, false))

$terminalTakeoverPref.subscribe(active => persistBoolean(TAKEOVER_KEY, active))

export const $terminalTakeover = modeBound('terminalOpen', $terminalTakeoverPref, active =>
  $terminalTakeoverPref.set(active)
)

export const setTerminalTakeover = (active: boolean) => $terminalTakeover.set(active)

/** A command queued to run in the embedded terminal. The terminal pane flushes
 *  (and clears) it once its session is live, so a value set before the pane
 *  mounts still runs. Cleared after flush so a later remount can't replay it. */
export const $terminalInjection = atom<null | string>(null)

/** Open the terminal pane and run a command in it. Used to disconnect external
 *  (CLI-managed) providers, which Hermes can't clear via the API — the user
 *  sees exactly what runs instead of Hermes silently deleting their creds. */
export const runInTerminal = (command: string) => {
  const trimmed = command.trim()

  if (!trimmed) {
    return
  }

  setTerminalTakeover(true)
  $terminalInjection.set(trimmed)
}

/**
 * Continue a chat in Hermes CLI inside the app's own terminal pane: the same
 * `hermes --tui --resume <id>` the external verb runs, typed into the
 * embedded terminal, so the conversation, its history and its project sit in
 * one window. With no stored session yet it opens a fresh TUI.
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

    runInTerminal(result.run)
  } catch (err) {
    notifyError(err, 'Could not open Hermes CLI')
  }
}
