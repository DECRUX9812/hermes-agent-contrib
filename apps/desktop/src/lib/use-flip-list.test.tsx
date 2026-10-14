import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlipList } from './use-flip-list'

let animated: { frames: Keyframe[]; key: string; options: KeyframeAnimationOptions }[] = []

function List({ order }: { order: string[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useFlipList(ref, order.join('\n'))

  return (
    <div ref={ref}>
      {order.map((id, index) => (
        <div data-flip-key={id} data-y={index * 20} key={id}>
          {id}
        </div>
      ))}
    </div>
  )
}

beforeEach(() => {
  animated = []
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: function (this: HTMLElement, frames: Keyframe[], options?: KeyframeAnimationOptions) {
      animated.push({ frames, key: this.dataset.flipKey ?? '', options: options ?? {} })

      return { cancel: vi.fn() }
    },
    writable: true
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const y = Number((this as HTMLElement).dataset.y ?? 0)

    return { bottom: y, height: 0, left: 0, right: 0, top: y, width: 0, x: 0, y } as DOMRect
  })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(Element.prototype, 'animate')
})

describe('useFlipList', () => {
  it('does not animate on the first render', () => {
    render(<List order={['a', 'b', 'c']} />)

    expect(animated).toEqual([])
  })

  it('glides only the rows that moved, from their old slot to their new one', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />)

    rerender(<List order={['b', 'a', 'c']} />)

    expect(animated.map(({ key }) => key).sort()).toEqual(['a', 'b'])
    expect(animated.find(({ key }) => key === 'a')?.frames).toEqual([
      { translate: '0 -20px' },
      { translate: '0 0' }
    ])
    expect(animated.find(({ key }) => key === 'b')?.frames).toEqual([
      { translate: '0 20px' },
      { translate: '0 0' }
    ])
  })

  it('animates with translate, not transform, so it stacks with the list positioning', () => {
    const { rerender } = render(<List order={['a', 'b']} />)

    rerender(<List order={['b', 'a']} />)

    expect(animated.length).toBeGreaterThan(0)

    for (const { frames } of animated) {
      for (const frame of frames) {
        expect(frame).not.toHaveProperty('transform')
      }
    }
  })

  it('stays still when the order is unchanged', () => {
    const { rerender } = render(<List order={['a', 'b', 'c']} />)

    rerender(<List order={['a', 'b', 'c']} />)

    expect(animated).toEqual([])
  })

  it('fades a row that joins the order instead of gliding it from nowhere', () => {
    const { rerender } = render(<List order={['a', 'b']} />)

    rerender(<List order={['a', 'b', 'c']} />)

    const fade = animated.find(({ key }) => key === 'c')
    expect(fade?.frames).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(fade?.options.duration).toBe(120)
    expect(animated.filter(({ key }) => key === 'a' || key === 'b')).toEqual([])
  })

  it('does not fade a row that was already in the order', () => {
    const { rerender } = render(<List order={['a', 'b']} />)

    // 'b' remounts at a new slot but belonged to the previous order, so it
    // glides from its old offset instead of flashing in.
    rerender(<List order={['b', 'a']} />)

    for (const { frames } of animated) {
      expect(frames).not.toEqual([{ opacity: 0 }, { opacity: 1 }])
    }
  })

  it('stays still when reduced motion is requested', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    const { rerender } = render(<List order={['a', 'b']} />)

    rerender(<List order={['b', 'a']} />)

    expect(animated).toEqual([])
  })
})
