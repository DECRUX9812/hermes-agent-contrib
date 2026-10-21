import { atom } from 'nanostores'

/**
 * Reduced motion (architecture §8.4). The OS setting is read through
 * `matchMedia` and subscribed to its `change` event, so a runtime change (or a
 * CDP `Emulation.setEmulatedMedia` on the pane target) takes effect without a
 * reload. `init.reducedMotion` can force it on; it can never force it off.
 */
const QUERY = '(prefers-reduced-motion: reduce)'

const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null

let forced = false
let mediaMatches = media?.matches ?? false

export const $reducedMotion = atom(mediaMatches)

export function setReducedMotion(value: boolean): void {
  forced = value
  $reducedMotion.set(forced || mediaMatches)
}

export function prefersReducedMotion(): boolean {
  return $reducedMotion.get()
}

if (media) {
  const onChange = (event: MediaQueryListEvent) => {
    mediaMatches = event.matches
    $reducedMotion.set(forced || mediaMatches)
  }

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange)
  } else {
    // Older Safari only has the deprecated listener.
    media.addListener(onChange)
  }
}
