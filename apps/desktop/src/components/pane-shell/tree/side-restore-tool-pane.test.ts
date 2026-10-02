/**
 * Revealing a side (Files on, ⌘J) brings back that side's minimized zones —
 * but not a tool panel's: the terminal owns its collapse through its store, so
 * turning Files on must not open an empty terminal body under it.
 */

import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import { findGroup, group, split } from './model'
import { $dismissedPanes, $hiddenTreePanes, $layoutTree, bindToolPaneCollapse, restoreMinimizedTreeSide } from './store'

const disposers: (() => void)[] = []

beforeEach(() => {
  window.localStorage.clear()
  $dismissedPanes.set(new Set())
  $hiddenTreePanes.set(new Set())

  for (const [id, data] of [
    ['workspace', { placement: 'main', uncloseable: true }],
    ['files', { placement: 'right' }],
    ['terminal', { placement: 'bottom' }]
  ] as const) {
    disposers.push(registry.register({ area: 'panes', data, id, render: () => null, title: id }))
  }
})

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
})

it('restores the side’s own zones and leaves a closed tool panel collapsed', () => {
  $layoutTree.set(
    split('row', [
      group(['workspace'], { active: 'workspace', id: 'grp-main' }),
      split('column', [
        group(['files'], { active: 'files', id: 'grp-files', minimized: true }),
        group(['terminal'], { active: 'terminal', id: 'grp-terminal', minimized: true })
      ])
    ])
  )

  const $terminal = atom(false)
  bindToolPaneCollapse(
    'terminal',
    $terminal,
    () => $terminal.set(false),
    () => $terminal.set(true)
  )

  restoreMinimizedTreeSide('right')

  const tree = $layoutTree.get()!
  expect(findGroup(tree, 'grp-files')?.minimized).toBeFalsy()
  expect(findGroup(tree, 'grp-terminal')?.minimized).toBe(true)
})
