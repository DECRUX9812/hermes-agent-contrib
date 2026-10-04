import {useCallback} from 'react'

import {prepareDefaultNewSession} from '@/app/session/new-session-route'
import {setWorkspaceScope} from '@/components/pane-shell/workspace-scope'

import {navigateToWorkspacePage, NEW_CHAT_ROUTE, sessionRoute, SETTINGS_ROUTE} from '../../../routes'
import type {SidebarNavItem} from '../../../types'

import type { SessionActionHandles, SessionActionsOptions } from './options'

export function useOpenActions(
  { navigate, selectedStoredSessionId }: SessionActionsOptions,
  { startFreshSessionDraft }: Pick<SessionActionHandles, 'startFreshSessionDraft'>
) {
  const selectSidebarItem = useCallback(
    (item: SidebarNavItem) => {
      if (item.action === 'new-session') {
        prepareDefaultNewSession()
        setWorkspaceScope('sessions')
        startFreshSessionDraft()

        return
      }

      if (item.route) {
        navigateToWorkspacePage(navigate, item.route)
      }
    },
    [navigate, startFreshSessionDraft]
  )

  const openSettings = useCallback(() => {
    navigate(SETTINGS_ROUTE)
  }, [navigate])

  const closeSettings = useCallback(() => {
    if (selectedStoredSessionId) {
      navigate(sessionRoute(selectedStoredSessionId))

      return
    }

    navigate(NEW_CHAT_ROUTE)
  }, [navigate, selectedStoredSessionId])

  return {
    selectSidebarItem,
    openSettings,
    closeSettings,
  }
}
