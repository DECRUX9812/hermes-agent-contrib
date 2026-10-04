import { describe, expect, it } from 'vitest'

import { resolveSessionRowClick } from './session-row-gesture'

const NO_MODS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }

describe('resolveSessionRowClick', () => {
  it('resumes on a plain click', () => {
    expect(resolveSessionRowClick(NO_MODS)).toBe('resume')
  })

  it('toggles selection on ⌘/⌃-click', () => {
    expect(resolveSessionRowClick({ ...NO_MODS, metaKey: true })).toBe('selectToggle')
    expect(resolveSessionRowClick({ ...NO_MODS, ctrlKey: true })).toBe('selectToggle')
  })

  it('range-selects on ⇧-click', () => {
    expect(resolveSessionRowClick({ ...NO_MODS, shiftKey: true })).toBe('selectRange')
  })

  it('range-selects additively on ⌘/⌃+⇧-click', () => {
    expect(resolveSessionRowClick({ ...NO_MODS, metaKey: true, shiftKey: true })).toBe('selectRangeAdditive')
    expect(resolveSessionRowClick({ ...NO_MODS, ctrlKey: true, shiftKey: true })).toBe('selectRangeAdditive')
  })

  // The regression this whole module guards: ⌥+⇧ sets shiftKey too, so a
  // naive "check shiftKey first" would swallow archive into a range select.
  it('archives on ⌥+⇧-click', () => {
    expect(resolveSessionRowClick({ ...NO_MODS, altKey: true, shiftKey: true })).toBe('archive')
  })

  it('⌥+⇧ beats every modifier combination, including the primary key', () => {
    expect(resolveSessionRowClick({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe('archive')
  })

  it('does not archive on ⌥-click alone', () => {
    expect(resolveSessionRowClick({ ...NO_MODS, altKey: true })).toBe('resume')
  })
})
