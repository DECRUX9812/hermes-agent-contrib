import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  $browserFloat,
  browserDockSide,
  clampFloatRect,
  clearBrowserFloat,
  defaultFloatRect,
  dockBrowserFloat,
  dockSideForPointer,
  FLOAT_MARGIN,
  FLOAT_MIN_HEIGHT,
  FLOAT_MIN_WIDTH,
  floatBrowserTab,
  floatPillOffset,
  minimizeBrowserFloatFrom,
  snapFloatRect,
  toggleBrowserFloat,
  toggleBrowserOrDockFloat
} from './browser-float'
import { $paneStates } from './panes'
import { $dockedVisiblePreviewTabs, $floatingBrowserTabId, $previewTabs, closeRightRail, openPreview } from './preview'

const viewport = { height: 800, width: 1200 }

function openExample() {
  openPreview({ kind: 'url', label: 'Example', source: 'https://example.com', url: 'https://example.com' })

  return $previewTabs.get()[0]!.id
}

beforeEach(() => {
  window.localStorage.clear()
  closeRightRail()
  clearBrowserFloat()
  $browserFloat.set({ minimized: false, rect: null })
  $paneStates.set({})
})

afterEach(() => {
  clearBrowserFloat()
  closeRightRail()
  document.body.innerHTML = ''
})

describe('float geometry', () => {
  it('opens in the bottom-right corner, inside the margin', () => {
    const rect = defaultFloatRect(viewport)

    expect(rect.x + rect.width).toBe(viewport.width - FLOAT_MARGIN)
    expect(rect.y + rect.height).toBe(viewport.height - FLOAT_MARGIN)
  })

  it('clamps onto the screen and to the minimum size', () => {
    expect(clampFloatRect({ height: 10, width: 10, x: -500, y: 5000 }, viewport)).toEqual({
      height: FLOAT_MIN_HEIGHT,
      width: FLOAT_MIN_WIDTH,
      x: FLOAT_MARGIN,
      y: viewport.height - FLOAT_MIN_HEIGHT - FLOAT_MARGIN
    })
  })

  it('snaps each axis to a nearby edge and leaves the middle alone', () => {
    const near = snapFloatRect({ height: 300, width: 400, x: 30, y: viewport.height - 300 - 40 }, viewport)

    expect(near).toMatchObject({ x: FLOAT_MARGIN, y: viewport.height - 300 - FLOAT_MARGIN })

    const middle = snapFloatRect({ height: 300, width: 400, x: 400, y: 250 }, viewport)

    expect(middle).toMatchObject({ x: 400, y: 250 })
  })

  it('docks only when released against a side edge', () => {
    expect(dockSideForPointer(2, viewport)).toBe('left')
    expect(dockSideForPointer(viewport.width - 1, viewport)).toBe('right')
    expect(dockSideForPointer(600, viewport)).toBeNull()
  })

  it('seats the minimised pill bottom-right, above the status bar and clear of the title bar', () => {
    expect(floatPillOffset(viewport, { bottom: 20, top: 34 }, 30)).toEqual({ bottom: 20 + FLOAT_MARGIN, right: FLOAT_MARGIN })

    // A window too short to fit it above the status bar keeps it under the title bar.
    const short = floatPillOffset({ height: 90, width: 400 }, { bottom: 40, top: 34 }, 30)

    expect(90 - short.bottom - 30).toBeGreaterThanOrEqual(34)
    expect(short.bottom).toBeGreaterThanOrEqual(0)
  })
})

describe('floating a Browser tab', () => {
  it('lifts the tab out of the docked tree while it floats', () => {
    const id = openExample()

    floatBrowserTab(id)

    expect($floatingBrowserTabId.get()).toBe(id)
    expect($dockedVisiblePreviewTabs.get().map(tab => tab.id)).not.toContain(id)
    expect($browserFloat.get().rect).not.toBeNull()
  })

  it('ignores tabs that are not web pages', () => {
    openPreview({ kind: 'file', label: 'notes.md', source: '/work/notes.md', url: 'file:///work/notes.md' })

    floatBrowserTab($previewTabs.get()[0]!.id)

    expect($floatingBrowserTabId.get()).toBeNull()
  })

  it('opens a Browser to float when none is given', () => {
    toggleBrowserFloat()

    const id = $floatingBrowserTabId.get()

    expect(id).not.toBeNull()
    expect($previewTabs.get().find(tab => tab.id === id)?.target.kind).toBe('url')
  })

  it('toggles between minimised and open once floating', () => {
    floatBrowserTab(openExample())

    toggleBrowserFloat()
    expect($browserFloat.get().minimized).toBe(true)

    toggleBrowserFloat()
    expect($browserFloat.get().minimized).toBe(false)
  })

  it('docks back into the tree at the float width, on the chosen side', () => {
    const id = openExample()

    floatBrowserTab(id)
    $browserFloat.set({ minimized: false, rect: { height: 400, width: 512.4, x: 20, y: 20 } })

    dockBrowserFloat('left')

    expect($floatingBrowserTabId.get()).toBeNull()
    expect($dockedVisiblePreviewTabs.get().map(tab => tab.id)).toContain(id)
    expect($paneStates.get()[`preview-tile:${id}`]?.widthOverride).toBe(512)
    expect(browserDockSide(id)).toBe('left')
  })

  it('docks the float back on the Browser toggle instead of opening another pane', () => {
    const id = openExample()

    floatBrowserTab(id)
    toggleBrowserOrDockFloat()

    expect($floatingBrowserTabId.get()).toBeNull()
    expect($previewTabs.get()).toHaveLength(1)
    expect($dockedVisiblePreviewTabs.get().map(tab => tab.id)).toContain(id)
  })

  it('persists the geometry but not the minimised state', () => {
    floatBrowserTab(openExample())
    toggleBrowserFloat()

    const stored = JSON.parse(window.localStorage.getItem('hermes.desktop.browserFloat.v1') ?? '{}')

    expect(stored.rect).toEqual($browserFloat.get().rect)
    expect(stored).not.toHaveProperty('minimized')
  })
})

describe('Escape inside the float', () => {
  it('minimises when focus is inside the float', () => {
    floatBrowserTab(openExample())
    document.body.innerHTML = '<section data-browser-float><input id="inside" /></section><input id="outside" />'

    expect(minimizeBrowserFloatFrom(document.getElementById('outside'))).toBe(false)
    expect($browserFloat.get().minimized).toBe(false)

    expect(minimizeBrowserFloatFrom(document.getElementById('inside'))).toBe(true)
    expect($browserFloat.get().minimized).toBe(true)

    // Already a pill: Escape falls through to its usual meaning.
    expect(minimizeBrowserFloatFrom(document.getElementById('inside'))).toBe(false)
  })
})
