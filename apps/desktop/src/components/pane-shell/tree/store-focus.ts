// KEYBOARD-REACHABLE TAB STRIPS
// Zone focus/hover tracking plus the verbs the strip toggles and
// Cmd+Alt-arrow cycling call.

import { atom } from 'nanostores'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { registry } from '@/contrib/registry'

import {
  findGroup,
  findGroupOfPane,
  type GroupNode,
  type TabStripMode
} from './model'
import { tabStripVisibleForZone } from './renderer/strip-visibility'
import { paneChrome } from './renderer/track-model'
import { $layoutTree } from './store-core'
import { activateTreePane, setTreeGroupTabStrip } from './store-moves'
import { $hiddenTreePanes, isCollapsePane, isMainStripPane, isSessionStripPane } from './store-visibility'

/** The zone the user last interacted with (clicked / focused into) — the ⌘W
 *  target when nothing is DOM-focused (activeElement is often `body` after a
 *  click lands on a non-focusable surface). Tracked by trackActiveTreeGroup. */
export const $activeTreeGroup = atom<null | string>(null)

/** Record the interacted zone (pointerdown / focusin). Idempotent. */
export function noteActiveTreeGroup(groupId: null | string) {
  if (groupId !== $activeTreeGroup.get()) {
    $activeTreeGroup.set(groupId)
  }
}

/** The zone the pointer is currently over, or null off every zone. Transient —
 *  it only OVERRIDES the focused zone while the mouse actually sits in one, so
 *  moving the pointer away reverts the tab verbs to real focus rather than
 *  stranding them on whatever the mouse last brushed past. */
export const $hoveredTreeGroup = atom<null | string>(null)

/** Record the hovered zone (pointerover / pointer leaving the window). Idempotent. */
export function noteHoveredTreeGroup(groupId: null | string) {
  if (groupId !== $hoveredTreeGroup.get()) {
    $hoveredTreeGroup.set(groupId)
  }
}

/** The zone every keyboard tab verb acts on, as an ELIGIBILITY LADDER: the
 *  hovered zone, else the focused one, else the workspace's. Each rung must
 *  satisfy `eligible` to claim the keys, so a pointer parked somewhere that
 *  can't serve the verb — the sidebar, the titlebar, a single-pane rail —
 *  hands off to the next rung instead of swallowing the keystroke. Hover-first
 *  is what makes ⌘1…⌘9 land in the pane you're pointing at without clicking
 *  into it; the rungs below are why the keys still work when you're pointing
 *  at nothing. One resolver so the number keys, ⌃Tab, and the ⌘W / ⌘T family
 *  can never disagree about which zone is "the" zone. */
export function tabTargetGroup(eligible: (group: GroupNode) => boolean): GroupNode | null {
  const tree = $layoutTree.get()

  if (!tree) {
    return null
  }

  for (const groupId of [$hoveredTreeGroup.get(), $activeTreeGroup.get()]) {
    const group = groupId ? findGroup(tree, groupId) : null

    if (group && eligible(group)) {
      return group
    }
  }

  const main = findGroupOfPane(tree, 'workspace')

  return main && eligible(main) ? main : null
}

const treeGroupOfEvent = (event: Event): null | string => {
  const el = event.target instanceof HTMLElement ? event.target : null

  return el?.closest<HTMLElement>('[data-tree-group]')?.dataset.treeGroup ?? null
}

/** Install the zone trackers (call once from the tree root). Records the
 *  `[data-tree-group]` under each pointerdown / focusin so ⌘W knows which
 *  zone's tab to close even when nothing is DOM-focused, and the one under the
 *  pointer so the tab verbs follow the mouse. */
export function trackActiveTreeGroup(): () => void {
  const trackActive = (event: Event) => {
    const groupId = treeGroupOfEvent(event)

    if (groupId) {
      noteActiveTreeGroup(groupId)
    }
  }

  // `pointerover` fires on every element boundary crossing (not every mouse
  // move), so leaving the panes for the titlebar reports null and the override
  // lifts on its own.
  const trackHover = (event: Event) => noteHoveredTreeGroup(treeGroupOfEvent(event))
  const clearHover = () => noteHoveredTreeGroup(null)

  window.addEventListener('pointerdown', trackActive, true)
  window.addEventListener('focusin', trackActive, true)
  window.addEventListener('pointerover', trackHover, true)
  document.documentElement.addEventListener('pointerleave', clearHover)
  window.addEventListener('blur', clearHover)

  return () => {
    window.removeEventListener('pointerdown', trackActive, true)
    window.removeEventListener('focusin', trackActive, true)
    window.removeEventListener('pointerover', trackHover, true)
    document.documentElement.removeEventListener('pointerleave', clearHover)
    window.removeEventListener('blur', clearHover)
  }
}

/** The zone the session-tab verbs (⌘T / ⌘⇧T / the strip's "+") act on: the
 *  first of hovered / focused / workspace that hosts a chat strip. Same ladder
 *  ⌘1…⌘9 indexes, so the number keys and the tab verbs can't disagree about
 *  which strip is "the" strip. A target parked in the sidebar / terminal /
 *  files must NOT retarget them — those zones fall through to main rather
 *  than letting ⌘T dock a session into the file tree. */
function focusedSessionGroup(): GroupNode | null {
  return tabTargetGroup(group => group.panes.some(isSessionStripPane))
}

/** The pane a NEW session tab should dock beside (⌘T): the focused chat zone's
 *  active session pane, else its first. Null when no zone hosts a chat strip —
 *  the caller falls back to the workspace. */
export function focusedSessionTabAnchor(): null | string {
  const group = focusedSessionGroup()

  if (!group) {
    return null
  }

  const active = group.active

  return active && isSessionStripPane(active) ? active : (group.panes.find(isSessionStripPane) ?? null)
}

/**
 * Keyboard slots (⌘1…⌘9, ⌃Tab) must index the SAME tabs the strip paints —
 * chrome-hidden panes (files in Focus layout), unregistered ones, and
 * narrow-collapsed collapsibles stay in `group.panes` but aren't chips. Walking
 * the raw array made ⌘2 land on what the strip called tab 1 after a hidden
 * pane sat earlier in the list (classic after-⌘W-shift offset).
 */
export function shownPanesInGroup(group: { panes: readonly string[] }): string[] {
  const hidden = $hiddenTreePanes.get()
  const registered = registry.getArea('panes')
  const paneFor = (id: string) => registered.find(c => c.id === id)

  return group.panes.filter(id => {
    const pane = paneFor(id)

    if (!pane) {
      return false
    }

    if (hidden.has(id)) {
      return false
    }

    // Match TreeGroup's paneShown for the narrow breakpoint — collapsible
    // panes drop out of the strip when the viewport collapses them.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.(SIDEBAR_COLLAPSE_MEDIA_QUERY).matches &&
      Boolean(paneChrome(pane).collapsible)
    ) {
      return false
    }

    return true
  })
}

/** Is this zone showing a tab strip right now? The store's adapter over the
 *  shared resolver — TreeGroup answers the same question from its own render
 *  inputs, so the toggle command and the strip on screen cannot disagree about
 *  which way "toggle" points. */
export function tabStripVisibleForGroup(group: GroupNode): boolean {
  const registered = registry.getArea('panes')
  const shown = shownPanesInGroup(group)

  return tabStripVisibleForZone({
    active: group.active,
    isCollapsePane,
    mode: group.tabStrip,
    paneFor: (id: string) => registered.find(c => c.id === id),
    shown
  })
}

/** Shared target for tab-number hints and shortcut dispatch. */
export function treeTabSlotTarget(): GroupNode | null {
  return tabTargetGroup(candidate => shownPanesInGroup(candidate).length >= 2)
}

/** ⌘1…⌘9: activate the Nth *visible* tab of the target zone — the first of
 *  hovered / focused / workspace that is a real tab strip (≥2 shown panes).
 *  Pointing at the sidebar (or nothing) therefore still switches main's tabs
 *  instead of dead-ending. Returns the activated pane id — the caller needs to
 *  know when the slot landed on the workspace tab (a full page covering it
 *  must also route back to the chat) — or null so it falls back to its
 *  default (profile switch) when no zone qualifies. */
export function activateTreeTabSlot(slot: number): null | string {
  const group = treeTabSlotTarget()
  const panes = group ? shownPanesInGroup(group) : []

  if (!group || slot < 1 || slot > panes.length) {
    return null
  }

  activateTreePane(group.id, panes[slot - 1])

  return panes[slot - 1]
}

/** ⌃Tab / ⌃⇧Tab: cycle the target zone's *visible* tabs (wrapping) — the first
 *  of hovered / focused / workspace that is a tile strip with ≥2 shown tabs
 *  (any main-placement tenant: sessions, pages, previews). Returns the
 *  activated pane id (see `activateTreeTabSlot` — landing on the workspace
 *  under a full page must route back to the chat), or null so the caller
 *  falls back to the recent-session switcher when no zone qualifies. */
export function cycleTreeTabInFocusedZone(direction: 1 | -1): null | string {
  const group = tabTargetGroup(candidate => {
    const shown = shownPanesInGroup(candidate)

    return shown.length >= 2 && shown.some(isMainStripPane)
  })

  if (!group) {
    return null
  }

  const panes = shownPanesInGroup(group)

  // Active may itself be hidden (Files collapsed mid-cycle) — treat it as
  // missing so the step starts from a real chip rather than landing on a ghost.
  const current = Math.max(0, panes.indexOf(group.active ?? ''))
  const idx = panes.includes(group.active ?? '') ? current : 0
  const nextId = panes[(idx + direction + panes.length) % panes.length]
  activateTreePane(group.id, nextId)

  // No strip repair here: cycling needs two shown tabs, which is exactly when
  // auto shows a strip anyway. The old force-show existed because a stray
  // double-tap could leave a multi-tab zone headerless; that gesture is gone,
  // and a zone the user deliberately set to `never` must not be argued with by
  // a keystroke that was only asked to change tabs.
  return nextId
}

/**
 * The zone `view.toggleTabStrip` and its ⌘K row act on: the first of hovered /
 * focused / workspace that renders panes at all. Deliberately the widest
 * eligibility of any tab verb — the whole point of the command is to reach a
 * zone showing no chrome, so it must not require the chrome it restores.
 */
const tabStripTargetGroup = () => tabTargetGroup(candidate => shownPanesInGroup(candidate).length > 0)

/** Is the toggle's target zone currently showing a strip? Null when no zone
 *  qualifies — the ⌘K row reads this to describe what pressing it will do. */
export function targetZoneTabStripVisible(): boolean | null {
  const group = tabStripTargetGroup()

  return group ? tabStripVisibleForGroup(group) : null
}

/** Flip the target zone's strip. Returns the mode written, or null when there
 *  was no zone to act on. */
export function toggleTargetZoneTabStrip(): TabStripMode | null {
  const group = tabStripTargetGroup()

  if (!group) {
    return null
  }

  // Toggle against what is ON SCREEN, not against the stored mode: a zone on
  // auto has no stored mode, and "toggle" means "do the other thing to what I
  // am looking at". Both outcomes are explicit, so the zone leaves auto either
  // way rather than drifting with its tab count afterwards.
  const next: TabStripMode = tabStripVisibleForGroup(group) ? 'never' : 'always'
  setTreeGroupTabStrip(group.id, next)

  return next
}
