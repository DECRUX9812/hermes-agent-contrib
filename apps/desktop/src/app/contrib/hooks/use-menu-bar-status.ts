import { useEffect } from 'react'

import { subscribeRuntimeI18nLocale } from '@/i18n/runtime'
import { buildMenuBarStatus } from '@/store/menu-bar-status'
import { $sessions } from '@/store/session'
import { $sessionDotStateById } from '@/store/session-dot-state'
import { isAuxiliaryWindow } from '@/store/windows'

/**
 * Feeds the menu-bar status surface (#38): the tray icon's badge, status line,
 * and recent-session menu are all pushed from here — the main process holds no
 * session state of its own, and no i18n catalog, so the whole payload (counts,
 * rows, localized strings) is rebuilt whenever the dot map, the session list,
 * or the display language changes.
 *
 * Primary window only: a secondary session window must not also publish, or
 * two renderers would fight over what the menu says.
 */
export function useMenuBarStatus(): void {
  useEffect(() => {
    if (isAuxiliaryWindow()) {
      return
    }

    const api = window.hermesDesktop?.menuBarStatus

    if (!api?.push) {
      return
    }

    const push = () => {
      api.push(buildMenuBarStatus($sessionDotStateById.get(), $sessions.get()))
    }

    push()

    const offDots = $sessionDotStateById.listen(push)
    const offSessions = $sessions.listen(push)
    const offLocale = subscribeRuntimeI18nLocale(push)

    return () => {
      offDots()
      offSessions()
      offLocale()
    }
  }, [])
}
