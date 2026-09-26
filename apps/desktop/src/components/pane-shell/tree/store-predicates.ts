import { registry } from '@/contrib/registry'

import { paneChrome } from './renderer/track-model'

export const isUncloseablePane = (paneId: string): boolean =>
  Boolean(paneChrome(registry.getArea('panes').find(c => c.id === paneId)).uncloseable)

/** Hide-only chrome tabs (sessions / Bots): excluded from every close verb —
 *  Close-others / Close-all sweeping the sessions strip must not take standing
 *  chrome with it. They hide through `setStripTabHidden` instead. */
export const isHideOnlyPane = (paneId: string): boolean =>
  Boolean(paneChrome(registry.getArea('panes').find(c => c.id === paneId)).hideOnly)

/** A pane that belongs to a CHAT tab strip — the workspace or a session tile.
 *  Chat surfaces only: this gates where a session may DOCK (drops, ⌘T's "+"),
 *  not which zones the generic tab verbs serve — that's `isMainStripPane`. */
export const isSessionStripPane = (paneId: string): boolean =>
  paneId === 'workspace' || paneId.startsWith('session-tile:')

/** Any MAIN-placement tile's pane — a session, a page, a preview. The zones
 *  these stack into are real tab strips, so the generic tab verbs (⌘W, ⌃Tab)
 *  must serve them all; keying on the session prefix left ⌘W and ⌃Tab dead
 *  over a Browser/page zone while ⌘1…⌘9 worked. Standing side chrome (files /
 *  sessions / terminal) isn't 'main', so those zones still fall through. */
export const isMainStripPane = (paneId: string): boolean =>
  paneChrome(registry.getArea('panes').find(c => c.id === paneId)).placement === 'main'

/** Whether a zone may receive a SESSION drop — an existing session dragged
 *  from the sidebar, or a brand-new one dropped from a create-drag ("New
 *  session" row, project "+" buttons, "New project" +). Any zone hosting a
 *  chat strip or another main tile qualifies; standing side chrome never does.
 *  The resolvers (session-drag.ts / new-session-drag.ts) and the zone overlay
 *  (tree-group.tsx) share this one truth, so every painted zone can commit
 *  and every denied zone stays dark — the two cannot drift apart again. */
export const hostsSessionDropTarget = (paneIds: readonly string[]): boolean =>
  paneIds.some(isSessionStripPane) || paneIds.some(isMainStripPane)
