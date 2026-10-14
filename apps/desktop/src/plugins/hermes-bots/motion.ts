/**
 * Motion helpers for Bot Mode surfaces (DESIGN.md § Motion).
 *
 * Everything here animates transform and opacity only, through the Web
 * Animations API, and does nothing when the user asked for reduced motion.
 * CSS loops (working ring, shimmer) live in src/design/motion.css.
 */

import type { RefObject } from 'react'
import { useLayoutEffect, useRef } from 'react'

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'
const EASE_OUT_QUINT = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EASE_SPRING = 'cubic-bezier(0.34, 1.36, 0.64, 1)'

export const MOTION_MS = { enter: 200, flight: 240, panel: 220, pop: 160, reorder: 200 } as const

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }

  return window.matchMedia(REDUCED_QUERY).matches
}

function canAnimate(el: Element | null | undefined): el is HTMLElement {
  return Boolean(el && typeof (el as HTMLElement).animate === 'function') && !prefersReducedMotion()
}

/**
 * FLIP for a list whose items carry `data-flip-key`: after a commit that moved
 * an item, it starts at its old place and glides to the new one. Positions are
 * kept relative to the container, so scrolling an ancestor never reads as a
 * move. `signature` should change exactly when the order or grouping does;
 * other renders only refresh the snapshot.
 */
export function useFlip(container: RefObject<HTMLElement | null>, signature: string): void {
  const last = useRef<Map<string, DOMRect>>(new Map())
  const lastSignature = useRef(signature)

  useLayoutEffect(() => {
    const root = container.current

    if (!root) {
      return
    }

    const origin = root.getBoundingClientRect()
    const next = new Map<string, DOMRect>()
    const nodes = root.querySelectorAll<HTMLElement>('[data-flip-key]')

    nodes.forEach(node => {
      const rect = node.getBoundingClientRect()
      next.set(
        node.dataset.flipKey || '',
        new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height)
      )
    })

    const moved = lastSignature.current !== signature
    const previous = last.current
    last.current = next
    lastSignature.current = signature

    if (!moved || !canAnimate(root)) {
      return
    }

    nodes.forEach(node => {
      const before = previous.get(node.dataset.flipKey || '')
      const after = next.get(node.dataset.flipKey || '')

      if (!after) {
        return
      }

      if (!before) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION_MS.enter, easing: EASE_OUT_QUINT })

        return
      }

      const dx = before.left - after.left
      const dy = before.top - after.top

      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return
      }

      node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: MOTION_MS.reorder,
        easing: EASE_OUT_QUINT
      })
    })
  })
}

/** A face (or any element) briefly swells and settles: "this just reached you". */
export function popElement(el: Element | null | undefined): void {
  if (!canAnimate(el)) {
    return
  }

  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], {
    duration: MOTION_MS.pop,
    easing: EASE_SPRING
  })
}

/**
 * A ghost of `ghost` (or a small dot) flies from `from` to `to`, then `to`
 * pops. Used for a handoff: the work visibly leaves one face and lands on the
 * other. The ghost is fixed-position in <body>, so no layout around it moves.
 */
export function flyBetween(
  from: Element | null | undefined,
  to: Element | null | undefined,
  ghost?: HTMLElement | null
): Promise<void> {
  if (!from || !to || !canAnimate(to)) {
    return Promise.resolve()
  }

  const a = from.getBoundingClientRect()
  const z = to.getBoundingClientRect()

  if (!a.width || !z.width) {
    return Promise.resolve()
  }

  const node = ghost ? (ghost.cloneNode(true) as HTMLElement) : document.createElement('div')
  const size = ghost ? a.width : 10
  node.setAttribute('aria-hidden', 'true')
  node.dataset.motionGhost = 'true'
  Object.assign(node.style, {
    borderRadius: '9999px',
    height: `${size}px`,
    left: `${a.left + a.width / 2 - size / 2}px`,
    margin: '0',
    pointerEvents: 'none',
    position: 'fixed',
    top: `${a.top + a.height / 2 - size / 2}px`,
    width: `${size}px`,
    zIndex: '60'
  })

  if (!ghost) {
    node.style.background = 'var(--color-brand)'
    node.style.boxShadow = '0 0 0 3px color-mix(in oklab, var(--color-brand) 25%, transparent)'
  }

  document.body.appendChild(node)
  const dx = z.left + z.width / 2 - (a.left + a.width / 2)
  const dy = z.top + z.height / 2 - (a.top + a.height / 2)

  const flight = node.animate(
    [
      { opacity: 0, transform: 'translate(0, 0) scale(0.6)' },
      { offset: 0.15, opacity: 1, transform: `translate(${dx * 0.12}px, ${dy * 0.12}px) scale(1)` },
      { opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(0.7)` }
    ],
    { duration: MOTION_MS.flight, easing: EASE_OUT_QUINT }
  )

  return flight.finished
    .catch(() => undefined)
    .then(() => {
      node.remove()
      popElement(to)
    })
}

/**
 * Which rows arrived while this view was open. Keys present on the first
 * render (and anything older than the mount, e.g. history that loads late)
 * never animate; a key first seen later does, once per element mount.
 * `reset` (room id) starts a new baseline.
 */
export function useArrivals(reset: string): (key: string, at?: number) => boolean {
  const state = useRef<{ arrived: Set<string>; mountedAt: number; reset: string; seen: Set<string> | null }>({
    arrived: new Set(),
    mountedAt: Date.now(),
    reset,
    seen: null
  })

  if (state.current.reset !== reset) {
    state.current = { arrived: new Set(), mountedAt: Date.now(), reset, seen: null }
  }

  const current = state.current
  const baseline = current.seen === null
  const seen = current.seen ?? new Set<string>()
  current.seen = seen

  return (key: string, at?: number) => {
    if (current.arrived.has(key)) {
      return true
    }

    if (seen.has(key)) {
      return false
    }

    seen.add(key)

    if (baseline || (at !== undefined && at < current.mountedAt)) {
      return false
    }

    current.arrived.add(key)

    return true
  }
}
