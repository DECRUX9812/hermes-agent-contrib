import { atom } from 'nanostores'

import { findGroup, findGroupOfPane, type GroupNode } from './model'
import { $layoutTree } from './store-core'

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
