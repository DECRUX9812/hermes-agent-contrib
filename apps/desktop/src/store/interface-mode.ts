/**
 * Interface mode — the app's one dial for chrome density.
 *
 *  - 'simple' (default): chat-first. Advanced panes (Capabilities, Messaging,
 *    Artifacts), power titlebar tools (layout editor, keybinds, haptics), and
 *    diagnostic statusbar items are tucked away. Nothing is removed — ⌘K,
 *    deep links, and Settings → Appearance all still reach them.
 *  - 'full': the complete power-user interface.
 *
 * Global scope, not per-session/per-profile: it describes how this user wants
 * THIS app's chrome to look, so it persists for the install.
 */

import { atom, computed } from 'nanostores'

import { persistString, storedString } from '@/lib/storage'

export type InterfaceMode = 'full' | 'simple'

const KEY = 'hermes.desktop.interface-mode.v1'

const read = (): InterfaceMode => (storedString(KEY) === 'full' ? 'full' : 'simple')

export const $interfaceMode = atom<InterfaceMode>(typeof window === 'undefined' ? 'simple' : read())

export const $simpleMode = computed($interfaceMode, mode => mode === 'simple')

export function setInterfaceMode(mode: InterfaceMode): void {
  $interfaceMode.set(mode)
}

export function toggleInterfaceMode(): void {
  setInterfaceMode($interfaceMode.get() === 'simple' ? 'full' : 'simple')
}

if (typeof window !== 'undefined') {
  $interfaceMode.subscribe(mode => persistString(KEY, mode))
}
