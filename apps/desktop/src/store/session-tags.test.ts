import { beforeEach, describe, expect, it } from 'vitest'

import {
  $sessionTags,
  addSessionTag,
  collectSessionTagFacets,
  dropSessionTagsForProfile,
  migrateSessionTagsForProfile,
  removeSessionTag,
  sessionTagsFor,
  setSessionTags
} from './session-tags'

const TAGS_STORAGE_KEY = 'hermes.desktop.sessionTags'
const BLUE = 'hsl(210, 70%, 50%)'
const GREEN = 'hsl(140, 60%, 45%)'
const AMBER = 'hsl(40, 90%, 50%)'

beforeEach(() => {
  window.localStorage.removeItem(TAGS_STORAGE_KEY)
  $sessionTags.set({})
})

describe('session tags store', () => {
  it('adds a tag under the normalized profile + durable id pair', () => {
    addSessionTag(null, 'sess-1', { color: BLUE, label: '  In progress  ' })

    // An absent/blank profile lands on the same normalized key as 'default'.
    expect(sessionTagsFor($sessionTags.get(), 'default', 'sess-1')).toEqual([{ color: BLUE, label: 'In progress' }])
    expect(sessionTagsFor($sessionTags.get(), 'work', 'sess-1')).toEqual([])
  })

  it('rejects empty labels and missing colors without writing', () => {
    addSessionTag('default', 'sess-1', { color: BLUE, label: '   ' })
    addSessionTag('default', 'sess-1', { color: '', label: 'valid' })

    expect($sessionTags.get()).toEqual({})
  })

  it('recolors an existing label instead of stacking a duplicate', () => {
    addSessionTag('default', 'sess-1', { color: BLUE, label: 'bug' })
    addSessionTag('default', 'sess-1', { color: GREEN, label: 'BUG' })

    // Case-insensitive dedupe keeps the FIRST label's casing.
    expect(sessionTagsFor($sessionTags.get(), 'default', 'sess-1')).toEqual([{ color: GREEN, label: 'bug' }])
  })

  it('removes a tag and drops the key when the last tag goes', () => {
    addSessionTag('default', 'sess-1', { color: BLUE, label: 'bug' })
    addSessionTag('default', 'sess-1', { color: GREEN, label: 'urgent' })

    removeSessionTag('default', 'sess-1', 'bug')
    expect(sessionTagsFor($sessionTags.get(), 'default', 'sess-1')).toEqual([{ color: GREEN, label: 'urgent' }])

    removeSessionTag('default', 'sess-1', 'urgent')
    expect($sessionTags.get()).toEqual({})

    // Removing an absent tag is a no-op.
    addSessionTag('default', 'sess-1', { color: BLUE, label: 'bug' })
    removeSessionTag('default', 'sess-1', 'nope')
    expect(sessionTagsFor($sessionTags.get(), 'default', 'sess-1')).toHaveLength(1)
  })

  it('setSessionTags replaces the list and clears on empty', () => {
    setSessionTags('default', 'sess-1', [
      { color: BLUE, label: 'a' },
      { color: GREEN, label: 'b' }
    ])
    expect(sessionTagsFor($sessionTags.get(), 'default', 'sess-1')).toHaveLength(2)

    setSessionTags('default', 'sess-1', [])
    expect($sessionTags.get()).toEqual({})
  })

  it('keeps profile islands separate', () => {
    addSessionTag('default', 'sess-1', { color: BLUE, label: 'bug' })
    addSessionTag('work', 'sess-1', { color: GREEN, label: 'bug' })

    expect(sessionTagsFor($sessionTags.get(), 'default', 'sess-1')[0]?.color).toBe(BLUE)
    expect(sessionTagsFor($sessionTags.get(), 'work', 'sess-1')[0]?.color).toBe(GREEN)
  })

  it('migrateSessionTagsForProfile re-homes the old profile keys', () => {
    addSessionTag('default', 'sess-1', { color: BLUE, label: 'bug' })
    addSessionTag('default', 'sess-2', { color: GREEN, label: 'chore' })
    addSessionTag('work', 'sess-3', { color: AMBER, label: 'other' })

    migrateSessionTagsForProfile('default', 'work')

    expect(sessionTagsFor($sessionTags.get(), 'default', 'sess-1')).toEqual([])
    // A pre-existing destination entry keeps its own tags.
    expect(sessionTagsFor($sessionTags.get(), 'work', 'sess-1')).toEqual([{ color: BLUE, label: 'bug' }])
    expect(sessionTagsFor($sessionTags.get(), 'work', 'sess-2')).toEqual([{ color: GREEN, label: 'chore' }])
    expect(sessionTagsFor($sessionTags.get(), 'work', 'sess-3')).toEqual([{ color: AMBER, label: 'other' }])
  })

  it('dropSessionTagsForProfile drops only the local profile island', () => {
    addSessionTag('default', 'sess-1', { color: BLUE, label: 'bug' })
    addSessionTag('work', 'sess-2', { color: GREEN, label: 'chore' })

    dropSessionTagsForProfile('default')
    expect(sessionTagsFor($sessionTags.get(), 'default', 'sess-1')).toEqual([])
    expect(sessionTagsFor($sessionTags.get(), 'work', 'sess-2')).toEqual([{ color: GREEN, label: 'chore' }])

    // A remote route must not touch the local map at all.
    addSessionTag('work', 'sess-2', { color: AMBER, label: 'added' })
    dropSessionTagsForProfile('work', { connectionId: 'remote-x', profile: 'work' })
    expect(sessionTagsFor($sessionTags.get(), 'work', 'sess-2')).toHaveLength(2)
  })

  it('persists to and restores from the scoped localStorage key', () => {
    addSessionTag('default', 'sess-1', { color: BLUE, label: 'bug' })

    const raw = window.localStorage.getItem(TAGS_STORAGE_KEY)
    expect(raw).toBeTruthy()

    const restored = JSON.parse(raw as string) as Record<string, unknown>
    expect(Object.values(restored)).toEqual([[{ color: BLUE, label: 'bug' }]])
  })

  it('collectSessionTagFacets dedupes case-insensitively and sorts', () => {
    addSessionTag('default', 'sess-1', { color: BLUE, label: 'urgent' })
    addSessionTag('default', 'sess-2', { color: GREEN, label: 'Urgent' })
    addSessionTag('work', 'sess-3', { color: AMBER, label: 'bug' })

    const facets = collectSessionTagFacets($sessionTags.get())

    expect(facets.map(f => f.label)).toEqual(['bug', 'urgent'])
    // First-seen color wins for the deduped label.
    expect(facets.find(f => f.label === 'urgent')?.color).toBe(BLUE)
  })
})
