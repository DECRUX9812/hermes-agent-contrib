/**
 * Roster view mode (G10) — the list↔cards toggle is a device-local pref.
 *
 * Invariants:
 *  - The default is 'list' — the card grid is opt-in.
 *  - Toggling persists under `roster-view-v1` in plugin storage and hydrates
 *    back on the next register; garbage/unset storage degrades to 'list'.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storage } = vi.hoisted(() => ({ storage: new Map<string, unknown>() }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { atom } = await import('nanostores')

  return { atom }
})

vi.mock('./shared', () => ({
  getPluginCtx: () => ({
    storage: {
      get: (key: string) => (storage.has(key) ? storage.get(key) : null),
      set: (key: string, value: unknown) => storage.set(key, value)
    }
  })
}))

import { $rosterViewMode, hydrateRosterViewMode, ROSTER_VIEW_STORAGE_KEY, setRosterViewMode } from './roster-view'

beforeEach(() => {
  storage.clear()
  $rosterViewMode.set('list')
})

describe('roster view mode', () => {
  it('persists the toggle and hydrates it back', async () => {
    setRosterViewMode('cards')

    expect($rosterViewMode.get()).toBe('cards')
    expect(storage.get(ROSTER_VIEW_STORAGE_KEY)).toBe('cards')

    // A relaunch: atom reset, storage carries the pref.
    $rosterViewMode.set('list')
    hydrateRosterViewMode()
    await Promise.resolve()

    expect($rosterViewMode.get()).toBe('cards')
  })

  it('stays on list with unset or garbage storage', async () => {
    hydrateRosterViewMode()
    await Promise.resolve()
    expect($rosterViewMode.get()).toBe('list')

    storage.set(ROSTER_VIEW_STORAGE_KEY, 'mosaic')
    hydrateRosterViewMode()
    await Promise.resolve()
    expect($rosterViewMode.get()).toBe('list')
  })
})
