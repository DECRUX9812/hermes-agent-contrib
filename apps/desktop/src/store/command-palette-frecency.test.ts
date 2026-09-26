import { beforeEach, describe, expect, it } from 'vitest'

import {
  $paletteFrecency,
  frecencyBoost,
  frecencyScore,
  paletteSessionKey,
  recordPaletteUse
} from './command-palette-frecency'

const STORAGE_KEY = 'hermes.desktop.commandPaletteFrecency'
const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = 1_800_000_000_000

const readStored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>

beforeEach(() => {
  window.localStorage.clear()
  $paletteFrecency.set({})
})

describe('recordPaletteUse', () => {
  it('counts a selection and persists it under the scoped key', () => {
    recordPaletteUse('nav-settings', NOW)
    recordPaletteUse('nav-settings', NOW + 1000)

    expect($paletteFrecency.get()['nav-settings']).toEqual({ count: 2, lastUsed: NOW + 1000 })
    expect(readStored()['nav-settings']).toEqual({ count: 2, lastUsed: NOW + 1000 })
  })

  it('merges another window\'s write instead of clobbering it', () => {
    recordPaletteUse('nav-settings', NOW)

    // A sibling window records a different row after our snapshot loaded.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'nav-settings': { count: 5, lastUsed: NOW + 500 }, 'nav-other': { count: 3, lastUsed: NOW } })
    )

    recordPaletteUse('nav-settings', NOW + 1000)

    const table = $paletteFrecency.get()

    // The stored 5 already contains our earlier write, so the merge takes the
    // max and lands the new increment on top — both windows' uses survive.
    expect(table['nav-settings']).toEqual({ count: 6, lastUsed: NOW + 1000 })
    expect(table['nav-other']).toEqual({ count: 3, lastUsed: NOW })
  })

  it('ignores malformed persisted entries', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ good: { count: 2, lastUsed: NOW }, bad: 'junk', worse: { count: 'x' } })
    )

    recordPaletteUse('nav-settings', NOW)

    const table = $paletteFrecency.get()

    expect(table.good).toEqual({ count: 2, lastUsed: NOW })
    expect(table.bad).toBeUndefined()
    expect(table.worse).toBeUndefined()
  })

  it('caps the table at the strongest entries', () => {
    for (let i = 0; i < 210; i++) {
      recordPaletteUse(`row-${i}`, NOW)
    }

    // One heavily-used row outscores the equally-fresh singles on a prune.
    for (let i = 0; i < 4; i++) {
      recordPaletteUse('row-0', NOW)
    }

    const table = $paletteFrecency.get()

    expect(Object.keys(table).length).toBe(200)
    expect(table['row-0']).toBeDefined()
    expect(table['row-209']).toBeUndefined()
  })
})

describe('frecencyScore', () => {
  it('weights recent use above a frequent stale one', () => {
    const fresh = { count: 1, lastUsed: NOW - HOUR }
    const stale = { count: 10, lastUsed: NOW - 40 * DAY }

    expect(frecencyScore(fresh, NOW)).toBeGreaterThan(0)
    expect(frecencyScore(fresh, NOW)).toBeGreaterThan(frecencyScore(stale, NOW) / 4)
  })

  it('scores zero for missing or empty entries', () => {
    expect(frecencyScore(undefined, NOW)).toBe(0)
    expect(frecencyScore({ count: 0, lastUsed: NOW }, NOW)).toBe(0)
  })

  it('treats a future timestamp as fresh rather than exploding', () => {
    expect(frecencyScore({ count: 2, lastUsed: NOW + DAY }, NOW)).toBe(8)
  })
})

describe('frecencyBoost', () => {
  it('stays under a quarter of a match grade no matter how often used', () => {
    expect(frecencyBoost({ count: 10_000, lastUsed: NOW }, NOW)).toBeLessThanOrEqual(0.25)
    expect(frecencyBoost(undefined, NOW)).toBe(0)
  })
})

describe('paletteSessionKey', () => {
  it('normalizes a stored session id to one shared history key', () => {
    expect(paletteSessionKey('abc123')).toBe('session:abc123')
  })
})
