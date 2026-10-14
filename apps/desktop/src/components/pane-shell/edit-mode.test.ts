/**
 * Layout edit mode force-shows toggle-hidden panes so they can be rearranged.
 * In Simple those panes rest by policy, so edit mode must arrange what Simple
 * shows — otherwise opening the layout editor brings every machinery tab back.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { seedExistingInstall } from '@/test/jsdom'

describe('$layoutEditRevealsHidden', () => {
  beforeEach(() => {
    window.localStorage.clear()
    seedExistingInstall()
    vi.resetModules()
  })

  it('reveals hidden panes in Advanced only', async () => {
    const { $layoutEditMode, $layoutEditRevealsHidden } = await import('./edit-mode')
    const { setInterfaceMode } = await import('@/store/interface-mode')

    expect($layoutEditRevealsHidden.get()).toBe(false)

    $layoutEditMode.set(true)
    expect($layoutEditRevealsHidden.get()).toBe(true)

    setInterfaceMode('simple')
    expect($layoutEditRevealsHidden.get()).toBe(false)

    setInterfaceMode('advanced')
    expect($layoutEditRevealsHidden.get()).toBe(true)
  })
})
