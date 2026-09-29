import { atom, computed } from 'nanostores'

import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { isPaneVisible, revealTreePane } from '@/components/pane-shell/tree/store'
import { matchesQuery } from '@/hooks/use-media-query'
import { deriveLiveActions } from '@/lib/live-actions'
import { Codecs, persistentAtom } from '@/lib/persisted'

import { $focusedSessionState } from './session-states'

// The Live pane: the focused session's tool calls as they happen, raw —
// command, full output, exit code, timing — for people who want to watch the
// agent work rather than read the transcript's one-line run summaries. It
// follows the focused session like the artifacts rail (so it works in any
// chat, a Bot Chat included) and never opens itself: the palette toggle and
// the "Live" link on a run's summary line are the doors.

// Must match the pane id registered in contrib/controller.
export const LIVE_PANE_ID = 'live'

export const $liveOpen = persistentAtom('hermes.desktop.liveOpen', false, Codecs.bool)

/** A call the user asked to see ("Live" on a run summary). The pane scrolls
 *  it into view once, then clears it. */
export const $liveFocusCallId = atom<null | string>(null)

/** Keep the newest call in view while the agent works; scrolling up to read
 *  pauses it, the "Follow" control resumes. Pane-local, not persisted. */
export const $liveFollow = atom(true)

export const $liveActions = computed($focusedSessionState, state => deriveLiveActions(state?.messages))

export function openLivePane(): void {
  $liveOpen.set(true)
}

export function closeLivePane(): void {
  $liveOpen.set(false)
}

export function toggleLivePane(): void {
  if (isPaneVisible(LIVE_PANE_ID)) {
    closeLivePane()
  } else {
    revealLivePane()
  }
}

/** Open (never close) the pane and bring it to the front, optionally
 *  scrolled to one call. Narrow widths overlay the pane instead of docking,
 *  the same contract as the artifacts rail. */
export function revealLivePane(callId?: string): void {
  const wasOpen = $liveOpen.get()

  if (callId) {
    $liveFocusCallId.set(callId)
    $liveFollow.set(false)
  }

  openLivePane()

  if (matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
    if (!wasOpen) {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: LIVE_PANE_ID } }))
    }

    return
  }

  revealTreePane(LIVE_PANE_ID)
}
