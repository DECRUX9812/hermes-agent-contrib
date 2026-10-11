import { afterEach, expect, it, vi } from 'vitest'

import {
  $roomPrefs,
  desktopAlert,
  rememberRoomOpened,
  SNOOZE_MS,
  snoozedThreads,
  snoozeThread,
  togglePin
} from './group-room-prefs'

afterEach(() => {
  $roomPrefs.set({ desktopAlerts: false, lastOpened: {}, pins: {}, snoozes: {} })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('pins in order, unpins, and keeps it across a reload of the page', () => {
  togglePin('room', 'a')
  togglePin('room', 'b')
  togglePin('room', 'a')

  expect($roomPrefs.get().pins.room).toEqual(['b'])
  expect(JSON.parse(window.localStorage.getItem('hermes.bots.roomPrefs.v1') || '{}').pins.room).toEqual(['b'])
})

it('snoozes for an hour and wakes on demand or when the hour passes', () => {
  const now = Date.now()
  snoozeThread('room', 'a', now + SNOOZE_MS)

  expect([...snoozedThreads($roomPrefs.get(), 'room', now)]).toEqual(['a'])
  expect([...snoozedThreads($roomPrefs.get(), 'room', now + SNOOZE_MS + 1)]).toEqual([])
  snoozeThread('room', 'a', 0)
  expect([...snoozedThreads($roomPrefs.get(), 'room', now)]).toEqual([])
})

it('still works when the browser refuses storage', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota')
  })

  rememberRoomOpened('room', 42)
  expect($roomPrefs.get().lastOpened.room).toBe(42)
})

it('raises an OS alert only when opted in, permitted, and the room is in the background', () => {
  const shown = vi.fn()
  vi.stubGlobal('Notification', Object.assign(shown, { permission: 'granted' }))
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)

  desktopAlert('Needs you', 'x stalled')
  expect(shown).not.toHaveBeenCalled()

  $roomPrefs.set({ ...$roomPrefs.get(), desktopAlerts: true })
  desktopAlert('Needs you', 'x stalled')
  expect(shown).toHaveBeenCalledTimes(1)

  hidden.mockReturnValue(false)
  desktopAlert('Needs you', 'y stalled')
  expect(shown).toHaveBeenCalledTimes(1)
})
