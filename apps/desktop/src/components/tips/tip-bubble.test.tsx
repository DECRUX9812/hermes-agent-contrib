// The tip bubble's dismissal contract. A tip is the topmost dismissable
// surface while it is up (DESIGN.md), so the standard gestures must reach it:
// Esc closes it — and the prevented keydown is what keeps the composer's Esc
// gate from ALSO reading the same press as "cancel the run" (one cancel
// gesture does one thing) — and a click anywhere else closes it too.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { stubResizeObserver } from '@/test/jsdom'

import { TipBubble } from './tip-bubble'

stubResizeObserver()

beforeEach(() => {
  // Radix's popover opens with a rAF measurement pass.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  stubResizeObserver()
})

function renderBubble(onClose = vi.fn()) {
  const anchor = window.document.createElement('button')

  window.document.body.appendChild(anchor)
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <TipBubble anchor={anchor} onClose={onClose} side="right" text="A new chat gets its own context." />
    </I18nProvider>
  )

  return { anchor, onClose }
}

// Radix arms its pointerdown-outside listener on a 0ms timeout.
const settle = () => act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))))

it('Esc closes the tip and leaves the keydown marked handled for the composer', () => {
  const { onClose } = renderBubble()
  const seen: boolean[] = []
  const listener = (event: KeyboardEvent) => seen.push(event.defaultPrevented)

  // Same phase the composer's gate listens in: after Radix's document-capture
  // handler has run. A false here is the old bug — Esc swallowed with nothing
  // closed — and an unhandled press would cancel the stream as well.
  window.addEventListener('keydown', listener)
  fireEvent.keyDown(window.document.body, { key: 'Escape' })
  window.removeEventListener('keydown', listener)

  expect(onClose).toHaveBeenCalledTimes(1)
  expect(seen).toEqual([true])
})

it('a press anywhere else closes the tip', async () => {
  const { onClose } = renderBubble()

  await settle()
  fireEvent.pointerDown(window.document.body, { button: 0 })
  fireEvent.click(window.document.body)
  await settle()

  expect(onClose).toHaveBeenCalledTimes(1)
})

it('the ✕ closes the tip without a pointer-down dismissal racing it', () => {
  const { onClose } = renderBubble()
  const close = screen.getByRole('button', { name: "Don't show this tip again" })

  fireEvent.pointerDown(close, { button: 0 })
  fireEvent.click(close)

  expect(onClose).toHaveBeenCalledTimes(1)
})
