import { describe, expect, expectTypeOf, it } from 'vitest'

import { paneChrome } from '@/components/pane-shell/tree/renderer/track-model'
import type { Contribution } from '@/contrib/types'
import {
  type LayoutNode,
  LAYOUTS_AREA,
  type PaneContribution,
  type PaneDockHint,
  type PanePlacementHint,
  PANES_AREA
} from '@/sdk'

// The `panes` area's `data` contract is the one piece of the plugin surface
// that used to exist only as prose + inline `{ placement?: … }` casts at the
// readers. These assertions pin the extracted type to the fields the layout
// tree actually honors, so a rename/narrowing fails HERE instead of silently
// ignoring a plugin's hint.
describe('PaneContribution (panes data contract)', () => {
  it('accepts the documented chrome shape', () => {
    const data = {
      placement: 'right',
      width: '260px',
      collapsible: true,
      hideOnly: true,
      uncloseable: false,
      defaultCollapsed: true,
      lifecycleKeepAlive: true,
      headerVeto: false,
      revealAliases: ['chat-sidebar'],
      anchor: 'top-right',
      dock: { pane: 'sessions', pos: 'center', before: null, enforce: true },
      tabTitle: () => null,
      tabTitleText: () => 'Bots',
      tabLead: () => null,
      tabTrail: () => null,
      stripTrail: () => null,
      headerContent: () => null,
      newTab: () => {},
      tabWrap: tab => tab,
      tabMenuPrefix: () => null,
      tabDrag: () => false
    } satisfies PaneContribution

    expect(data.dock.pane).toBe('sessions')
  })

  it('types placement as the tiling roles plus floating only', () => {
    expectTypeOf<PaneContribution['placement']>().toEqualTypeOf<PanePlacementHint | 'floating' | undefined>()
    expectTypeOf<PaneDockHint['pos']>().toEqualTypeOf<'bottom' | 'center' | 'left' | 'right' | 'top'>()
  })

  it('reads a contribution through paneChrome, tolerating missing data', () => {
    const bare = { area: PANES_AREA, id: 'x' } satisfies Contribution
    const full = { area: PANES_AREA, data: { hideOnly: true }, id: 'y' } satisfies Contribution

    expect(paneChrome(bare)).toEqual({})
    expect(paneChrome(undefined)).toEqual({})
    expect(paneChrome(full).hideOnly).toBe(true)
  })

  it('exposes the layouts area for preset contributions', () => {
    expect(LAYOUTS_AREA).toBe('layouts')
    expectTypeOf<LayoutNode>().not.toBeAny()
  })
})
