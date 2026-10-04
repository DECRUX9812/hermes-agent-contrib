






import { type Translations } from '@/i18n'
import {
  REORDER_DRAG_TRANSITION_CSS,
  REORDER_RAIL_TRANSITION
} from '@/lib/reorder'
import { useStoreSelector } from '@/lib/use-session-slice'
import {
  $profileDotStateByScope,
  type ProfileDotSummary,
  profileDotSummaryFor
} from '@/store/profile-dot-state'

import { sessionDotClassName } from '../session-status-dot'


// #91710: a profile that finished (or blocked, or is still working) while
// another was selected carries an indicator on its rail square and dropdown
// row. It paints the session status dot's own class for the same state, so a
// profile's loudest state reads the same as its sessions' dots below.

/** The a11y/tooltip text for one square's summary — every non-zero count,
 *  most urgent first ("1 session needs your answer, 2 unread sessions"). The
 *  counts ride the accessible name so the state is never color-only. */
export function profileStatusLabel(p: Translations['profiles'], summary: ProfileDotSummary): string {
  const parts: string[] = []

  if (summary.needsInputCount > 0) {
    parts.push(p.status.needsInput(summary.needsInputCount))
  }

  if (summary.workingCount > 0) {
    parts.push(p.status.working(summary.workingCount))
  }

  if (summary.unreadCount > 0) {
    parts.push(p.status.unread(summary.unreadCount))
  }

  return parts.join(', ')
}

/** One profile square's rollup of its sessions' shared dot state, keyed by the
 *  (gateway, profile) the square names. `connectionId` is null for this
 *  machine's primary. The interned summaries keep the selector's bail-out
 *  intact: a square re-renders only when its own counts change. */
export function useProfileStatus(profile: null | string, connectionId: null | string | undefined): ProfileDotSummary | null {
  return useStoreSelector($profileDotStateByScope, byScope =>
    profile ? (profileDotSummaryFor(byScope, connectionId, profile) ?? null) : null
  )
}

/** The dot a square/dropdown row paints for a summary. `status-dot` slot so
 *  tests (and tours) can find it without duplicating the class string. */
export function ProfileStatusDot({ summary }: { summary: ProfileDotSummary }) {
  return <span aria-hidden="true" className={sessionDotClassName(summary.state)} data-slot="profile-status-dot" />
}

// Neighbors reflow on RAIL_TRANSITION; the dragged square glides between
// snapped cells on the snappier DRAG_TRANSITION. Both come from the SHARED
// reorder primitive (lib/reorder.ts) so every reorder strip feels identical.
export const RAIL_TRANSITION = REORDER_RAIL_TRANSITION

export const DRAG_TRANSITION = REORDER_DRAG_TRANSITION_CSS
