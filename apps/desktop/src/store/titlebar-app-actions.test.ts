import { beforeEach, describe, expect, it } from 'vitest'

import {
  $titlebarAppActionsSide,
  setTitlebarAppActionsSide,
  TITLEBAR_APP_ACTIONS_DEFAULT,
  titlebarAppActionsClusterCounts
} from './titlebar-app-actions'

describe('titlebarAppActionsClusterCounts', () => {
  it('adds extras to the cluster they belong to', () => {
    for (const side of ['left', 'right'] as const) {
      const base = titlebarAppActionsClusterCounts(side)
      expect(titlebarAppActionsClusterCounts(side, 1, 2)).toEqual({ left: base.left + 1, right: base.right + 2 })
    }
  })

  it('releases the space of every tool Simple mode hides, on both sides', () => {
    // Sidebar toggle + what Simple keeps of the app actions; of the right's
    // fixed tools only the Panels door stays (Simple's one way to open panes).
    expect(titlebarAppActionsClusterCounts('right', 0, 0, 'simple')).toEqual({ left: 1, right: 3 })
    expect(titlebarAppActionsClusterCounts('left', 0, 0, 'simple')).toEqual({ left: 3, right: 1 })
    // …and every tier-hidden tool still gives its space back.
    const advanced = titlebarAppActionsClusterCounts('right', 0, 0, 'advanced')
    expect(advanced.right).toBeGreaterThan(titlebarAppActionsClusterCounts('right', 0, 0, 'simple').right)
  })
})

describe('$titlebarAppActionsSide', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setTitlebarAppActionsSide(TITLEBAR_APP_ACTIONS_DEFAULT)
  })

  it('persists left', () => {
    setTitlebarAppActionsSide('left')
    expect($titlebarAppActionsSide.get()).toBe('left')
    expect(window.localStorage.getItem('hermes.desktop.titlebarAppActions')).toBe('left')
  })
})
