import { type RefObject, useLayoutEffect, useRef } from 'react'

const FLIP_MS = 220
const FADE_MS = 120
const FALLBACK_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const MIN_SHIFT_PX = 0.5
const FLIP_SELECTOR = '[data-flip-key]'

interface Snapshot {
  key: string
  keys: Set<string>
  tops: Map<string, number>
}

const running = new WeakMap<Element, Animation>()

let springEasing: string | null = null

// The spring the app's motion system uses, read once — every FLIP glide then
// shares the same curve as the rest of the interface.
function flipEasing(): string {
  if (springEasing === null) {
    const root = document.documentElement

    const value =
      root.style.getPropertyValue('--ease-spring').trim() ||
      getComputedStyle(root).getPropertyValue('--ease-spring').trim()

    springEasing = value || FALLBACK_EASING
  }

  return springEasing
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function measure(container: HTMLElement): Map<string, number> {
  const origin = container.getBoundingClientRect().top - container.scrollTop
  const tops = new Map<string, number>()

  for (const el of container.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
    tops.set(el.dataset.flipKey ?? '', el.getBoundingClientRect().top - origin)
  }

  return tops
}

function start(el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): void {
  // jsdom and older engines have no Web Animations API — motion is
  // enhancement, so its absence skips the glide instead of crashing.
  if (typeof el.animate !== 'function') {
    return
  }

  running.get(el)?.cancel()
  running.set(el, el.animate(frames, options))
}

// Rows that changed slot glide from where they were to where they are now.
// `translate` rather than `transform`, so it stacks with the virtual list's
// own translateY positioning and dnd-kit's drag transform instead of
// overwriting either.
export function useFlipList(containerRef: RefObject<HTMLElement | null>, orderKey: string): void {
  const last = useRef<Snapshot | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const previous = last.current
    const keys = new Set(orderKey.length ? orderKey.split('\n') : [])
    const reordered = previous !== null && previous.key !== orderKey
    const tops = measure(container)

    if (reordered && !prefersReducedMotion() && (typeof container.checkVisibility !== 'function' || container.checkVisibility())) {
      // A row flung further than this didn't glide — the list rebuilt under
      // it. Animating that distance reads as a bug, not motion.
      const maxShift = container.clientHeight * 2

      for (const el of container.querySelectorAll<HTMLElement>(FLIP_SELECTOR)) {
        // The row owns the drag state on its own root, inside the flip
        // wrapper — never animate a row mid-drag.
        if (el.hasAttribute('data-dragging') || el.querySelector('[data-dragging]')) {
          continue
        }

        const key = el.dataset.flipKey ?? ''
        const from = previous.tops.get(key)
        const to = tops.get(key)

        if (from === undefined || to === undefined) {
          // New to this order (and not the list's first paint): fade in.
          // Keyed on the previous ORDER, not the mounted set, so rows that
          // merely scrolled into a virtual window never flash.
          if (!previous.keys.has(key)) {
            start(el, [{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' })
          }

          continue
        }

        const shift = from - to

        if (Math.abs(shift) < MIN_SHIFT_PX || (maxShift > 0 && Math.abs(shift) >= maxShift)) {
          continue
        }

        start(
          el,
          [{ translate: `0 ${shift}px` }, { translate: '0 0' }],
          { duration: FLIP_MS, easing: flipEasing() }
        )
      }
    }

    last.current = { key: orderKey, keys, tops }
  }, [containerRef, orderKey])
}
