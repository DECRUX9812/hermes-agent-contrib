/**
 * Key routing for the browser surfaces, kept pure so it can be tested.
 *
 * The app's shortcut layer listens on the window in the capture phase, before
 * anything in the browser sees a key. It already holds bare keys back while a
 * text field has focus and lets primary-modifier chords through (that is how
 * Cmd/Ctrl-K reaches the palette from anywhere). So the browser keeps its keys
 * by putting focus in a text field (the address bar, or the hidden key sink a
 * remote page types through), and these rules decide the rest:
 *
 *  - Esc in the floating window minimises it, unless something already
 *    handled it (the address bar cancelling an edit) or an IME is composing.
 *  - A remote page receives plain keys only: a chord with Cmd/Ctrl/Alt stays
 *    with the app, so the palette, tab and window shortcuts behave the same as
 *    everywhere else.
 */

export interface KeyLike {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey?: boolean
  defaultPrevented: boolean
  isComposing?: boolean
}

export function floatKeyAction(event: KeyLike): 'minimise' | 'none' {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) {
    return 'none'
  }

  if (event.altKey || event.ctrlKey || event.metaKey) {
    return 'none'
  }

  return 'minimise'
}

/** Keys the remote page understands as named keys (the rest are typed text). */
export const REMOTE_KEYS = new Set([
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape'
])

export type RemoteKeyRoute = 'key' | 'pass' | 'text'

/** What a key pressed on a remote page does. `floating`: Esc belongs to the window. */
export function remoteKeyRoute(event: KeyLike, floating: boolean): RemoteKeyRoute {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
    return 'pass'
  }

  if (event.key === 'Escape' && floating) {
    return 'pass'
  }

  if (event.key.length === 1) {
    return 'text'
  }

  return REMOTE_KEYS.has(event.key) ? 'key' : 'pass'
}
