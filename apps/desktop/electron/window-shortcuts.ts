/**
 * Window keyboard shortcuts claimed in the main process via
 * `before-input-event`: Ctrl/Cmd+W (close tab/preview), Ctrl/Cmd+R (preview
 * reload), and F12 / Ctrl+Shift+I (DevTools).
 *
 * The handlers live here — not inline in main.ts — so the chord matching can
 * be unit-tested without booting Electron: tests dispatch fake
 * `before-input-event` payloads against an EventEmitter-backed webContents.
 */

import type { BrowserWindow, Event, Input } from 'electron'

/** Dependencies main.ts owns; injected so the matchers stay pure/testable. */
export interface WindowShortcutDeps {
  /** True on macOS — switches the accelerator modifier from Ctrl to Cmd. */
  isMac: boolean
  /** Current "Disable F12" setting (main.ts owns persistence). */
  isF12Blocked: () => boolean
  toggleDevTools: (window: BrowserWindow) => void
  /** The live HUD window, or null — ⌘W there means "leave HUD mode". */
  getHudWindow: () => BrowserWindow | null
  closeHudWindow: () => void
  sendClosePreviewRequested: () => void
  sendPreviewNavCommand: (command: 'back' | 'forward' | 'reload') => void
}

export function installDevToolsShortcut(window: BrowserWindow, deps: WindowShortcutDeps): void {
  // Only Ctrl+Shift+I (or Cmd+Opt+I on Mac) opens DevTools.
  // F12 is explicitly blocked so Chromium's built-in handler doesn't open it.
  window.webContents.on('before-input-event', (event: Event, input: Input) => {
    // keyUp must never trigger a shortcut: a chord started in another window
    // delivers its keyUp here after a mid-chord focus transfer (#105498).
    if (input.type !== 'keyDown') {
      return
    }

    const key = input.key.toLowerCase()

    // F12 opens DevTools by default; block only when the user disabled it.
    if (input.key === 'F12') {
      if (deps.isF12Blocked()) {
        event.preventDefault()

        return
      }
      // Not blocked — fall through to open DevTools.
    }

    const isInspectShortcut =
      input.key === 'F12' ||
      (deps.isMac && input.meta && input.alt && key === 'i') ||
      (!deps.isMac && input.control && input.shift && key === 'i')

    if (!isInspectShortcut) {
      return
    }

    event.preventDefault()
    deps.toggleDevTools(window)
  })
}

export function installPreviewShortcut(window: BrowserWindow, deps: WindowShortcutDeps): void {
  window.webContents.on('before-input-event', (event: Event, input: Input) => {
    // keyUp must never trigger a shortcut: a chord started in another window
    // delivers its keyUp here after a mid-chord focus transfer (#105498).
    if (input.type !== 'keyDown') {
      return
    }

    const key = String(input.key || '').toLowerCase()
    const accel = (deps.isMac ? input.meta : input.control) && !input.alt
    const isCloseTabShortcut = key === 'w' && accel && !input.shift

    // Always claim ⌘W here (the File>Close item deliberately has no
    // accelerator, so nothing else does). The renderer decides tab-vs-window
    // — no `previewShortcutActive` gate, so it works for every closeable tab.
    if (isCloseTabShortcut) {
      event.preventDefault()

      // ⌘W in the HUD is "leave HUD mode", not "close a tab in the app
      // window". Routing it to the main renderer closed the app's tab out
      // from under the user while the HUD stayed put; routing it through the
      // HUD's own close path hands the session back like the exit button.
      const hudWindow = deps.getHudWindow()

      if (hudWindow && !hudWindow.isDestroyed() && window === hudWindow) {
        deps.closeHudWindow()

        return
      }

      deps.sendClosePreviewRequested()

      return
    }

    // ⌘R rides here rather than on the View menu item for the same reason:
    // the application menu only exists on macOS (it is set to null elsewhere,
    // see #77845), so a menu accelerator would leave Windows and Linux with no
    // way to reload a page at all. ⇧⌘R is left alone — that is `forceReload`,
    // the unconditional whole-window escape hatch.
    if (key === 'r' && accel && !input.shift) {
      event.preventDefault()
      deps.sendPreviewNavCommand('reload')
    }
  })
}
