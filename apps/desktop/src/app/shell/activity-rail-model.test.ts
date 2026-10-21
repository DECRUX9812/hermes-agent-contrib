import { describe, expect, it } from 'vitest'

import { railActiveKey, railPanelAction } from './activity-rail-model'

describe('railPanelAction', () => {
  it('folds only the panel that is actually showing', () => {
    expect(railPanelAction({ paneShown: true, sidebarOpen: true })).toBe('fold')
    // Behind another tab, or with the sidebar folded, the press brings it up.
    expect(railPanelAction({ paneShown: false, sidebarOpen: true })).toBe('show')
    expect(railPanelAction({ paneShown: true, sidebarOpen: false })).toBe('show')
  })
})

describe('railActiveKey', () => {
  const panels = [
    { key: 'sessions', shown: true },
    { key: 'bots', shown: false }
  ]

  it('marks the page on screen over the panel beside it', () => {
    expect(railActiveKey('capabilities', panels, true)).toBe('capabilities')
    expect(railActiveKey(null, panels, true)).toBe('sessions')
  })

  it('marks no panel while the sidebar is folded', () => {
    expect(railActiveKey(null, panels, false)).toBeNull()
  })
})
