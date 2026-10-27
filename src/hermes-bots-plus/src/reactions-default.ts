/**
 * Reactions on by default (bot-mode b2).
 *
 * Core keeps Settings › Appearance › Reactions opt-in: its atom reads
 * `hermes.desktop.reactions.v1` once at startup and treats "never set" as
 * off. Bot Mode wants them on, so it fills that unset value with "on" — and
 * only the unset value: a stored "off" (the user turned it off) or "on" is
 * left alone, so the setting still decides.
 *
 * The value is written as the window goes away (pagehide / beforeunload), not
 * at plugin start. Core reads the key at startup and, on every gateway
 * connect, re-sends the stored choice to `display.message_reactions`. A key
 * written mid-session would make that connect push send the still-false atom,
 * turning the agent side off right before the next load turns it on. Writing
 * on the way out means the next window starts with reactions on and pushes
 * "true" itself.
 */

export const REACTIONS_KEY = 'hermes.desktop.reactions.v1'

type KeyStore = Pick<Storage, 'getItem' | 'setItem'>

/** Fills an unset reactions preference with "on". True when it wrote. */
export function seedReactionsDefault(store: KeyStore | null | undefined): boolean {
  if (!store) {
    return false
  }

  try {
    if (store.getItem(REACTIONS_KEY) !== null) {
      return false
    }

    store.setItem(REACTIONS_KEY, 'on')

    return true
  } catch {
    // Storage blocked (private mode, quota): stock default applies.
    return false
  }
}

/** Seeds the default as the window unloads. Returns the disposer. */
export function installReactionsDefault(win: (Pick<Window, 'addEventListener' | 'removeEventListener'> & { localStorage?: KeyStore }) | undefined =
  typeof window === 'undefined' ? undefined : window): () => void {
  if (!win) {
    return () => {}
  }

  const seed = () => {
    let store: KeyStore | undefined

    try {
      store = win.localStorage
    } catch {
      store = undefined
    }

    seedReactionsDefault(store)
  }

  win.addEventListener('pagehide', seed)
  win.addEventListener('beforeunload', seed)

  return () => {
    win.removeEventListener('pagehide', seed)
    win.removeEventListener('beforeunload', seed)
  }
}
