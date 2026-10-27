import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $browserFloat, clearBrowserFloat, floatBrowserTab } from '@/store/browser-float'
import {
  $dockedVisiblePreviewTabs,
  $floatingBrowserTabId,
  $previewTabs,
  closeRightRail,
  openPreview
} from '@/store/preview'

import { BrowserFloat } from './browser-float'

vi.mock('./right-rail/preview', () => ({
  PreviewTilePane: ({ tabId }: { tabId: string }) => <div data-testid="page">{tabId}</div>
}))

function floatExample() {
  openPreview({ kind: 'url', label: 'Example', source: 'https://example.com', url: 'https://example.com' })

  const id = $previewTabs.get()[0]!.id

  floatBrowserTab(id)
  $browserFloat.set({ minimized: false, rect: { height: 300, width: 400, x: 300, y: 200 } })

  return id
}

beforeEach(() => {
  window.localStorage.clear()
  closeRightRail()
  clearBrowserFloat()
})

afterEach(() => {
  cleanup()
  clearBrowserFloat()
  closeRightRail()
})

describe('BrowserFloat', () => {
  it('renders nothing until a Browser floats', () => {
    const { container } = render(<BrowserFloat />)

    expect(container.innerHTML).toBe('')
  })

  it('renders the floating tab page in a labelled window', () => {
    const id = floatExample()

    render(<BrowserFloat />)

    expect(screen.getByRole('region', { name: 'Floating browser' })).toBeTruthy()
    expect(screen.getByTestId('page').textContent).toBe(id)
  })

  it('minimises to a pill and restores from it', () => {
    floatExample()
    render(<BrowserFloat />)

    fireEvent.click(screen.getByRole('button', { name: 'Minimize (Esc)' }))

    expect(screen.queryByRole('region', { name: 'Floating browser' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show floating browser' }))

    expect(screen.getByRole('region', { name: 'Floating browser' })).toBeTruthy()
  })

  it('docks back into the layout from the title bar', () => {
    const id = floatExample()

    render(<BrowserFloat />)
    fireEvent.click(screen.getByRole('button', { name: 'Dock to the right' }))

    expect($floatingBrowserTabId.get()).toBeNull()
    expect($dockedVisiblePreviewTabs.get().map(tab => tab.id)).toContain(id)
    expect(screen.queryByRole('region', { name: 'Floating browser' })).toBeNull()
  })

  it('lets go of the float when its tab closes', () => {
    floatExample()
    render(<BrowserFloat />)

    act(() => closeRightRail())

    expect($floatingBrowserTabId.get()).toBeNull()
  })
})
