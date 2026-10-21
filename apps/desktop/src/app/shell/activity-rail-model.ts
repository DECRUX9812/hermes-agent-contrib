// The icon rail's behaviour, kept pure. Two kinds of entries share the rail:
// PANELS (Sessions, Bots) toggle the sidebar — VS Code's activity bar rule,
// where pressing the icon of the panel already showing folds it away — and
// PAGES (Capabilities, Messaging, …) navigate like the sidebar's nav rows.

export const SESSIONS_PANE = 'sessions'
export const BOTS_PANE = 'hermes-bots:pane'

export interface RailPanelState {
  sidebarOpen: boolean
  /** The panel's pane is the front tab of its (unminimized) zone. */
  paneShown: boolean
}

/** What pressing a panel icon does: fold the sidebar it is showing in, or bring it up. */
export function railPanelAction({ paneShown, sidebarOpen }: RailPanelState): 'fold' | 'show' {
  return sidebarOpen && paneShown ? 'fold' : 'show'
}

/** The entry the rail's indicator sits on: the page on screen wins (it is
 *  where you are), else the panel open beside it, else nothing. */
export function railActiveKey(
  activePage: null | string,
  panels: readonly { key: string; shown: boolean }[],
  sidebarOpen: boolean
): null | string {
  if (activePage) {
    return activePage
  }

  return (sidebarOpen && panels.find(panel => panel.shown)?.key) || null
}
