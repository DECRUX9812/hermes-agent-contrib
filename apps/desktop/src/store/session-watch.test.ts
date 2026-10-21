import { beforeEach, describe, expect, it } from 'vitest'

import { $sessions } from './session'
import {
  $watchedSessionKeys,
  dropWatchedSessionsForProfile,
  isSessionWatched,
  isWatchedSessionId,
  migrateWatchedSessionsForProfile,
  sessionWatchKey,
  toggleSessionWatched,
  unwatchSession,
  watchedSessionEntries
} from './session-watch'

const WATCH_STORAGE_KEY = 'hermes.desktop.sessionWatch'

const session = (id: string, opts?: { lineageRoot?: string; profile?: string }) =>
  ({ id, profile: opts?.profile, _lineage_root_id: opts?.lineageRoot }) as (typeof $sessions.value)[number]

beforeEach(() => {
  window.localStorage.removeItem(WATCH_STORAGE_KEY)
  $watchedSessionKeys.set({})
  $sessions.set([])
})

describe('session watch store', () => {
  it('keys watches by normalized profile + durable id', () => {
    expect(sessionWatchKey(null, 'sess-1')).toBe(sessionWatchKey('default', 'sess-1'))
    expect(sessionWatchKey('work', 'sess-1')).not.toBe(sessionWatchKey('default', 'sess-1'))
    expect(isSessionWatched('work', 'sess-1')).toBe(false)
  })

  it('toggles on the pin id so a compressed lineage stays watched', () => {
    $sessions.set([session('tip-2', { lineageRoot: 'root-1', profile: 'work' })])

    expect(toggleSessionWatched('tip-2')).toBe(true)
    expect($watchedSessionKeys.get()).toEqual({ [sessionWatchKey('work', 'root-1')]: true })

    // A later tip of the same lineage still reads as watched.
    $sessions.set([session('tip-3', { lineageRoot: 'root-1', profile: 'work' })])
    expect(isWatchedSessionId('tip-3')).toBe(true)

    expect(toggleSessionWatched('tip-3')).toBe(false)
    expect($watchedSessionKeys.get()).toEqual({})
  })

  it('falls back to a suffix scan for an id no loaded session carries', () => {
    $watchedSessionKeys.set({ [sessionWatchKey('default', 'lost-1')]: true })

    expect(isWatchedSessionId('lost-1')).toBe(true)
    expect(isWatchedSessionId('lost-2')).toBe(false)
  })

  it('unwatchSession removes the exact pair even for an unlisted session', () => {
    $watchedSessionKeys.set({ [sessionWatchKey('work', 'sess-9')]: true })

    unwatchSession('work', 'sess-9')
    expect($watchedSessionKeys.get()).toEqual({})

    // Removing an absent pair is a no-op.
    unwatchSession('work', 'sess-9')
    expect($watchedSessionKeys.get()).toEqual({})
  })

  it('keeps profile islands separate when resolving entries', () => {
    $watchedSessionKeys.set({
      [sessionWatchKey('default', 'a')]: true,
      [sessionWatchKey('work', 'a')]: true
    })

    const entries = watchedSessionEntries()

    expect(entries).toContainEqual({ durableId: 'a', profile: 'default' })
    expect(entries).toContainEqual({ durableId: 'a', profile: 'work' })
    expect(entries).toHaveLength(2)
  })

  it('migrates watches on a profile rename and never across connections', () => {
    $watchedSessionKeys.set({
      [sessionWatchKey('old', 'sess-1')]: true,
      [sessionWatchKey('work', 'sess-2')]: true
    })

    migrateWatchedSessionsForProfile('old', 'new')
    expect(isSessionWatched('new', 'sess-1')).toBe(true)
    expect(isSessionWatched('work', 'sess-2')).toBe(true)
    expect(isSessionWatched('old', 'sess-1')).toBe(false)
  })

  it('drops watches for a deleted local profile', () => {
    $watchedSessionKeys.set({
      [sessionWatchKey('gone', 'sess-1')]: true,
      [sessionWatchKey('work', 'sess-2')]: true
    })

    dropWatchedSessionsForProfile('gone')
    expect($watchedSessionKeys.get()).toEqual({ [sessionWatchKey('work', 'sess-2')]: true })

    // Same guard: remote drops never touch the local set.
    dropWatchedSessionsForProfile('work', { connectionId: 'conn-7' })
    expect(isSessionWatched('work', 'sess-2')).toBe(true)
  })
})
