/**
 * MENU-BAR STATUS (#38) — derives the payload the primary renderer pushes into
 * the main process for the tray icon: a status line, a needs-you badge, and
 * the handful of recent sessions the tray menu can jump to.
 *
 * Everything is derived from `$sessionDotStateById` (the same single status
 * map the sidebar, pane tabs, and switcher paint) so the menu bar can never
 * disagree with the in-app dots: a live turn or background job counts as an
 * active run, a blocking prompt or finished-unread row counts as needs-you,
 * and the recent list carries an attention marker for any of those three.
 *
 * The copy is resolved HERE, not in main — the main process has no i18n
 * catalog, so the strings ride the push (`translateNow` against the runtime
 * locale) and a locale switch re-pushes fresh text.
 */

import { translateNow } from '@/i18n'
import type { SessionInfo } from '@/types/hermes'

import type { TrayStatusPush, TrayStatusSession } from '../../electron/tray-status'

import type { SessionDotState } from './session-dot-state'

// The tray menu is a capture aid, not a session browser — same handful-of-rows
// contract as the Quick Entry picker.
export const MENU_BAR_RECENT_SESSIONS = 5

type MenuBarSessionRow = Pick<SessionInfo, 'archived' | 'id' | 'preview' | 'title'>

const ACTIVE_RUN_STATES: ReadonlySet<SessionDotState> = new Set(['background', 'stalled', 'working'])
const NEEDS_YOU_STATES: ReadonlySet<SessionDotState> = new Set(['needs-input', 'unread'])
const ATTENTION_STATES: ReadonlySet<SessionDotState> = new Set(['needs-input', 'stalled', 'unread'])

/** Long titles get ellipsized so the native menu stays a sane width. */
const MENU_TITLE_LIMIT = 48

/**
 * Pure derivation: (dot states, session rows) → tray payload. Archived rows
 * are invisible — a finished-and-filed session must not keep the badge lit.
 */
export function buildMenuBarStatus(
  dotStates: Readonly<Record<string, SessionDotState>>,
  sessions: readonly MenuBarSessionRow[]
): TrayStatusPush {
  let activeRuns = 0
  let needsYou = 0
  const recent: TrayStatusSession[] = []

  for (const session of sessions) {
    if (session.archived) {
      continue
    }

    const state = dotStates[session.id]

    if (state && ACTIVE_RUN_STATES.has(state)) {
      activeRuns += 1
    }

    if (state && NEEDS_YOU_STATES.has(state)) {
      needsYou += 1
    }

    if (recent.length < MENU_BAR_RECENT_SESSIONS) {
      const rawTitle = session.title?.trim() || session.preview?.trim() || session.id

      recent.push({
        attention: state !== undefined && ATTENTION_STATES.has(state),
        id: session.id,
        title: rawTitle.length > MENU_TITLE_LIMIT ? `${rawTitle.slice(0, MENU_TITLE_LIMIT)}…` : rawTitle
      })
    }
  }

  return {
    activeRuns,
    needsYou,
    sessions: recent,
    strings: {
      newSession: translateNow('menuBar.newSession'),
      quickEntry: translateNow('menuBar.quickEntry'),
      quit: translateNow('menuBar.quit'),
      recentSessions: translateNow('menuBar.recentSessions'),
      show: translateNow('menuBar.show'),
      statusLine:
        activeRuns > 0 || needsYou > 0
          ? translateNow('menuBar.statusActive', activeRuns, needsYou)
          : translateNow('menuBar.statusIdle')
    }
  }
}
