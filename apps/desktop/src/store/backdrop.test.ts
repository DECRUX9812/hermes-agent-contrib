import { beforeEach, describe, expect, it, vi } from 'vitest'

// The picker replaced a boolean: a v1 user's stored "on" must come back as the
// statue they had, and the v1 key keeps tracking on/off for the plugin SDK.
async function load(seed: Record<string, string> = {}) {
  vi.resetModules()
  window.localStorage.clear()

  for (const [key, value] of Object.entries(seed)) {
    window.localStorage.setItem(key, value)
  }

  return import('./backdrop')
}

describe('backdrop store', () => {
  beforeEach(() => window.localStorage.clear())

  it("migrates a v1 'on' to the statue and a missing setting to off", async () => {
    expect((await load({ 'hermes.desktop.backdrop.v1': 'true' })).$backdropScene.get()).toBe('statue')
    expect((await load()).$backdropScene.get()).toBe('off')
  })

  it('keeps the v1 boolean view and key in step with the scene', async () => {
    const store = await load()

    store.setBackdropScene('aurora')
    expect(store.$backdrop.get()).toBe(true)
    expect(window.localStorage.getItem('hermes.desktop.backdrop.v1')).toBe('true')

    // v1 "on" never downgrades a chosen scene to the statue.
    store.setBackdrop(true)
    expect(store.$backdropScene.get()).toBe('aurora')

    store.setBackdrop(false)
    expect(store.$backdropScene.get()).toBe('off')
    expect(window.localStorage.getItem('hermes.desktop.backdrop.v1')).toBe('false')
  })

  it('choosing an image shows it; forgetting it leaves the custom scene', async () => {
    const store = await load()

    store.setBackdropImage('data:image/jpeg;base64,abc')
    expect(store.$backdropScene.get()).toBe('custom')

    store.setBackdropImage(null)
    expect(store.$backdropScene.get()).toBe('off')
    expect(window.localStorage.getItem('hermes.desktop.backdrop.image.v1')).toBeNull()
  })

  it("persists 'auto' round-trip and records feature toggle", async () => {
    const store = await load()
    const metrics = await import('./desktop-metrics')
    const spy = vi.spyOn(metrics, 'recordFeatureToggle')

    store.setBackdropScene('auto')

    expect(store.$backdropScene.get()).toBe('auto')
    expect(store.$backdrop.get()).toBe(true)
    expect(window.localStorage.getItem('hermes.desktop.backdrop.scene.v2')).toBe('auto')
    expect(window.localStorage.getItem('hermes.desktop.backdrop.v1')).toBe('true')
    expect(spy).toHaveBeenCalledWith('backdrop', false, true)

    // Store round-trip: reloading from storage preserves 'auto'
    const reloaded = await load({ 'hermes.desktop.backdrop.scene.v2': 'auto' })
    expect(reloaded.$backdropScene.get()).toBe('auto')
    expect(reloaded.$backdrop.get()).toBe(true)
  })

  it('cleans up the auto tick timer when leaving auto', async () => {
    vi.useFakeTimers()

    try {
      const store = await load()
      store.startBackdropAutoTimer()
      expect(store.isBackdropAutoTimerActive()).toBe(true)

      const initialTick = store.$backdropAutoTick.get()
      vi.advanceTimersByTime(60_000)
      expect(store.$backdropAutoTick.get()).toBe(initialTick + 1)

      // Switching scene away from auto clears timer
      store.setBackdropScene('ocean')
      expect(store.isBackdropAutoTimerActive()).toBe(false)

      // The contract is a frozen tick, not a raw timer count: persisting the
      // scene writes localStorage, and jsdom schedules its own housekeeping
      // timers for those writes (unrelated to ours).
      const tickAfterLeave = store.$backdropAutoTick.get()
      vi.advanceTimersByTime(180_000)
      expect(store.$backdropAutoTick.get()).toBe(tickAfterLeave)
    } finally {
      vi.useRealTimers()
    }
  })
})
