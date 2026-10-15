import { useStore } from '@nanostores/react'
import { useMemo } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { useContributions } from '@/contrib/react/use-contributions'
import type { Contribution } from '@/contrib/types'
import { $interfaceMode, shownInMode } from '@/store/interface-mode'
import { applySidebarNavPrefs, SIDEBAR_NAV_PREFS_AREA } from '@/store/sidebar-nav'

import {
  ACTIVITY_ROUTE,
  type AppView,
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
    id: 'activity',
    label: '',
    icon: props => <Codicon name="pulse" {...props} />,
    route: ACTIVITY_ROUTE,
    keybindActionId: 'nav.activity',
    tier: 'advanced'
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
    id: 'messaging',
    label: '',
    icon: props => <Codicon name="comment" {...props} />,
    route: MESSAGING_ROUTE,
    keybindActionId: 'nav.messaging',
    tier: 'advanced'
  },
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

const BUILT_IN_NAV_IDS: ReadonlySet<string> = new Set(SIDEBAR_NAV.map(item => item.id))

/** A row a plugin contributed (its page lives in the plugin), not a built-in view. */
export function isContributedNavItem(item: SidebarNavItem): boolean {
  return !BUILT_IN_NAV_IDS.has(item.id)
}

/** Built-in rows whose id is the view they open. */
const VIEW_ROWS: ReadonlySet<string> = new Set<AppView>(['capabilities', 'messaging', 'artifacts', 'cron'])

/** Whether a nav row is the page on screen. Contributed rows light up at their own route. */
export function navItemActive(item: SidebarNavItem, currentView: AppView, pathname: string): boolean {
  if (VIEW_ROWS.has(item.id)) {
    return item.id === currentView
  }

  return currentView === 'extension' && Boolean(item.route) && pathname === item.route
}

function contributedNavRows(contributions: readonly Contribution[]): SidebarNavItem[] {
  return contributions.flatMap(c => {
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
  })
}

/** Built-ins plus contributed rows, filtered to the interface mode, with any
 *  plugin nav preferences (hide / re-order) applied at render. */
export function useSidebarNavItems(): SidebarNavItem[] {
  // Contributed nav rows (plugins pairing a page with a sidebar entry) render
  // below the built-ins with the same chrome; active = at their route.
  const navContributions = useContributions(SIDEBAR_NAV_AREA)

  const contributedNav = useMemo(() => contributedNavRows(navContributions), [navContributions])

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

/** Contributed plugin rows for the icon rail: every row regardless of `tier`
 *  (the rail shows plugin pages in both modes), with nav preferences applied. */
export function useRailPluginNavItems(): SidebarNavItem[] {
  const navContributions = useContributions(SIDEBAR_NAV_AREA)
  const navPrefs = useContributions(SIDEBAR_NAV_PREFS_AREA)

  return useMemo(
    () => applySidebarNavPrefs(contributedNavRows(navContributions), navPrefs),
    [navContributions, navPrefs]
  )
}
