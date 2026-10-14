import { describe, expect, it } from 'vitest'

import { railActiveKey, railPageGroups, railPanelAction } from './activity-rail-model'

describe('railPageGroups', () => {
  const isPlugin = (page: { id: string }) => page.id.includes(':')

  it('keeps every page, built-ins first and plugin pages in their own group', () => {
    const pages = [{ id: 'kanban:nav' }, { id: 'activity' }, { id: 'agentcraft:nav' }, { id: 'cron' }]

    expect(railPageGroups(pages, isPlugin)).toEqual([
      [{ id: 'activity' }, { id: 'cron' }],
      [{ id: 'kanban:nav' }, { id: 'agentcraft:nav' }]
    ])
  })

  it('draws no empty group', () => {
    expect(railPageGroups([{ id: 'standup:nav' }], isPlugin)).toEqual([[{ id: 'standup:nav' }]])
    expect(railPageGroups([], isPlugin)).toEqual([])
  })
})

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
