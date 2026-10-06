// Registers the avatar the cards render (the registry is populated on import).
import '../avatars/muse'

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $cards, type PaneCard } from '../director/store'
import type { NotifyRequest } from '../protocol'

import { expandedCardMaxHeight } from './card-geometry'
import { NotificationCards } from './notification-card'

function card(id: string, overrides: Partial<NotifyRequest> = {}): PaneCard {
  const request: NotifyRequest = { avatar: 'muse', body: 'A short body.', title: 'Title', ...overrides }

  return { avatar: request.avatar, id, request, shownAt: Date.now() }
}

function stubLongBody(): void {
  // jsdom has no layout: pretend the clamped body overflows so "more" renders.
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 900 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 21 })
}

beforeEach(() => {
  vi.useFakeTimers()
  $cards.set({})
})

afterEach(() => {
  // Unmount first so resetting the atom never updates a still-mounted component.
  cleanup()
  vi.useRealTimers()
  $cards.set({})
  delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight
})

describe('NotificationCards — exits (§8.5)', () => {
  it('unmounts each rapidly settled card after its own exit, leaving no hit regions', () => {
    const { container } = render(<NotificationCards />)

    act(() => {
      $cards.set({ a: card('a'), b: card('b') })
    })

    expect(container.querySelectorAll('[data-pane-card]').length).toBe(2)

    // Settle A, then B inside A's 200 ms exit window. A single shared timer
    // would have been cancelled by B's settlement and left A mounted forever.
    act(() => {
      $cards.set({ b: card('b') })
    })
    expect(container.querySelector('[data-notify-id="a"]')?.getAttribute('data-notify-leaving')).toBe('')

    act(() => {
      vi.advanceTimersByTime(50)
    })
    act(() => {
      $cards.set({})
    })

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(container.querySelector('[data-notify-id="a"]')).toBeNull()
    expect(container.querySelector('[data-notify-id="b"]')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(container.querySelectorAll('[data-notify-id]').length).toBe(0)
    expect(container.querySelectorAll('[data-pane-hit]').length).toBe(0)
  })

  it('drops a leaving card out of the hit regions at once, on it and every descendant', () => {
    const { container } = render(<NotificationCards />)

    act(() => {
      $cards.set({ a: card('a', { action: { id: 'go', label: 'Go' } }) })
    })

    const live = container.querySelector<HTMLElement>('[data-notify-id="a"]')!

    expect(live.getAttribute('data-pane-hit')).toBe('')
    expect(live.querySelectorAll('[data-pane-hit]').length).toBeGreaterThan(0)

    act(() => {
      $cards.set({})
    })

    const leaving = container.querySelector<HTMLElement>('[data-notify-id="a"]')!

    expect(leaving.getAttribute('data-notify-leaving')).toBe('')
    expect(leaving.getAttribute('data-pane-hit')).toBeNull()
    expect(leaving.querySelectorAll('[data-pane-hit]').length).toBe(0)
    expect(leaving.className).toContain('pointer-events-none')
  })
})

describe('NotificationCards — an expanded long body (§8.5, VAL-NOTIFY-007)', () => {
  it('bounds and scrolls the body, keeping the close × and the action visible', () => {
    stubLongBody()

    const { container } = render(<NotificationCards />)

    act(() => {
      $cards.set({ a: card('a', { action: { id: 'go', label: 'Go' }, body: 'word '.repeat(400) }) })
    })

    const more = [...container.querySelectorAll('button')].find(button => button.textContent === 'more')

    expect(more).toBeDefined()

    fireEvent.click(more!)

    const root = container.querySelector<HTMLElement>('[data-notify-id="a"]')!
    const body = root.querySelector('p')!
    const close = root.querySelector('button[aria-label]')!
    const action = [...root.querySelectorAll('button')].find(button => button.textContent === 'Go')!

    // The whole card is capped inside the pane and the body is the scroll box.
    expect(root.style.maxHeight).toBe(`${expandedCardMaxHeight(window.innerHeight)}px`)
    expect(root.className).toContain('flex-col')
    expect(body.className).toContain('overflow-y-auto')
    expect(body.className).not.toContain('line-clamp-3')
    // Close and action are siblings OUTSIDE the scroll container, so they stay put.
    expect(body.contains(close)).toBe(false)
    expect(body.contains(action)).toBe(false)
    expect(root.contains(close)).toBe(true)
    expect(root.contains(action)).toBe(true)
    // The frame loop reads these hooks to measure the natural height and to
    // re-fit the expanded cap against the clear band (§8.5).
    expect(root.hasAttribute('data-notify-expanded')).toBe(true)
    expect(root.querySelector('[data-notify-body]')).toBe(body)
  })
})
