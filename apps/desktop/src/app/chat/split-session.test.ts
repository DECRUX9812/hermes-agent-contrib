import { afterEach, describe, expect, it, vi } from 'vitest'

import { group, split } from '@/components/pane-shell/tree/model'
import { $layoutTree, $newSessionTabAction, type NewSessionTabOptions } from '@/components/pane-shell/tree/store'

import {
  $canSplitSession,
  $chatZoneCount,
  $splitSessionTab,
  MAX_CHAT_ZONES,
  nextSplitPlacement,
  splitFocusedSession,
  visibleChatZones
} from './split-session'

const zone = (pane: string, id: string) => group([pane], { id })
const everyPane = () => true

afterEach(() => {
  $layoutTree.set(null)
  $newSessionTabAction.set(null)
})

describe('nextSplitPlacement', () => {
  it('docks a second zone to the right of a lone chat zone', () => {
    const tree = zone('workspace', 'g1')

    expect(nextSplitPlacement(tree, null, everyPane)).toEqual({ anchor: 'workspace', dir: 'right' })
  })

  it('stacks the third zone under the focused chat zone', () => {
    const tree = split('row', [zone('workspace', 'g1'), zone('session-tile:b', 'g2')])

    expect(nextSplitPlacement(tree, 'g1', everyPane)).toEqual({ anchor: 'workspace', dir: 'bottom' })
    expect(nextSplitPlacement(tree, null, everyPane)).toEqual({ anchor: 'session-tile:b', dir: 'bottom' })
  })

  it('closes the 2x2 grid under the zone still alone in its column', () => {
    const tree = split('row', [
      zone('workspace', 'g1'),
      split('column', [zone('session-tile:b', 'g2'), zone('session-tile:c', 'g3')])
    ])

    // Even with focus on a stacked zone, the lone column wins.
    expect(nextSplitPlacement(tree, 'g2', everyPane)).toEqual({ anchor: 'workspace', dir: 'bottom' })
  })

  it('falls back to the focused zone when every column is shared', () => {
    const tree = split('column', [zone('workspace', 'g1'), zone('session-tile:b', 'g2'), zone('session-tile:c', 'g3')])

    expect(nextSplitPlacement(tree, 'g2', everyPane)).toEqual({ anchor: 'session-tile:b', dir: 'bottom' })
  })

  it('refuses at the cap and when there is no chat zone to split', () => {
    expect(nextSplitPlacement(null, null, everyPane)).toBeNull()
    expect(nextSplitPlacement(group(['browser-tile'], { id: 'g0' }), null, everyPane)).toBeNull()
    expect(
      nextSplitPlacement(
        split('row', [
          split('column', [zone('workspace', 'g1'), zone('session-tile:b', 'g2')]),
          split('column', [zone('session-tile:c', 'g3'), zone('session-tile:d', 'g4')])
        ]),
        'g1',
        everyPane
      )
    ).toBeNull()
    expect(MAX_CHAT_ZONES).toBe(4)
  })

  it('ignores non-chat and hidden zones when counting to the cap', () => {
    const tree = split('row', [
      zone('workspace', 'g1'),
      zone('session-tile:b', 'g2'),
      group(['browser-tile'], { id: 'g3' })
    ])

    expect(nextSplitPlacement(tree, null, everyPane)).toEqual({ anchor: 'session-tile:b', dir: 'bottom' })
    expect(nextSplitPlacement(tree, null, pane => pane !== 'session-tile:b')).toEqual({
      anchor: 'workspace',
      dir: 'right'
    })
  })
})

describe('visibleChatZones', () => {
  it('walks nested splits in tree order and keeps only visible chat zones', () => {
    const tree = split('row', [
      zone('workspace', 'g1'),
      split('column', [zone('session-tile:b', 'g2'), group(['browser-tile'], { id: 'g3' })]),
      { ...zone('session-tile:c', 'g4'), minimized: true }
    ])

    const ids = visibleChatZones(tree, everyPane).map(z => z.active)

    expect(ids).toEqual(['workspace', 'session-tile:b'])
  })

  it('drops zones whose active pane is hidden', () => {
    const tree = split('row', [zone('workspace', 'g1'), zone('session-tile:b', 'g2')])

    expect(visibleChatZones(tree, pane => pane !== 'session-tile:b').map(z => z.active)).toEqual(['workspace'])
  })
})

describe('splitFocusedSession', () => {
  it('opens the new tab docked under the second chat zone', () => {
    const open = vi.fn<(options?: NewSessionTabOptions) => void>()
    $newSessionTabAction.set(open)
    $layoutTree.set(split('row', [zone('workspace', 'g1'), zone('session-tile:b', 'g2')]))

    expect(splitFocusedSession()).toBe(true)
    expect(open).toHaveBeenCalledWith({ placement: { anchor: 'session-tile:b', dir: 'bottom' } })
  })

  it('does nothing once four chat zones are visible', () => {
    const open = vi.fn<(options?: NewSessionTabOptions) => void>()
    $newSessionTabAction.set(open)
    $layoutTree.set(
      split('row', [
        split('column', [zone('workspace', 'g1'), zone('session-tile:b', 'g2')]),
        split('column', [zone('session-tile:c', 'g3'), zone('session-tile:d', 'g4')])
      ])
    )

    expect(splitFocusedSession()).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('reports capped state and count from the live tree', () => {
    $layoutTree.set(split('row', [zone('workspace', 'g1'), zone('session-tile:b', 'g2')]))

    expect($chatZoneCount.get()).toBe(2)
    expect($canSplitSession.get()).toBe(true)
    expect($splitSessionTab.get()).toEqual({ canSplit: true, capped: false })
  })
})
