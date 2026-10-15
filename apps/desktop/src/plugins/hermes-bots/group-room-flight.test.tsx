import { render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findMemberFace, useHandoffFlights } from './group-room-flight'
import type { RoomHandoff } from './group-room-handoffs'

const KEYS: Record<string, string> = { atlas: 'k:atlas', pixel: 'k:pixel' }

function handoff(id: string, at: number, from = 'atlas', to = 'pixel'): RoomHandoff {
  return {
    at,
    doneWhen: '',
    dueMinutes: null,
    from,
    fromUser: false,
    id,
    index: 0,
    line: 0,
    reply: '',
    replyIndex: -1,
    stale: 'fresh',
    status: 'open',
    task: 'draft the hero layout',
    thread: 't1',
    to,
    why: ''
  }
}

function Room({ handoffs, reset = 'room-a' }: { handoffs: RoomHandoff[]; reset?: string }) {
  const root = useRef<HTMLDivElement>(null)
  useHandoffFlights(root, handoffs, name => KEYS[name] || null, reset)

  return (
    <div ref={root}>
      <span data-member-face="k:atlas" data-testid="header-atlas" />
      <div data-testid="group-room-aside">
        <span data-member-face="k:atlas" data-testid="aside-atlas" />
        <span data-member-face="k:pixel" data-testid="aside-pixel" />
      </div>
    </div>
  )
}

const animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 32, 32))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }) as MediaQueryList)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  animate.mockClear()
  delete (HTMLElement.prototype as { animate?: unknown }).animate
  document.querySelectorAll('[data-motion-ghost]').forEach(node => node.remove())
})

const ghostFlights = () =>
  animate.mock.contexts.filter(node => (node as HTMLElement).dataset.motionGhost === 'true').length

describe('useHandoffFlights', () => {
  it('does not fly handoffs that were already there when the room opened', () => {
    const { rerender } = render(<Room handoffs={[handoff('h1', Date.now() - 60_000)]} />)
    rerender(<Room handoffs={[handoff('h1', Date.now() - 60_000)]} />)

    expect(ghostFlights()).toBe(0)
  })

  it('flies a card for a handoff that lands while the room is open', () => {
    const { rerender } = render(<Room handoffs={[]} />)
    rerender(<Room handoffs={[handoff('h2', Date.now() + 1)]} />)

    expect(ghostFlights()).toBe(1)
    expect(document.querySelector('[data-motion-ghost]')?.textContent).toContain('draft the hero layout')
  })

  it('stays still under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }) as MediaQueryList)
    const { rerender } = render(<Room handoffs={[]} />)
    rerender(<Room handoffs={[handoff('h3', Date.now() + 1)]} />)

    expect(animate).not.toHaveBeenCalled()
  })

  it('treats a room switch as a new baseline', () => {
    const { rerender } = render(<Room handoffs={[]} />)
    rerender(<Room handoffs={[handoff('h4', Date.now() + 1)]} reset="room-b" />)

    expect(ghostFlights()).toBe(0)
  })
})

describe('findMemberFace', () => {
  it('prefers the members panel face over the header pile', () => {
    const { getByTestId } = render(<Room handoffs={[]} />)

    expect(findMemberFace(document.body, 'k:atlas')).toBe(getByTestId('aside-atlas'))
  })
})
