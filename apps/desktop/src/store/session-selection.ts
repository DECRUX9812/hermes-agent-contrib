/**
 * Rail multi-select — the ⌘/⇧-click selection model behind the sessions
 * rail's bulk actions (pin / mute / tag / archive).
 *
 * Ephemeral on purpose: selection is pointer state like scroll position, so
 * nothing persists it to localStorage — a stale entry can't resurrect across
 * an app restart. Keys reuse the `["profile","durableId"]` JSON-pair
 * encoding the watch map and session tags already agree on, so a selection
 * rides out compression's id rotation exactly like they do, and profile
 * islands never share a row's identity.
 */
import { atom, computed } from 'nanostores'

import type { SessionInfo } from '@/hermes'
import type { SidebarListRow } from '@/lib/session-date-groups'

import { $cronSessions, $messagingSessions, $sessions, sessionPinId } from './session'
import { sessionTagKey } from './session-tags'

/** Same `["profile","durableId"]` JSON-pair convention as watch/tags. */
export const sessionSelectionKey = (profile: null | string | undefined, durableId: string): string =>
  sessionTagKey(profile, durableId)

export const selectionKeyForSession = (session: SessionInfo): string =>
  sessionSelectionKey(session.profile, sessionPinId(session))

export const $selectedSessionKeys = atom<ReadonlySet<string>>(new Set<string>())

/** The row a ⇧-click ranges FROM — the last row a plain or ⌘-click touched. */
const $selectionAnchorKey = atom<null | string>(null)

/** Decode a selection key back into its (profile, durableId) pair. */
export function parseSessionSelectionKey(key: string): null | { durableId: string; profile: string } {
  try {
    const parsed: unknown = JSON.parse(key)

    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { durableId: parsed[1], profile: parsed[0] }
    }
  } catch {
    // Not one of ours — never true for keys this module mints.
  }

  return null
}

export function isSessionKeySelected(key: string): boolean {
  return $selectedSessionKeys.get().has(key)
}

/** Plain click on a row: collapse the selection to just that row and
 *  re-anchor — the Finder rule for a no-modifier click. */
export function selectOnlySession(session: SessionInfo): void {
  const key = selectionKeyForSession(session)
  $selectedSessionKeys.set(new Set([key]))
  $selectionAnchorKey.set(key)
}

/** ⌘-click: flip the row in/out of the set; becomes the range anchor either
 *  way (a deselect still anchors — macOS keeps the click target as anchor). */
export function toggleSessionSelected(session: SessionInfo): void {
  const key = selectionKeyForSession(session)
  const next = new Set($selectedSessionKeys.get())

  if (!next.delete(key)) {
    next.add(key)
  }

  $selectedSessionKeys.set(next)
  $selectionAnchorKey.set(key)
}

/**
 * ⇧-click extends the anchor to this row over the caller's ordered row keys
 * (the visible list, divider rows excluded). `additive` (⌘⇧-click) unions the
 * range into the current selection instead of replacing it. The anchor does
 * not move on ⇧ — each successive ⇧-click re-ranges from the same anchor.
 * An anchor that isn't in this list (the click came from another surface)
 * falls back to the clicked row itself.
 */
export function applySessionRange(orderedKeys: readonly string[], session: SessionInfo, additive: boolean): void {
  const target = selectionKeyForSession(session)
  const targetIndex = orderedKeys.indexOf(target)

  if (targetIndex < 0) {
    return
  }

  let anchorIndex = orderedKeys.indexOf($selectionAnchorKey.get() ?? '')

  if (anchorIndex < 0) {
    anchorIndex = targetIndex
    $selectionAnchorKey.set(target)
  }

  const [from, to] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
  const range = orderedKeys.slice(from, to + 1)

  $selectedSessionKeys.set(additive ? new Set([...$selectedSessionKeys.get(), ...range]) : new Set(range))
}

export function clearSessionSelection(): void {
  $selectedSessionKeys.set(new Set())
  $selectionAnchorKey.set(null)
}

/** The session rows of a rendered list, in order — divider rows dropped.
 *  ⇧-click ranges are measured over this sequence. */
export const listRowSelectionKeys = (rows: readonly SidebarListRow[]): string[] =>
  rows.flatMap(row => (row.kind === 'session' ? [selectionKeyForSession(row.entry.session)] : []))

/**
 * The live rows the selection names, in pool order. Keys without a live row
 * drop out here — archiving or deleting a session quietly shrinks the set
 * instead of leaving a dangling chip the bulk bar would still count.
 */
export const $selectedSessions = computed(
  [$selectedSessionKeys, $sessions, $messagingSessions, $cronSessions],
  (keys, sessions, messagingSessions, cronSessions) => {
    if (keys.size === 0) {
      return []
    }

    const out: SessionInfo[] = []
    const seen = new Set<string>()

    for (const pool of [sessions, messagingSessions, cronSessions]) {
      for (const session of pool) {
        const key = selectionKeyForSession(session)

        if (keys.has(key) && !seen.has(key)) {
          seen.add(key)
          out.push(session)
        }
      }
    }

    return out
  }
)

export const $sessionSelectionCount = computed($selectedSessions, list => list.length)
