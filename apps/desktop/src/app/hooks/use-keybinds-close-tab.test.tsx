import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

const closeActiveTab = vi.fn<(load?: (storedSessionId: string) => void) => boolean>(() => true)

vi.mock('@/app/chat/close-tab', () => ({
  closeActiveTab: (load?: (storedSessionId: string) => void) => closeActiveTab(load)
}))

vi.mock('@/themes/context', () => ({
  useTheme: () => ({ resolvedMode: 'dark', setMode: vi.fn() })
}))

import { useKeybinds } from './use-keybinds'

const deps = {
  toggleCommandCenter: vi.fn(),
  startFreshSession: vi.fn(),
  openNewSessionTab: vi.fn(),
  toggleSelectedPin: vi.fn(),
  archiveSelectedSession: vi.fn()
}

function mount() {
  return renderHook(() => useKeybinds(deps), {
    wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>
  })
}

// jsdom is not macOS, so `mod` is Ctrl: Ctrl+W resolves to view.closeTab.
function ctrlW(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'KeyW',
    ctrlKey: true,
    key: 'w'
  })

  window.dispatchEvent(event)

  return event
}

function focusTerminal(): HTMLElement {
  const term = document.createElement('div')
  term.setAttribute('data-terminal', '')
  const inner = document.createElement('textarea')
  term.append(inner)
  document.body.append(term)
  inner.focus()

  return term
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  closeActiveTab.mockClear()
})

describe('view.closeTab vs a focused terminal', () => {
  it('yields Ctrl+W to the terminal — the readline word-erase chord must not kill the pane', () => {
    mount()
    focusTerminal()

    const event = ctrlW()

    expect(closeActiveTab).not.toHaveBeenCalled()
    // Unclaimed, so the press propagates down to xterm and into the PTY.
    expect(event.defaultPrevented).toBe(false)
  })

  it('still closes the focused tab when focus is outside a terminal', () => {
    mount()

    const event = ctrlW()

    expect(closeActiveTab).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })
})
