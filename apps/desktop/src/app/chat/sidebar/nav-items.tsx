import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { useContributions } from '@/contrib/react/use-contributions'
import { $interfaceMode, shownInMode } from '@/store/interface-mode'
import { applySidebarNavPrefs, SIDEBAR_NAV_PREFS_AREA } from '@/store/sidebar-nav'

import {
  type AppView,
  ACTIVITY_ROUTE,
  ARTIFACTS_ROUTE,
  CAPABILITIES_ROUTE,
  CRON_ROUTE,
  MESSAGING_ROUTE,
  SIDEBAR_NAV_AREA,
  type SidebarNavContribution
} from '../../routes'
import type { SidebarNavItem } from '../../types'

// The app's destinations — the sidebar's New session + Browse rows and the
// icon rail read this one list, so a plugin's nav row or a nav preference
// lands in both.

// A row's `tier` is the one mode it belongs to (Simple keeps the setup rows,
// Advanced adds the readouts); the list filters once, nothing is passed down.
const SIDEBAR_NAV: SidebarNavItem[] = [
  {
    id: 'new-session',
    label: '',
    icon: props => <Codicon name="robot" {...props} />,
    action: 'new-session',
    keybindActionId: 'session.new'
  },
  {
    // No tier: Activity is the heartbeat of the app — it rides every mode.
    id: 'activity',
    label: '',
    icon: props => <Codicon name="pulse" {...props} />,
    route: ACTIVITY_ROUTE,
    keybindActionId: 'nav.activity'
  },
  {
    id: 'capabilities',
    label: '',
    icon: props => <Codicon name="symbol-misc" {...props} />,
    route: CAPABILITIES_ROUTE,
    keybindActionId: 'nav.capabilities',
    tier: 'advanced'
  },
  {
    // No tier: the rail's messaging sections render in Simple too, so the
    // door they open must ride every mode or a whole slice is stranded.
    id: 'messaging',
    label: '',
    icon: props => <Codicon name="comment" {...props} />,
    route: MESSAGING_ROUTE,
    keybindActionId: 'nav.messaging'
  },
  // Artifacts and Scheduled jobs are outputs of running Hermes the developer
  // way; Capabilities and Messaging are how anyone sets it up.
  {
    id: 'artifacts',
    label: '',
    icon: props => <Codicon name="files" {...props} />,
    route: ARTIFACTS_ROUTE,
    keybindActionId: 'nav.artifacts',
    tier: 'advanced'
  },
  {
    id: 'cron',
    label: '',
    icon: props => <Codicon name="watch" {...props} />,
    route: CRON_ROUTE,
    keybindActionId: 'nav.cron',
    tier: 'advanced'
  }
]

/** Built-in rows whose id is the view they open. */
const VIEW_ROWS: ReadonlySet<string> = new Set<AppView>(['capabilities', 'messaging', 'artifacts', 'cron'])

/** Whether a nav row is the page on screen. Contributed rows light up at their own route. */
export function navItemActive(item: SidebarNavItem, currentView: AppView, pathname: string): boolean {
  if (VIEW_ROWS.has(item.id)) {
    return item.id === currentView
  }

  return currentView === 'extension' && Boolean(item.route) && pathname === item.route
}

/** Built-ins plus contributed rows, filtered to the interface mode, with any
 *  plugin nav preferences (hide / re-order) applied at render. */
export function useSidebarNavItems(): SidebarNavItem[] {
  // Contributed nav rows (plugins pairing a page with a sidebar entry) render
  // below the built-ins with the same chrome; active = at their route.
  const navContributions = useContributions(SIDEBAR_NAV_AREA)

  const contributedNav = useMemo<SidebarNavItem[]>(
    () =>
      navContributions.flatMap(c => {
        const data = c.data as Partial<SidebarNavContribution> | undefined

        if (!data?.path?.startsWith('/') || !data.label) {
          return []
        }

        const codicon = data.codicon || 'plug'

        return [
          {
            id: c.id,
            label: data.label,
            icon: (props: { className?: string }) => <Codicon name={codicon} {...props} />,
            route: data.path,
            tier: data.tier
          }
        ]
      }),
    [navContributions]
  )

  const interfaceMode = useStore($interfaceMode)
  const navPrefs = useContributions(SIDEBAR_NAV_PREFS_AREA)

  return useMemo(
    () =>
      applySidebarNavPrefs(
        [...SIDEBAR_NAV, ...contributedNav].filter(item => shownInMode(interfaceMode)(item)),
        navPrefs
      ),
    [contributedNav, interfaceMode, navPrefs]
  )
}
