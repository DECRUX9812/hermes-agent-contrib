/**
 * The Command Room's per-viewer preferences: pinned threads, snoozed threads,
 * where the user last left each room (so "While you were away" survives a
 * restart), and whether alerts also go to the operating system.
 *
 * Personal conveniences, not shared room state — so they live in this
 * browser's storage, never in the room record the bots and other machines
 * sync. Storage can be missing or refuse (private window, cleared site data):
 * every read and write is guarded and the room works without it.
 */

import { atom } from 'nanostores'

const STORAGE_KEY = 'hermes.bots.roomPrefs.v1'
export const SNOOZE_MS = 60 * 60_000

export interface RoomPrefs {
  desktopAlerts: boolean
  /** roomKey → the log tail when the user last opened the room. */
  lastOpened: Record<string, number>
  /** roomKey → pinned thread ids, pin order. */
  pins: Record<string, string[]>
  /** roomKey → thread → snoozed until (ms). */
  snoozes: Record<string, Record<string, number>>
}

const EMPTY: RoomPrefs = { desktopAlerts: false, lastOpened: {}, pins: {}, snoozes: {} }

function load(): RoomPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<RoomPrefs>) } : EMPTY
  } catch {
    return EMPTY
  }
}

export const $roomPrefs = atom<RoomPrefs>(typeof window === 'undefined' ? EMPTY : load())

function update(change: (prefs: RoomPrefs) => RoomPrefs): void {
  const next = change($roomPrefs.get())
  $roomPrefs.set(next)

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage refused: the preference still holds for this session.
  }
}

export function togglePin(roomKey: string, thread: string): void {
  update(prefs => {
    const pins = prefs.pins[roomKey] || []

    return {
      ...prefs,
      pins: { ...prefs.pins, [roomKey]: pins.includes(thread) ? pins.filter(t => t !== thread) : [...pins, thread] }
    }
  })
}

/** Snooze for SNOOZE_MS; `until` 0 wakes it now. */
export function snoozeThread(roomKey: string, thread: string, until = Date.now() + SNOOZE_MS): void {
  update(prefs => {
    const room = { ...(prefs.snoozes[roomKey] || {}) }

    if (until > Date.now()) {
      room[thread] = until
    } else {
      delete room[thread]
    }

    return { ...prefs, snoozes: { ...prefs.snoozes, [roomKey]: room } }
  })
}

export function snoozedThreads(prefs: RoomPrefs, roomKey: string, now = Date.now()): Set<string> {
  return new Set(
    Object.entries(prefs.snoozes[roomKey] || {})
      .filter(([, until]) => until > now)
      .map(([thread]) => thread)
  )
}

export function rememberRoomOpened(roomKey: string, tail: number): void {
  if (($roomPrefs.get().lastOpened[roomKey] || 0) !== tail) {
    update(prefs => ({ ...prefs, lastOpened: { ...prefs.lastOpened, [roomKey]: tail } }))
  }
}

/** Turning OS alerts on asks the browser first; a refusal leaves them off. */
export async function setDesktopAlerts(on: boolean): Promise<boolean> {
  let allowed = on

  if (on) {
    try {
      allowed = typeof Notification !== 'undefined' && (await Notification.requestPermission()) === 'granted'
    } catch {
      allowed = false
    }
  }

  update(prefs => ({ ...prefs, desktopAlerts: allowed }))

  return allowed
}

/** An OS notification while the room's window is in the background. */
export function desktopAlert(title: string, body: string): void {
  try {
    if (
      $roomPrefs.get().desktopAlerts &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      document.hidden
    ) {
      new Notification(title, { body, tag: `hermes-room:${title}:${body}` })
    }
  } catch {
    // No notification support here (embedded view, denied mid-session).
  }
}
