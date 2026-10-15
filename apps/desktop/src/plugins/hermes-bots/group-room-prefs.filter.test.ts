import { beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'hermes.bots.roomPrefs.v1'

beforeEach(() => {
  window.localStorage.clear()
})

describe('room quick filter preference', () => {
  it('updates the room preferences and writes storage', async () => {
    vi.resetModules()
    const { $roomPrefs, setRoomFilter } = await import('./group-room-prefs')

    setRoomFilter('working')

    expect($roomPrefs.get().roomFilter).toBe('working')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}').roomFilter).toBe('working')
  })

  it('restores a saved filter on a fresh module load', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ desktopAlerts: false, lastOpened: {}, pins: {}, roomFilter: 'needsYou', snoozes: {} })
    )
    vi.resetModules()
    const { $roomFilter } = await import('./group-room-prefs')

    expect($roomFilter.get()).toBe('needsYou')
  })

  it('falls back to all for an unknown saved filter', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ desktopAlerts: false, lastOpened: {}, pins: {}, roomFilter: 'bogus', snoozes: {} })
    )
    vi.resetModules()
    const { $roomFilter } = await import('./group-room-prefs')

    expect($roomFilter.get()).toBe('all')
  })
})
