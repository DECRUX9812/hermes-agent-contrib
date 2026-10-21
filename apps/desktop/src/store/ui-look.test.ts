/**
 * The look is painted on <html> and persisted: Soft by default (nothing stored),
 * Classic only when the user chose it, and the interface mode rides along so the
 * Soft + Simple sizing rule in styles.css can key off one element.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('ui-look', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
    delete document.documentElement.dataset.look
    delete document.documentElement.dataset.interfaceMode
  })

  it('defaults to Soft and paints it without storing anything', async () => {
    const { $uiLook } = await import('./ui-look')

    expect($uiLook.get()).toBe('soft')
    expect(document.documentElement.dataset.look).toBe('soft')
    expect(window.localStorage.getItem('hermes.desktop.look.v1')).toBeNull()
  })

  it('keeps Classic across a restart once chosen, and Soft clears the choice', async () => {
    const first = await import('./ui-look')

    first.setUiLook('classic')
    expect(document.documentElement.dataset.look).toBe('classic')

    vi.resetModules()
    const second = await import('./ui-look')

    expect(second.$uiLook.get()).toBe('classic')
    second.setUiLook('soft')
    expect(window.localStorage.getItem('hermes.desktop.look.v1')).toBeNull()
  })

  it('mirrors the interface mode onto the root element', async () => {
    await import('./ui-look')
    const { setInterfaceMode } = await import('./interface-mode')

    setInterfaceMode('simple')
    expect(document.documentElement.dataset.interfaceMode).toBe('simple')
    setInterfaceMode('advanced')
    expect(document.documentElement.dataset.interfaceMode).toBe('advanced')
  })

  it('treats anything but "classic" as Soft', async () => {
    const { parseUiLook } = await import('./ui-look')

    expect(parseUiLook('classic')).toBe('classic')
    expect(parseUiLook('square')).toBe('soft')
    expect(parseUiLook(null)).toBe('soft')
  })
})
