/**
 * Menu-bar status (roadmap #38): the tray icon doubles as a live status
 * surface — active-run count, needs-you badge, recent sessions, and quick
 * actions — fed by the primary renderer's session stores.
 *
 * The renderer owns the data AND the copy: everything shown in the menu
 * arrives in the pushed payload (the main process has no i18n catalog), so a
 * forged or stale push is sanitized here into a strict shape before it ever
 * touches a Menu. Until the first push lands, menus fall back to English
 * strings — the same strings the pre-status tray menu already shipped.
 *
 * What the badge means: the macOS tray title carries `${runs}` while work is
 * in flight and appends `!${needsYou}` once something is blocking or unread —
 * "3 !1" reads as three running, one needs you. Nothing is ever appended for
 * counts the user can't act on from the menu.
 */

export interface TrayStatusSession {
  /** True when this row is blocking/unread/stalled — the ● marker. */
  attention: boolean
  id: string
  title: string
}

export interface TrayStatusStrings {
  newSession: string
  quickEntry: string
  quit: string
  recentSessions: string
  show: string
  statusLine: string
}

export interface TrayStatusPush {
  /** Sessions with a live turn (working/stalled) or a background job. */
  activeRuns: number
  /** Sessions blocking on input or finished-unread. */
  needsYou: number
  sessions: TrayStatusSession[]
  strings: TrayStatusStrings
}

/** English fallbacks — identical to the strings the tray already showed. */
export const DEFAULT_TRAY_STATUS_STRINGS: TrayStatusStrings = {
  newSession: 'New Session',
  quickEntry: 'Quick Entry',
  quit: 'Quit Hermes',
  recentSessions: 'Recent Sessions',
  show: 'Show Hermes',
  statusLine: 'Hermes'
}

/** The menu needs the session id but the user sees ~one line — cap titles so a
 *  giant session name can't stretch the context menu across the screen. */
const MENU_TITLE_LIMIT = 60
const RECENT_SESSION_LIMIT = 8

const cleanString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value : fallback

const cleanCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

export function sanitizeTrayStatusPush(raw: unknown): TrayStatusPush | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const record = raw as Record<string, unknown>

  const rawStrings = (typeof record.strings === 'object' && record.strings !== null ? record.strings : {}) as Record<
    string,
    unknown
  >

  const strings: TrayStatusStrings = {
    newSession: cleanString(rawStrings.newSession, DEFAULT_TRAY_STATUS_STRINGS.newSession),
    quickEntry: cleanString(rawStrings.quickEntry, DEFAULT_TRAY_STATUS_STRINGS.quickEntry),
    quit: cleanString(rawStrings.quit, DEFAULT_TRAY_STATUS_STRINGS.quit),
    recentSessions: cleanString(rawStrings.recentSessions, DEFAULT_TRAY_STATUS_STRINGS.recentSessions),
    show: cleanString(rawStrings.show, DEFAULT_TRAY_STATUS_STRINGS.show),
    statusLine: cleanString(rawStrings.statusLine, DEFAULT_TRAY_STATUS_STRINGS.statusLine)
  }

  const sessions: TrayStatusSession[] = []

  if (Array.isArray(record.sessions)) {
    for (const entry of record.sessions) {
      if (!entry || typeof entry !== 'object') {
        continue
      }

      const row = entry as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id.trim() : ''

      if (!id) {
        continue
      }

      const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim().slice(0, MENU_TITLE_LIMIT) : id

      sessions.push({ attention: row.attention === true, id, title })

      if (sessions.length >= RECENT_SESSION_LIMIT) {
        break
      }
    }
  }

  return {
    activeRuns: cleanCount(record.activeRuns),
    needsYou: cleanCount(record.needsYou),
    sessions,
    strings
  }
}

/** The macOS badge text next to the tray icon ('' when nothing is happening). */
export function trayStatusBadge(push: TrayStatusPush | null): string {
  if (!push) {
    return ''
  }

  const parts: string[] = []

  if (push.activeRuns > 0) {
    parts.push(String(push.activeRuns))
  }

  if (push.needsYou > 0) {
    parts.push(`!${push.needsYou}`)
  }

  return parts.join(' ')
}

export interface TrayMenuActions {
  focusSession: (id: string) => void
  newSession: () => void
  /** Null when Quick Entry is disabled — the item is then absent entirely. */
  summonQuickEntry: null | (() => void)
  show: () => void
  quit: () => void
}

/**
 * The whole context menu as a plain template — pure so the shape is unit
 * testable; minimize-to-tray just hands it to `Menu.buildFromTemplate`.
 */
export function buildTrayMenuTemplate(
  push: TrayStatusPush | null,
  actions: TrayMenuActions
): { click?: () => void; enabled?: boolean; label?: string; type?: string }[] {
  const strings = push?.strings ?? DEFAULT_TRAY_STATUS_STRINGS
  const items: { click?: () => void; enabled?: boolean; label?: string; type?: string }[] = []

  items.push({ enabled: false, label: strings.statusLine })
  items.push({ type: 'separator' })

  if (push && push.sessions.length > 0) {
    items.push({ enabled: false, label: strings.recentSessions })

    for (const session of push.sessions) {
      items.push({
        click: () => actions.focusSession(session.id),
        label: `${session.attention ? '● ' : ''}${session.title}`
      })
    }

    items.push({ type: 'separator' })
  }

  items.push({ label: strings.newSession, click: () => actions.newSession() })

  if (actions.summonQuickEntry) {
    items.push({ label: strings.quickEntry, click: () => actions.summonQuickEntry?.() })
  }

  items.push({ label: strings.show, click: () => actions.show() })
  items.push({ type: 'separator' })
  // Never bypass the ordinary active-work confirmation or teardown.
  items.push({ label: strings.quit, click: () => actions.quit() })

  return items
}
