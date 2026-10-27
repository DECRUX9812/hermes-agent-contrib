/**
 * Route "open this page" requests into the in-app Browser instead of the
 * system browser.
 *
 * Webapp: `window.hermesDesktop` is a plain object, so `openPreviewInBrowser`
 * (the composer preview row's plain click — the stock jump-out) is wrapped to
 * open web URLs in the Browser. `openExternal` (chat links) is wrapped only
 * when the user turned "Open chat links here" on, and never for sign-in
 * pages, modifier clicks or links clicked inside a dialog — those keep the
 * stock new-tab behaviour. Every wrapper is restored on dispose.
 *
 * Desktop (Electron): the bridge is frozen, so a plain click on a preview row
 * is re-dispatched as the ⌘/Ctrl-click the row already understands (its
 * in-app pane) rather than leaving the app.
 */

import { browserAvailable, openInBrowser } from './open'
import { $linksHere } from './store'
import { isAuthUrl, isWebUrl } from './url'

type Bridge = Record<string, unknown> & {
  openExternal?: (url: string) => Promise<void> | void
  openPreviewInBrowser?: (url: string) => Promise<void> | void
}

const REDISPATCHED = Symbol.for('hermes-bots-plus.browser.redispatched')

let lastPointer = { at: 0, modified: false, inDialog: false }

function rememberPointer(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null

  lastPointer = {
    at: performance.now(),
    modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1,
    inDialog: Boolean(target?.closest('[role="dialog"],[role="alertdialog"]'))
  }
}

/** The click that led to this open, if it happened just now. */
function recentPointer() {
  return performance.now() - lastPointer.at < 1500 ? lastPointer : null
}

function keepOutside(url: string): boolean {
  const pointer = recentPointer()

  return !isWebUrl(url) || isAuthUrl(url) || Boolean(pointer?.modified) || Boolean(pointer?.inDialog)
}

function wrapBridge(bridge: Bridge): (() => void) | null {
  const descriptorsOk = ['openExternal', 'openPreviewInBrowser'].every(key => {
    const d = Object.getOwnPropertyDescriptor(bridge, key)

    return !d || (d.writable ?? false) || Boolean(d.set)
  })

  if (Object.isFrozen(bridge) || !descriptorsOk) {
    return null
  }

  const originalExternal = bridge.openExternal
  const originalPreview = bridge.openPreviewInBrowser

  try {
    if (typeof originalPreview === 'function') {
      bridge.openPreviewInBrowser = (url: string) => {
        if (browserAvailable() && !keepOutside(url)) {
          openInBrowser(url)

          return Promise.resolve()
        }

        return originalPreview.call(bridge, url)
      }
    }

    if (typeof originalExternal === 'function') {
      bridge.openExternal = (url: string) => {
        if ($linksHere.get() && browserAvailable() && !keepOutside(url)) {
          openInBrowser(url)

          return Promise.resolve()
        }

        return originalExternal.call(bridge, url)
      }
    }
  } catch {
    return null
  }

  return () => {
    try {
      if (originalPreview) {
        bridge.openPreviewInBrowser = originalPreview
      }

      if (originalExternal) {
        bridge.openExternal = originalExternal
      }
    } catch {
      // A host that froze the bridge after we patched it keeps our wrapper,
      // which falls through to the originals once the browser is disposed.
    }
  }
}

/** Electron: a plain click on a composer preview row becomes a ⌘/Ctrl-click. */
function onPreviewRowClick(event: MouseEvent) {
  if ((event as unknown as Record<symbol, boolean>)[REDISPATCHED] || event.button !== 0) {
    return
  }

  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }

  const target = event.target instanceof Element ? event.target : null
  const row = target?.closest('[data-slot="composer-status-stack"] .status-artifacts > *')

  // Only the row's label or globe — never its dismiss button.
  if (!row || !target?.closest('.codicon-globe, .truncate')) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const isMac = /mac/i.test(navigator.platform)

  const replay = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: !isMac,
    metaKey: isMac,
    view: window
  })

  ;(replay as unknown as Record<symbol, boolean>)[REDISPATCHED] = true
  target.dispatchEvent(replay)
}

export function installBrowserIntercept(): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  window.addEventListener('pointerdown', rememberPointer, true)
  window.addEventListener('auxclick', rememberPointer, true)

  const bridge = (window as unknown as { hermesDesktop?: Bridge }).hermesDesktop
  const restore = bridge ? wrapBridge(bridge) : null
  const electron = !restore

  if (electron) {
    window.addEventListener('click', onPreviewRowClick, true)
  }

  return () => {
    window.removeEventListener('pointerdown', rememberPointer, true)
    window.removeEventListener('auxclick', rememberPointer, true)

    if (electron) {
      window.removeEventListener('click', onPreviewRowClick, true)
    }

    restore?.()
  }
}
