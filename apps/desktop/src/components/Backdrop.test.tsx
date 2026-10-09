import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackdropSceneGrid } from '@/app/settings/backdrop-setting'
import { Backdrop } from '@/components/Backdrop'
import {
  $backdropAutoTick,
  $backdropImage,
  $backdropScene,
  $backdropStrength,
  isBackdropAutoTimerActive,
  setBackdropScene
} from '@/store/backdrop'

describe('Backdrop component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    $backdropScene.set('auto')
    $backdropStrength.set('balanced')
    $backdropImage.set(null)
    $backdropAutoTick.set(0)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('resolves auto scene according to local time of day', () => {
    // 08:00 (dawn) -> aurora
    vi.setSystemTime(new Date(2026, 9, 8, 8, 0, 0))
    const r1 = render(<Backdrop />)
    expect(r1.container.querySelector('[data-backdrop-scene="aurora"]')).toBeTruthy()
    r1.unmount()

    // 14:00 (day) -> ocean
    vi.setSystemTime(new Date(2026, 9, 8, 14, 0, 0))
    const r2 = render(<Backdrop />)
    expect(r2.container.querySelector('[data-backdrop-scene="ocean"]')).toBeTruthy()
    r2.unmount()

    // 19:00 (evening) -> dusk
    vi.setSystemTime(new Date(2026, 9, 8, 19, 0, 0))
    const r3 = render(<Backdrop />)
    expect(r3.container.querySelector('[data-backdrop-scene="dusk"]')).toBeTruthy()
    r3.unmount()

    // 23:00 (night) -> ink
    vi.setSystemTime(new Date(2026, 9, 8, 23, 0, 0))
    const r4 = render(<Backdrop />)
    expect(r4.container.querySelector('[data-backdrop-scene="ink"]')).toBeTruthy()
    r4.unmount()

    // 03:00 (night wrap) -> ink
    vi.setSystemTime(new Date(2026, 9, 8, 3, 0, 0))
    const r5 = render(<Backdrop />)
    expect(r5.container.querySelector('[data-backdrop-scene="ink"]')).toBeTruthy()
    r5.unmount()
  })

  it('manages auto timer lifecycle: active in auto, cleared on leaving or unmount', async () => {
    vi.setSystemTime(new Date(2026, 9, 8, 10, 59, 0)) // 10:59 -> dawn (aurora)

    const { container, unmount } = render(<Backdrop />)
    expect(container.querySelector('[data-backdrop-scene="aurora"]')).toBeTruthy()
    expect(isBackdropAutoTimerActive()).toBe(true)

    // The 60s interval fires and bumps the tick the component re-renders from.
    // (The hour -> scene mapping itself is covered by the test above, which
    // sets the clock BEFORE render; re-resolving mid-flight under fake timers
    // races sinon's clock, a test-env artifact the real clock never has.)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect($backdropAutoTick.get()).toBe(1)

    // Switching away from auto clears the timer. Assert the flag and a frozen
    // tick rather than a raw timer count: setBackdropScene persists to
    // localStorage, and jsdom schedules its own housekeeping timers for writes.
    act(() => {
      setBackdropScene('dusk')
    })
    expect(isBackdropAutoTimerActive()).toBe(false)
    const tickAfterLeave = $backdropAutoTick.get()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000)
    })
    expect($backdropAutoTick.get()).toBe(tickAfterLeave)

    // Switching back to auto starts the timer
    act(() => {
      setBackdropScene('auto')
    })
    expect(isBackdropAutoTimerActive()).toBe(true)

    // Unmounting cleans up timer
    unmount()
    expect(isBackdropAutoTimerActive()).toBe(false)
  })

  it('renders nothing when backdrop is off', () => {
    $backdropScene.set('off')
    const { container } = render(<Backdrop />)
    expect(container.firstChild).toBeNull()
    expect(isBackdropAutoTimerActive()).toBe(false)
  })

  it('BackdropSceneGrid renders the Auto swatch with label and caption', () => {
    render(<BackdropSceneGrid />)

    const autoTile = screen.getByRole('button', { name: /Auto/i })
    expect(autoTile).toBeTruthy()
    expect(autoTile.getAttribute('data-backdrop-tile')).toBe('auto')
    expect(screen.getByText('follows the time of day')).toBeTruthy()

    // Preview swatch container has background applied
    const previewBox = autoTile.querySelector('div')
    expect(previewBox).toBeTruthy()
  })
})
