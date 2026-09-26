






import { type Translations } from '@/i18n'
import {
  REORDER_DRAG_TRANSITION_CSS,
  REORDER_RAIL_TRANSITION
} from '@/lib/reorder'
import { useStoreSelector } from '@/lib/use-session-slice'
import { cn } from '@/lib/utils'
import {
  $profileDotStateByScope,
  type ProfileDotState,
  type ProfileDotSummary,
  profileDotSummaryFor
} from '@/store/profile-dot-state'


// #91710: a profile that finished (or blocked, or is still working) while
// another was selected carries an indicator on its rail square and dropdown
// row. The colors mirror the session status dot's palette — amber for "needs
// your answer", accent for running, success green for unread — so a profile's
// loudest state reads the same as its sessions' dots in the sidebar below.
const PROFILE_STATUS_DOT_CLASS: Record<ProfileDotState, string> = {
  'needs-input': 'bg-amber-500',
  working: 'bg-(--ui-accent)',
  unread: 'bg-(--ui-success)'
}

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
  return (
    <span
      aria-hidden="true"
      className={cn('size-1.5 rounded-full', PROFILE_STATUS_DOT_CLASS[summary.state])}
      data-slot="profile-status-dot"
    />
  )
}

// Neighbors reflow on RAIL_TRANSITION; the dragged square glides between
// snapped cells on the snappier DRAG_TRANSITION. Both come from the SHARED
// reorder primitive (lib/reorder.ts) so every reorder strip feels identical.
export const RAIL_TRANSITION = REORDER_RAIL_TRANSITION

export const DRAG_TRANSITION = REORDER_DRAG_TRANSITION_CSS
