import { beforeEach, describe, expect, it } from 'vitest'

import { $messagingSessions, $sessions } from './session'
import {
  $selectedSessionKeys,
  $selectedSessions,
  $sessionSelectionCount,
  applySessionRange,
  clearSessionSelection,
  isSessionKeySelected,
  parseSessionSelectionKey,
  selectionKeyForSession,
  selectOnlySession,
  sessionSelectionKey,
  toggleSessionSelected
} from './session-selection'

const session = (id: string, opts?: { lineageRoot?: string; profile?: string }) =>
  ({ id, profile: opts?.profile, _lineage_root_id: opts?.lineageRoot }) as (typeof $sessions.value)[number]

const keys = (...ids: string[]) => ids.map(id => sessionSelectionKey(null, id))

beforeEach(() => {
  clearSessionSelection()
  $sessions.set([])
  $messagingSessions.set([])
})

describe('session selection store', () => {
  it('keys selections by normalized profile + durable lineage id', () => {
    expect(sessionSelectionKey(null, 'sess-1')).toBe(sessionSelectionKey('default', 'sess-1'))
    expect(sessionSelectionKey('work', 'sess-1')).not.toBe(sessionSelectionKey('default', 'sess-1'))
  })

  it('a plain click collapses the set to the clicked row and re-anchors', () => {
    toggleSessionSelected(session('a'))
    toggleSessionSelected(session('b'))

    selectOnlySession(session('c'))

    expect($selectedSessionKeys.get()).toEqual(new Set(keys('c')))

    // And the new anchor drives the next ⇧-click.
    applySessionRange(keys('a', 'b', 'c'), session('a'), false)
    expect($selectedSessionKeys.get()).toEqual(new Set(keys('a', 'b', 'c')))
  })

  it('⌘-click toggles a row in and out of the set', () => {
    const a = session('a')
    toggleSessionSelected(a)
    toggleSessionSelected(session('b'))

    expect(isSessionKeySelected(keys('a')[0]!)).toBe(true)
    expect($sessionSelectionCount.get()).toBe(0) // no live rows yet

    toggleSessionSelected(a)
    expect($selectedSessionKeys.get()).toEqual(new Set(keys('b')))
  })

  it('a deselect still becomes the range anchor', () => {
    toggleSessionSelected(session('a'))
    toggleSessionSelected(session('a')) // off again, but anchored

    applySessionRange(keys('a', 'b', 'c'), session('c'), false)

    expect($selectedSessionKeys.get()).toEqual(new Set(keys('a', 'b', 'c')))
  })

  it('⇧-click replaces the set with the anchor→target range, both directions', () => {
    const order = keys('a', 'b', 'c', 'd')
    toggleSessionSelected(session('b'))

    applySessionRange(order, session('d'), false)
    expect($selectedSessionKeys.get()).toEqual(new Set(keys('b', 'c', 'd')))

    applySessionRange(order, session('a'), false)
    expect($selectedSessionKeys.get()).toEqual(new Set(keys('a', 'b')))
  })

  it('⌘⇧-click unions the range into the existing selection', () => {
    const order = keys('a', 'b', 'c', 'd', 'e')
    toggleSessionSelected(session('e'))
    toggleSessionSelected(session('b')) // anchor = b

    applySessionRange(order, session('d'), true)

    expect($selectedSessionKeys.get()).toEqual(new Set(keys('b', 'c', 'd', 'e')))
  })

  it('an anchor absent from the ordered keys falls back to the clicked row', () => {
    toggleSessionSelected(session('elsewhere'))

    applySessionRange(keys('a', 'b'), session('b'), false)

    expect($selectedSessionKeys.get()).toEqual(new Set(keys('b')))
  })

  it('ignores a ⇧-click on a row outside the ordered keys', () => {
    toggleSessionSelected(session('a'))

    applySessionRange(keys('a', 'b'), session('zzz'), false)

    expect($selectedSessionKeys.get()).toEqual(new Set(keys('a')))
  })

  it('resolves selected keys to live rows, dropping dead keys', () => {
    $sessions.set([
      session('tip-2', { lineageRoot: 'root-1' }), // selected as 'root-1'
      session('plain-2')
    ])

    $selectedSessionKeys.set(new Set([...keys('root-1', 'gone-1'), sessionSelectionKey('work', 'plain-2')]))

    // 'gone-1' never resolves; 'plain-2' lives under the default profile, not
    // 'work', so its other-profile key misses too.
    expect($selectedSessions.get().map(s => s.id)).toEqual(['tip-2'])
    expect($sessionSelectionCount.get()).toBe(1)
  })

  it('a compressed lineage still counts: the key names the lineage root', () => {
    $selectedSessionKeys.set(new Set(keys('root-1')))
    expect($sessionSelectionCount.get()).toBe(0)

    $sessions.set([session('tip-3', { lineageRoot: 'root-1' })])
    expect($selectedSessions.get().map(s => s.id)).toEqual(['tip-3'])
  })

  it('parses a selection key back into its pair', () => {
    expect(parseSessionSelectionKey(sessionSelectionKey('work', 'sess-9'))).toEqual({
      durableId: 'sess-9',
      profile: 'work'
    })
    expect(parseSessionSelectionKey('not-json')).toBeNull()
    expect(parseSessionSelectionKey('"just a string"')).toBeNull()
    expect(selectionKeyForSession(session('x', { profile: 'w' }))).toBe(sessionSelectionKey('w', 'x'))
  })
})
